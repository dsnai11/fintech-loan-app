import 'package:flutter/material.dart' hide Text;
import 'tr_text.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

/// "Pay my EMI automatically" for one loan: set it up, see that it is on, stop it.
class AutoDebitCard extends StatefulWidget {
  final String loanId;
  final VoidCallback? onChanged;
  const AutoDebitCard({Key? key, required this.loanId, this.onChanged}) : super(key: key);

  @override
  State<AutoDebitCard> createState() => _AutoDebitCardState();
}

class _AutoDebitCardState extends State<AutoDebitCard> with WidgetsBindingObserver {
  bool _loading = true;
  bool _busy = false;
  bool _available = false;
  String? _note;
  Map<String, dynamic>? _mandate;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Coming back from the UPI app or bank page: look again
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _mandate?['status'] == 'pending_auth') _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getMyMandates();
      if (!mounted) return;
      final list = List<Map<String, dynamic>>.from(d['mandates'] ?? []);
      Map<String, dynamic>? mine;
      for (final m in list) {
        if (m['loanId'] == widget.loanId && m['status'] != 'completed') mine = m;
      }
      setState(() {
        _available = d['available'] == true;
        _note = d['mode'] == 'test' ? 'Test mode: nothing real is collected.' : null;
        _mandate = mine;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _start(String method) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final m = await context.read<ApiService>().startMandate(widget.loanId, method);
      if (!mounted) return;
      setState(() { _mandate = m; _busy = false; });
      final url = m['authUrl']?.toString();
      if (url != null && url.isNotEmpty) {
        final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Could not open the approval page')));
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<void> _stop() async {
    final m = _mandate;
    if (m == null) return;
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Stop auto-debit?'),
        content: const Text('Your EMIs will no longer be collected automatically. You will need to pay each one in the app on time.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Stop')),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiService>().cancelMandate(m['id'].toString());
      if (!mounted) return;
      setState(() { _mandate = null; _busy = false; });
      widget.onChanged?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  String _money(dynamic v) {
    final n = (v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0).round();
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (x) => '${x[1]},')}';
  }

  String _date(dynamic iso) {
    try {
      final d = DateTime.parse(iso.toString()).toLocal();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return '${d.day} ${months[d.month - 1]}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || (!_available && _mandate == null)) return const SizedBox.shrink();
    final status = _mandate?['status']?.toString();
    final next = _mandate?['next'];

    Widget body;
    if (status == 'active') {
      body = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.check_circle_rounded, color: kGreen, size: 20),
          const SizedBox(width: 8),
          const Expanded(child: Text('Auto-debit is on', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
        ]),
        const SizedBox(height: 6),
        Text(
          next != null
              ? 'Next: ${_money(next['amount'])} on ${_date(next['dueDate'])}. We will remind you a day before.'
              : 'Your EMIs are collected automatically.',
          style: const TextStyle(fontSize: 13, color: Color(0xFF4B5563)),
        ),
        const SizedBox(height: 8),
        TextButton(onPressed: _busy ? null : _stop, child: const Text('Stop auto-debit')),
      ]);
    } else if (status == 'pending_auth') {
      body = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Finish approving auto-debit', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        const Text('Approve it in your UPI app or bank page, then come back here.', style: TextStyle(fontSize: 13, color: Color(0xFF4B5563))),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          ElevatedButton(
            onPressed: _busy
                ? null
                : () async {
                    final url = _mandate?['authUrl']?.toString();
                    if (url != null) await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
                  },
            child: const Text('Open approval'),
          ),
          OutlinedButton(onPressed: _busy ? null : _load, child: const Text('I have approved')),
          TextButton(onPressed: _busy ? null : _stop, child: const Text('Cancel')),
        ]),
      ]);
    } else if (status == 'paused') {
      body = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Auto-debit is paused', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        const Text('Please pay your EMI in the app for now.', style: TextStyle(fontSize: 13, color: Color(0xFF4B5563))),
        TextButton(onPressed: _busy ? null : _stop, child: const Text('Stop auto-debit')),
      ]);
    } else {
      body = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Pay your EMI automatically', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        const Text('Never miss a due date. We tell you a day before each collection, and you can stop it any time.', style: TextStyle(fontSize: 13, color: Color(0xFF4B5563))),
        if (_note != null) ...[
          const SizedBox(height: 4),
          Text(_note!, style: const TextStyle(fontSize: 12, color: Color(0xFF92400E))),
        ],
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          ElevatedButton(onPressed: _busy ? null : () => _start('upi'), child: const Text('Set up with UPI')),
          OutlinedButton(onPressed: _busy ? null : () => _start('enach'), child: const Text('Use bank mandate')),
        ]),
      ]);
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: body,
    );
  }
}
