import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';

// "Call me back": pick a topic and a time; the support team phones the number on the account.
class CallbackScreen extends StatefulWidget {
  const CallbackScreen({Key? key}) : super(key: key);

  @override
  State<CallbackScreen> createState() => _CallbackScreenState();
}

class _CallbackScreenState extends State<CallbackScreen> {
  Map<String, dynamic>? _d;
  String _topic = 'loan';
  String _day = 'today';
  String _slot = 'morning';
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getCallbacks();
      if (mounted) setState(() => _d = d);
    } catch (_) {}
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiService>().requestCallback(topic: _topic, day: _day, slot: _slot, note: _note.text.trim());
      _note.clear();
      await _load();
      messenger.showSnackBar(const SnackBar(content: Text('Done. We will phone you in the time you chose.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _cancel(String id) async {
    try {
      await context.read<ApiService>().cancelCallback(id);
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Widget _choice(String label, String value, String current, void Function(String) set) => ChoiceChip(
        label: Text(label),
        selected: current == value,
        onSelected: (_) => setState(() => set(value)),
        selectedColor: const Color(0xFFFDE7EA),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final open = d == null ? null : List<Map<String, dynamic>>.from(d['requests'] ?? []).where((r) => r['status'] == 'open').toList();
    final slots = d == null ? <String, dynamic>{} : Map<String, dynamic>.from(d['slots'] ?? {});
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Request a call back')),
      body: d == null
          ? const Center(child: CircularProgressIndicator(color: kNavy))
          : ListView(padding: const EdgeInsets.all(16), children: [
              if (open!.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('We will call you', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 6),
                    Text('${open.first['day'] == 'today' ? 'Today' : 'Tomorrow'}, ${open.first['slotText']}, on the number registered with us.', style: const TextStyle(fontSize: 14, height: 1.4)),
                    TextButton(onPressed: () => _cancel(open.first['id'].toString()), child: const Text('Cancel this request')),
                  ]),
                )
              else
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('What is it about?', style: TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, children: [
                      _choice('My loan', 'loan', _topic, (v) => _topic = v),
                      _choice('A payment', 'payment', _topic, (v) => _topic = v),
                      _choice('KYC', 'kyc', _topic, (v) => _topic = v),
                      _choice('Something else', 'other', _topic, (v) => _topic = v),
                    ]),
                    const SizedBox(height: 14),
                    const Text('When?', style: TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, children: [
                      _choice('Today', 'today', _day, (v) => _day = v),
                      _choice('Tomorrow', 'tomorrow', _day, (v) => _day = v),
                    ]),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, children: [
                      for (final e in slots.entries) _choice(e.value.toString(), e.key, _slot, (v) => _slot = v),
                    ]),
                    const SizedBox(height: 14),
                    TextField(controller: _note, maxLength: 300, maxLines: 2, decoration: const InputDecoration(labelText: 'Anything we should know? (optional)')),
                    const SizedBox(height: 8),
                    SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : _send, child: const Text('Call me'))),
                  ]),
                ),
              const SizedBox(height: 10),
              const Text('We call from our registered number to the mobile number on your account. We never ask for your PIN, OTP or password.', style: TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.4)),
            ]),
    );
  }
}

// A row for the profile screen
class CallbackRow extends StatelessWidget {
  const CallbackRow({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CallbackScreen())),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: const [
          Icon(Icons.phone_callback_outlined, color: kNavy),
          SizedBox(width: 14),
          Expanded(child: Text('Request a call back', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
