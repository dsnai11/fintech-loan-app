import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/app_settings.dart';
import '../utils/error_utils.dart';

// A conversation with the company's support team. Replies appear here and as a notification.
class SupportScreen extends StatefulWidget {
  const SupportScreen({Key? key}) : super(key: key);

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _poll;
  Map<String, dynamic>? _assistant; // { enabled, name, greeting }
  bool _botActive = true; // false once a person has taken over
  DateTime? _waitingSince; // set after the customer writes, until an answer arrives
  int _tick = 0;

  bool get _assistantOn => _assistant?['enabled'] == true;
  bool get _waitingForBot => _assistantOn && _botActive && _waitingSince != null && DateTime.now().difference(_waitingSince!) < const Duration(seconds: 60);

  @override
  void initState() {
    super.initState();
    _load(first: true);
    _loadAssistant();
    // Check often while an answer is on its way, and now and then otherwise
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      _tick++;
      if (_waitingForBot || _tick % 5 == 0) _load();
    });
  }

  Future<void> _loadAssistant() async {
    try {
      final a = await context.read<ApiService>().getAssistantInfo();
      if (mounted) setState(() => _assistant = a);
    } catch (_) {} // without it the screen works as before, with no assistant

  @override
  void dispose() {
    _poll?.cancel();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool first = false}) async {
    try {
      final thread = await context.read<ApiService>().getSupportThread();
      if (!mounted) return;
      final list = thread == null
          ? <Map<String, dynamic>>[]
          : (thread['messages'] as List).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      final grew = list.length != _messages.length;
      setState(() {
        _messages = list;
        _loading = false;
        _error = null;
        _botActive = thread == null ? true : thread['botActive'] != false;
        if (list.isNotEmpty && list.last['from'] != 'customer') _waitingSince = null; // an answer has arrived
      });
      if (grew) _toBottom();
    } catch (e) {
      if (!mounted) return;
      if (first) {
        setState(() {
          _error = friendlyError(e);
          _loading = false;
        });
      }
    }
  }

  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await context.read<ApiService>().sendSupportMessage(text);
      _controller.clear();
      if (_assistantOn && _botActive) _waitingSince = DateTime.now();
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _sending = false);
  }

  Future<void> _askForPerson() async {
    try {
      await context.read<ApiService>().requestPerson();
      _waitingSince = null;
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<void> _rate(Map<String, dynamic> m, String value) async {
    setState(() => m['feedback'] = value);
    try {
      await context.read<ApiService>().rateAssistantAnswer('${m['id']}', value);
    } catch (_) {}
    if (value == 'down' && mounted && _botActive) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: const Text('Sorry about that. Would you like to talk to a person?'),
        action: SnackBarAction(label: tr('Talk to a person'), onPressed: _askForPerson),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettings>();
    final email = settings.supportEmail.isNotEmpty ? '\nEmail: ${settings.supportEmail}' : '';
    final phone = settings.supportPhone.isNotEmpty ? '\nPhone: ${settings.supportPhone}' : '';
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Messages')),
      body: !settings.support
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('Messaging is switched off for now.$email$phone', textAlign: TextAlign.center),
              ),
            )
          : Column(
              children: [
                Expanded(child: _body()),
                if (_assistantOn && _botActive && _messages.isNotEmpty)
                  Container(
                    color: Colors.white,
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(onPressed: _askForPerson, icon: const Icon(Icons.support_agent_rounded, size: 18), label: const Text('Talk to a person')),
                    ),
                  ),
                SafeArea(
                  top: false,
                  child: Container(
                    color: Colors.white,
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _controller,
                            minLines: 1,
                            maxLines: 4,
                            maxLength: 2000,
                            textCapitalization: TextCapitalization.sentences,
                            decoration: const InputDecoration(hintText: 'Write a message', counterText: ''),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _sending ? null : _send,
                          style: IconButton.styleFrom(backgroundColor: kNavy),
                          icon: _sending
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.send_rounded, color: Colors.white),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: kNavy));
    if (_error != null) {
      return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)));
    }
    if (_messages.isEmpty) {
      if (_assistantOn) {
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: kNavy.withOpacity(0.08), shape: BoxShape.circle),
                child: const Icon(Icons.smart_toy_outlined, color: kNavy, size: 30),
              ),
              const SizedBox(height: 14),
              Text('${_assistant!['name'] ?? 'LIFC Assistant'}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
              const SizedBox(height: 8),
              Text('${_assistant!['greeting'] ?? ''}', textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF6B7280), height: 1.5)),
              const SizedBox(height: 10),
              TextButton.icon(onPressed: _askForPerson, icon: const Icon(Icons.support_agent_rounded, size: 18), label: const Text('Talk to a person')),
            ]),
          ),
        );
      }
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Write to us here. A member of our team will reply, and you will get a notification.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF6B7280), height: 1.5),
          ),
        ),
      );
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.all(16),
      itemCount: _messages.length + (_waitingForBot ? 1 : 0),
      itemBuilder: (_, i) => i == _messages.length ? _typing() : _bubble(_messages[i], i),
    );
  }

  Widget _typing() => Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE5E7EB))),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: kNavy)),
            const SizedBox(width: 10),
            Text('${_assistant?['name'] ?? 'Assistant'} is typing...', style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280))),
          ]),
        ),
      );

  Widget _bubble(Map<String, dynamic> m, int index) {
    final mine = m['from'] == 'customer';
    final ai = m['ai'] == true;
    final lastBot = ai && _messages.lastIndexWhere((x) => x['ai'] == true) == index;
    final at = DateTime.tryParse((m['at'] ?? '').toString())?.toLocal();
    final time = at == null ? '' : '${at.day}/${at.month} ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: mine ? kNavy : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: mine ? null : Border.all(color: const Color(0xFFE5E7EB)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!mine)
              Row(mainAxisSize: MainAxisSize.min, children: [
                Text((m['name'] ?? 'LIFC support').toString(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF6B7280))),
                if (ai)
                  Container(
                    margin: const EdgeInsets.only(left: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(color: const Color(0xFFF3E8FF), borderRadius: BorderRadius.circular(8)),
                    child: const Text('AI', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: Color(0xFF6B21A8))),
                  ),
              ]),
            Text((m['text'] ?? '').toString(),
                style: TextStyle(color: mine ? Colors.white : const Color(0xFF111827), fontSize: 14, height: 1.4)),
            const SizedBox(height: 4),
            Text(time, style: TextStyle(fontSize: 10, color: mine ? Colors.white70 : const Color(0xFF9CA3AF))),
            if (lastBot)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: m['feedback'] != null
                    ? Text(m['feedback'] == 'up' ? 'Thanks for the feedback' : 'Thanks, we will improve', style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)))
                    : Row(mainAxisSize: MainAxisSize.min, children: [
                        const Text('Was this helpful?', style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                        const SizedBox(width: 6),
                        GestureDetector(onTap: () => _rate(m, 'up'), child: const Icon(Icons.thumb_up_alt_outlined, size: 16, color: Color(0xFF6B7280))),
                        const SizedBox(width: 10),
                        GestureDetector(onTap: () => _rate(m, 'down'), child: const Icon(Icons.thumb_down_alt_outlined, size: 16, color: Color(0xFF6B7280))),
                      ]),
              ),
          ],
        ),
      ),
    );
  }
}
