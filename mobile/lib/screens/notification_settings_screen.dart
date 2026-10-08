import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/push_service.dart';
import '../widgets/tr_text.dart';

// Which kinds of alert the customer wants on their phone, and the switch that turns push notifications on for this phone.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({Key? key}) : super(key: key);

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  bool _saving = false;
  bool _phoneOn = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getPushPreferences();
      if (mounted) setState(() { _d = d; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not load your choices. Pull down to try again.');
    }
  }

  List<Map<String, dynamic>> get _categories => ((_d?['categories'] as List?) ?? []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();

  Future<void> _toggle(String key, bool on) async {
    setState(() => _saving = true);
    try {
      final d = await context.read<ApiService>().setPushPreferences({key: on});
      if (mounted) setState(() => _d = d);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save. Please try again.')));
    }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _turnOn() async {
    final push = PushService.instance;
    final granted = await push.requestPermission();
    if (granted) _phoneOn = await push.syncToken(context.read<ApiService>());
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final available = _d?['available'] == true && PushService.instance.supported;
    return Scaffold(
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            if (_d == null && _error == null) const Padding(padding: EdgeInsets.only(top: 80), child: Center(child: CircularProgressIndicator())),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 60), child: Center(child: Text(_error!, textAlign: TextAlign.center))),
            if (_d != null) ...[
              _statusCard(available),
              const SizedBox(height: 18),
              const Text('Choose what to get', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
              const SizedBox(height: 10),
              for (final c in _categories) _row(c),
            ],
          ],
        ),
      ),
    );
  }

  Widget _statusCard(bool available) {
    final on = available && _phoneOn;
    final color = on ? const Color(0xFF166534) : const Color(0xFF92400E);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: on ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(on ? Icons.notifications_active_rounded : Icons.notifications_none_rounded, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(on ? 'Alerts are on for this phone' : 'Phone alerts are not switched on yet', style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 14))),
        ]),
        const SizedBox(height: 6),
        Text(
          available
              ? 'Turn them on to get loan, payment and offer alerts even when the app is closed.'
              : 'Your alerts always appear in the notification bell inside the app. Alerts on your phone will be available soon.',
          style: TextStyle(color: color, fontSize: 12.5, height: 1.4),
        ),
        if (available && !on) ...[
          const SizedBox(height: 12),
          ElevatedButton(onPressed: _turnOn, child: const Text('Turn on notifications')),
        ],
      ]),
    );
  }

  Widget _row(Map<String, dynamic> c) {
    final locked = c['locked'] == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((c['label'] ?? '').toString(), style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
            const SizedBox(height: 2),
            Text((c['note'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.35)),
          ]),
        ),
        if (locked)
          const Padding(padding: EdgeInsets.all(12), child: Icon(Icons.lock_rounded, size: 18, color: Color(0xFF9CA3AF)))
        else
          Switch(value: c['on'] == true, activeColor: kNavy, onChanged: _saving ? null : (v) => _toggle((c['key'] ?? '').toString(), v)),
      ]),
    );
  }
}

// A row for the profile screen
class NotificationSettingsRow extends StatelessWidget {
  const NotificationSettingsRow({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationSettingsScreen())),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: const [
          Icon(Icons.notifications_none_rounded, color: kNavy),
          SizedBox(width: 14),
          Expanded(child: Text('Notifications', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
