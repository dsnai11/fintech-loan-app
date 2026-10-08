import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';

// Share bank statements to prove income (Account Aggregator). Optional. Only a summary is kept and the customer can remove it.
class IncomeCheckScreen extends StatefulWidget {
  const IncomeCheckScreen({Key? key}) : super(key: key);

  @override
  State<IncomeCheckScreen> createState() => _IncomeCheckScreenState();
}

class _IncomeCheckScreenState extends State<IncomeCheckScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _d;
  String? _sessionId;
  bool _busy = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _sessionId != null) _check();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getIncomeCheck();
      if (mounted) setState(() => _d = d);
    } catch (_) {}
  }

  Future<void> _start() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await context.read<ApiService>().startIncomeCheck();
      _sessionId = r['sessionId'].toString();
      final ok = await launchUrl(Uri.parse(r['url'].toString()), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Could not open the page')));
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 3), (_) => _check());
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _check() async {
    final id = _sessionId;
    if (id == null) return;
    try {
      final r = await context.read<ApiService>().incomeCheckStatus(id);
      final st = r['status'];
      if (st == 'completed' || st == 'failed' || st == 'expired') {
        _poll?.cancel();
        _sessionId = null;
        await _load();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(st == 'completed' ? 'Thank you. Your income has been checked.' : 'It was not completed. You can try again.')));
      }
    } catch (_) {}
  }

  Future<void> _remove() async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove this?'),
        content: const Text('We will delete the summary of your bank statements. You can share them again any time.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remove')),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    try {
      await context.read<ApiService>().removeIncomeCheck();
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  String _money(dynamic v) {
    final n = (v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0).round();
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (x) => '${x[1]},')}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final check = d?['check'];
    final available = d?['available'] == true;
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Share bank statements')),
      body: d == null
          ? const Center(child: CircularProgressIndicator(color: kNavy))
          : ListView(padding: const EdgeInsets.all(16), children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Get a faster decision', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  const Text('Share your last 6 months of bank statements through the secure Account Aggregator network. It is optional, and it can help us decide faster and offer more.', style: TextStyle(color: Color(0xFF4B5563), height: 1.4)),
                  const SizedBox(height: 10),
                  const Text('• You approve at your bank, and can stop any time.\n• We keep only a short summary (income, bounced payments, average balance), not your statements.\n• You can remove the summary here whenever you like.', style: TextStyle(color: Color(0xFF4B5563), height: 1.5, fontSize: 13)),
                  if (d['mode'] == 'sandbox') ...[
                    const SizedBox(height: 8),
                    const Text('Test mode: no real bank is contacted.', style: TextStyle(fontSize: 12, color: Color(0xFF92400E))),
                  ],
                ]),
              ),
              const SizedBox(height: 12),
              if (check != null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: const [
                      Icon(Icons.check_circle_rounded, color: kGreen, size: 20),
                      SizedBox(width: 8),
                      Text('Statements shared', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    ]),
                    const SizedBox(height: 8),
                    Text(check['salaryDetected'] == true ? 'Income seen: about ${_money(check['estimatedMonthlyIncome'])} a month' : 'No regular salary seen. Money in: about ${_money(check['avgMonthlyCredits'])} a month', style: const TextStyle(fontSize: 14)),
                    const SizedBox(height: 4),
                    Text('${check['months']} months checked${check['stale'] == true ? ' · this is old, please share again' : ''}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, children: [
                      if (available) OutlinedButton(onPressed: _busy ? null : _start, child: const Text('Share again')),
                      TextButton(onPressed: _remove, child: const Text('Remove')),
                    ]),
                  ]),
                )
              else if (available)
                ElevatedButton(onPressed: _busy ? null : _start, child: const Text('Share my bank statements'))
              else
                const Text('This is not available right now.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF6B7280))),
              if (_sessionId != null) ...[
                const SizedBox(height: 12),
                const Text('Waiting for you to finish at your bank... then come back here.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
              ],
            ]),
    );
  }
}

// A row for the profile screen
class IncomeCheckRow extends StatelessWidget {
  const IncomeCheckRow({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const IncomeCheckScreen())),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: const [
          Icon(Icons.account_balance_rounded, color: kNavy),
          SizedBox(width: 14),
          Expanded(child: Text('Share bank statements', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
