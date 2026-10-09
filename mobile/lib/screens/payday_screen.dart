import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../utils/format.dart';
import '../widgets/tr_text.dart';

// Payday advance: borrow part of your salary early and pay it back in one go on your payday.
// Steps: tell us your salary day and income, choose an amount, read what it costs, apply.
class PaydayScreen extends StatefulWidget {
  const PaydayScreen({Key? key}) : super(key: key);

  @override
  State<PaydayScreen> createState() => _PaydayScreenState();
}

class _PaydayScreenState extends State<PaydayScreen> {
  Map<String, dynamic>? _s;
  Map<String, dynamic>? _quote;
  String? _error;
  double _amount = 0;
  int _day = 1;
  bool _editing = false;
  bool _agreed = false;
  bool _busy = false;
  bool _done = false;
  final _income = TextEditingController();
  final _company = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _income.dispose();
    _company.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final s = await context.read<ApiService>().getPaydayStatus();
      if (!mounted) return;
      setState(() {
        _s = s;
        _error = null;
        _day = (s['salaryDay'] as num?)?.toInt() ?? 1;
        final inc = s['income'] is Map ? asNum((s['income'] as Map)['amount']) : 0;
        if (_income.text.isEmpty && inc > 0) _income.text = inc.round().toString();
        final lo = asNum(s['minAmount']).toDouble();
        final hi = asNum(s['maxAmount']).toDouble();
        if (hi >= lo && hi > 0) _amount = (_amount < lo || _amount > hi) ? hi.clamp(lo, hi).toDouble() : _amount;
      });
      if (s['eligible'] == true) _loadQuote();
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
  }

  Future<void> _loadQuote() async {
    try {
      final r = await context.read<ApiService>().getPaydayQuote(_amount.round());
      if (mounted) setState(() => _quote = r['quote'] is Map ? Map<String, dynamic>.from(r['quote'] as Map) : null);
    } catch (_) {}
  }

  Future<void> _saveDetails() async {
    final inc = num.tryParse(_income.text.trim());
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiService>().savePaydayDetails(salaryDay: _day, monthlyIncome: inc, company: _company.text.trim());
      _editing = false;
      await _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _apply() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiService>().applyPayday(_amount.round());
      if (mounted) setState(() => _done = true);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  String _date(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${m[d.month - 1]} ${d.year}';
  }

  Widget _card(List<Widget> children) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );

  Widget _row(String label, String value, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 14, color: const Color(0xFF4B5563), fontWeight: bold ? FontWeight.w800 : FontWeight.w400))),
          Text(value, style: TextStyle(fontSize: 14, fontWeight: bold ? FontWeight.w800 : FontWeight.w600, color: const Color(0xFF111827))),
        ]),
      );

  Widget _detailsForm() => _card([
        const Text('About your salary', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 4),
        const Text('We use this to work out how much you can borrow and which payday to collect on.', style: TextStyle(fontSize: 12.5, color: Color(0xFF6B7280), height: 1.4)),
        const SizedBox(height: 12),
        DropdownButtonFormField<int>(
          value: _day,
          decoration: const InputDecoration(labelText: 'Day of the month your salary arrives'),
          items: [for (var i = 1; i <= 31; i++) DropdownMenuItem(value: i, child: Text('$i'))],
          onChanged: (v) => setState(() => _day = v ?? 1),
        ),
        const SizedBox(height: 10),
        TextField(controller: _income, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Monthly take-home salary (₹)')),
        const SizedBox(height: 10),
        TextField(controller: _company, maxLength: 80, decoration: const InputDecoration(labelText: 'Where you work (optional)')),
        const SizedBox(height: 6),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : _saveDetails, child: const Text('Save'))),
      ]);

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Payday advance')),
      body: _done
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 64),
                const SizedBox(height: 14),
                const Text('We have your request', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text('We will look at it now. If it is approved, you will be asked to accept the agreement in the app, and the money goes to your bank account. You repay ${formatMoney(asNum(_quote?['totalRepayable'] ?? _amount))} on ${_date(_quote?['payday']?['dueDate'])}.',
                    textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF4B5563))),
                const SizedBox(height: 22),
                ElevatedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
              ]),
            )
          : s == null
              ? Center(child: _error != null ? Padding(padding: const EdgeInsets.all(24), child: Text(_error!)) : const CircularProgressIndicator(color: kNavy))
              : RefreshIndicator(color: kNavy, onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: _body(s))),
    );
  }

  List<Widget> _body(Map<String, dynamic> s) {
    final checks = List<Map<String, dynamic>>.from((s['checks'] ?? []).map((e) => Map<String, dynamic>.from(e as Map)));
    final undone = checks.where((c) => c['ok'] != true).toList();
    final needsDetails = undone.any((c) => ['salaryDay', 'income', 'salaried'].contains(c['key']));
    final others = undone.where((c) => !['salaryDay', 'income', 'salaried'].contains(c['key'])).toList();
    final eligible = s['eligible'] == true;
    final lo = asNum(s['minAmount']).toDouble();
    final hi = asNum(s['maxAmount']).toDouble();
    final q = _quote;
    final pay = q?['payday'] is Map ? Map<String, dynamic>.from(q!['payday'] as Map) : null;
    return [
      _card([
        const Text('Get your salary early', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
        const SizedBox(height: 6),
        const Text('Borrow a small amount now and pay it back in one go on your next payday. No monthly instalments. One fee, shown before you apply.', style: TextStyle(fontSize: 13.5, height: 1.45, color: Color(0xFF4B5563))),
      ]),
      if (s['enabled'] != true)
        _card([const Text('The payday advance is not available right now. Please check again later.')])
      else ...[
        if (s['livePaydayLoanId'] != null) _card([const Text('You already have a payday advance', style: TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 4), const Text('Repay it on your payday, then you can take another. You can see it under your loans.', style: TextStyle(fontSize: 13, height: 1.4))]),
        if (others.isNotEmpty && s['livePaydayLoanId'] == null)
          _card([
            const Text('Before you can apply', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 8),
            for (final c in others) Padding(padding: const EdgeInsets.only(bottom: 6), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.radio_button_unchecked, size: 18, color: Color(0xFFB45309)), const SizedBox(width: 8), Expanded(child: Text('${c['hint']}', style: const TextStyle(fontSize: 13.5, height: 1.4)))])),
          ]),
        if ((needsDetails || _editing) && s['livePaydayLoanId'] == null) _detailsForm(),
        if (eligible && !needsDetails && !_editing) ...[
          _card([
            Row(children: [
              const Expanded(child: Text('Your salary', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              TextButton(onPressed: () => setState(() => _editing = true), child: const Text('Change')),
            ]),
            _row('Arrives on day', '${s['salaryDay']} of the month'),
            _row('Monthly income', formatMoney(asNum((s['income'] as Map)['amount']))),
          ]),
          _card([
            const Text('How much do you need?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Center(child: Text(formatMoney(_amount), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: kNavy))),
            if (hi > lo)
              Slider(
                value: _amount.clamp(lo, hi).toDouble(),
                min: lo,
                max: hi,
                divisions: ((hi - lo) / 100).round().clamp(1, 1000).toInt(),
                activeColor: kNavy,
                onChanged: (v) => setState(() { _amount = (v / 100).round() * 100.0; _agreed = false; }),
                onChangeEnd: (_) => _loadQuote(),
              ),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(formatMoney(lo), style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))), Text('You can borrow up to ${formatMoney(hi)}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)))]),
          ]),
          if (q != null && asNum(q['amount']) == _amount.round())
            _card([
              const Text('What it costs', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 8),
              _row('Advance', formatMoney(asNum(q['amount']))),
              _row('Fee', formatMoney(asNum(q['processingFee']))),
              _row('GST on the fee (${q['gstPercent']}%)', formatMoney(asNum(q['gst']))),
              const Divider(),
              _row('You receive', formatMoney(asNum(q['netDisbursed'])), bold: true),
              _row('You repay', formatMoney(asNum(q['totalRepayable'])), bold: true),
              _row('Repay on', pay == null ? '' : '${_date(pay['dueDate'])} (${pay['days']} days)'),
              _row('Cost per year (APR)', '${q['aprPercent']}%'),
              const SizedBox(height: 6),
              Text('If you do not pay on ${_date(pay?['dueDate'])}, a late fee of ${formatMoney(asNum((q['lateFee'] as Map?)?['minimum'] ?? 0))} or ${(q['lateFee'] as Map?)?['percentPerMonth']}% a month (whichever is more) applies. You can cancel within ${q['coolingOffDays']} days of getting the money.',
                  style: const TextStyle(fontSize: 12, height: 1.4, color: Color(0xFF6B7280))),
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _agreed,
                onChanged: (v) => setState(() => _agreed = v ?? false),
                title: const Text('I have read what this costs and when I must repay.', style: TextStyle(fontSize: 13)),
              ),
              SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy || !_agreed ? null : _apply, child: Text(_busy ? 'Please wait…' : 'Apply for ${formatMoney(asNum(q['amount']))}'))),
            ]),
        ],
      ],
      const SizedBox(height: 4),
      const Text('This is a loan, not a gift. Borrow only what you can repay on your payday.', style: TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.4)),
    ];
  }
}

// The card on the home screen
class PaydayCard extends StatelessWidget {
  final Map<String, dynamic> status;
  const PaydayCard({Key? key, required this.status}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final max = asNum(status['maxAmount']);
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaydayScreen())),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFF1D5D9))),
        child: Row(children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: kNavy.withOpacity(0.10), borderRadius: BorderRadius.circular(14)),
            child: const Icon(Icons.payments_outlined, color: kNavy, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Payday advance', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
              const SizedBox(height: 2),
              Text(max > 0 ? 'Up to ${formatMoney(max)}, repay on your payday' : 'Part of your salary, early. Repay on payday.', style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280))),
            ]),
          ),
          const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
