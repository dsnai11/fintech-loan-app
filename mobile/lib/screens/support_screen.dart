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

  @override
  void initState() {
    super.initState();
    _load(first: true);
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

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
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _sending = false);
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
      itemCount: _messages.length,
      itemBuilder: (_, i) => _bubble(_messages[i]),
    );
  }

  Widget _bubble(Map<String, dynamic> m) {
    final mine = m['from'] == 'customer';
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
              Text((m['name'] ?? 'LIFC support').toString(),
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF6B7280))),
            Text((m['text'] ?? '').toString(),
                style: TextStyle(color: mine ? Colors.white : const Color(0xFF111827), fontSize: 14, height: 1.4)),
            const SizedBox(height: 4),
            Text(time, style: TextStyle(fontSize: 10, color: mine ? Colors.white70 : const Color(0xFF9CA3AF))),
          ],
        ),
      ),
    );
  }
}
