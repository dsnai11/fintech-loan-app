import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/auto_debit_card.dart';
import '../widgets/settlement_offer_card.dart';

class LoanDetailScreen extends StatefulWidget {
  final Map<String, dynamic> loan;
  const LoanDetailScreen({Key? key, required this.loan}) : super(key: key);

  @override
  State<LoanDetailScreen> createState() => _LoanDetailScreenState();
}

class _LoanDetailScreenState extends State<LoanDetailScreen> {
  List<Map<String, dynamic>> _emis = [];
  bool _loading = true;
  String? _error;
  int? _paying;
  Map<String, dynamic>? _cooling;

  String get _loanId => widget.loan['_id'].toString();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      final data = await api.getEmiSchedule(_loanId);
      Map<String, dynamic>? cooling;
      if (widget.loan['status'] == 'disbursed') {
        try {
          cooling = await api.getCoolingOffQuote(_loanId);
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() {
        _emis = List<Map<String, dynamic>>.from(data['emis'] ?? []);
        _cooling = cooling;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = friendlyError(e); _loading = false; });
    }
  }

  Future<void> _openStatement() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final url = await context.read<ApiService>().getStatementUrl(widget.loan['_id'].toString());
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Could not open the statement')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<void> _pay(Map<String, dynamic> emi) async {
    final n = (emi['emiNumber'] as num).toInt();
    final due = _num(emi['amount']) + _num(emi['penaltyApplied']);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Pay EMI #$n'),
        content: Text('Pay ${_fmtMoney(due)} now?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Pay')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _paying = n);
    try {
      final res = await context.read<ApiService>().payEmi(_loanId, n);
      if (!mounted) return;
      final paid = res['status'] == 'PAID';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(paid ? 'EMI #$n paid successfully' : 'Payment started for EMI #$n'),
      ));
      await _fetch();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _paying = null);
    }
  }

  Future<void> _coolOff() async {
    final api = context.read<ApiService>();
    Map<String, dynamic> q;
    try {
      q = await api.getCoolingOffQuote(_loanId);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
      _fetch();
      return;
    }
    if (!mounted) return;

    Widget row(String label, num value, {bool bold = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [
            Expanded(child: Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400))),
            Text(_fmtMoney(value), style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
          ]),
        );

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this loan'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            row('Amount you received', _num(q['principal'])),
            row('Interest for ${q['daysHeld']} day(s)', _num(q['accruedInterest'])),
            const Divider(),
            row('Total to pay back', _num(q['total']), bold: true),
            const SizedBox(height: 8),
            Text(
              'You can cancel until ${_fmtDate(q['windowEndsAt'])}. Fees and GST already deducted are not refunded.',
              style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep the loan')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Pay & cancel')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _paying = -1);
    try {
      await api.coolOff(_loanId, _num(q['total']));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Loan cancelled')));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
      setState(() => _paying = null);
      _fetch();
    }
  }

  Future<void> _foreclose() async {
    final api = context.read<ApiService>();
    Map<String, dynamic> q;
    try {
      q = await api.getForeclosureQuote(_loanId);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
      return;
    }
    if (!mounted) return;

    Widget row(String label, num value, {bool bold = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [
            Expanded(child: Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400))),
            Text(_fmtMoney(value), style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
          ]),
        );

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Close loan early'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_num(q['overdueAmount']) > 0)
              row('Overdue EMIs + late fees (${q['overdueEmis']})', _num(q['overdueAmount'])),
            row('Remaining principal (${q['remainingEmis']} EMIs)', _num(q['principal'])),
            row('Interest till today', _num(q['accruedInterest'])),
            row('Closure fee (${q['feePercent']}%)', _num(q['fee'])),
            const Divider(),
            row('Total to pay', _num(q['total']), bold: true),
            const SizedBox(height: 8),
            const Text('Future interest is waived. This amount is for today only.',
                style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Pay & close')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _paying = -1);
    try {
      await api.foreclose(_loanId, _num(q['total']));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Loan closed successfully')));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
      setState(() => _paying = null);
      _fetch();
    }
  }

  num _num(dynamic v) => v is num ? v : (num.tryParse(v?.toString() ?? '') ?? 0);

  String _fmtMoney(dynamic v) {
    final n = _num(v).round();
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (m) => '${m[1]},')}';
  }

  String _fmtDate(dynamic iso) {
    if (iso == null) return '—';
    try {
      final d = DateTime.parse(iso.toString()).toLocal();
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${d.day} ${months[d.month - 1]} ${d.year}';
    } catch (_) {
      return iso.toString();
    }
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'PAID': return kGreen;
      case 'WAIVED': return const Color(0xFF6B7280);
      case 'OVERDUE': return const Color(0xFFEF4444);
      case 'FAILED': return const Color(0xFF6366F1);
      default: return const Color(0xFFF59E0B);
    }
  }

  String _statusLabel(String s) => s[0] + s.substring(1).toLowerCase();

  @override
  Widget build(BuildContext context) {
    final paidCount = _emis.where((e) => e['status'] == 'PAID').length;
    final total = _emis.length;
    final nextUnpaid = _emis.indexWhere((e) => e['status'] != 'PAID' && e['status'] != 'WAIVED');

    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('Loan Details'),
        actions: [IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _fetch)],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _summaryCard(paidCount, total),
          if (widget.loan['status'] == 'disbursed' || widget.loan['status'] == 'closed') ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _openStatement,
              icon: const Icon(Icons.description_outlined),
              label: const Text('View loan statement'),
            ),
          ],
          if (widget.loan['status'] == 'disbursed' || widget.loan['status'] == 'defaulted') ...[
            const SizedBox(height: 12),
            SettlementOfferCard(loanId: _loanId, onChanged: _fetch),
          ],
          if (widget.loan['status'] == 'disbursed' && _emis.any((e) => e['status'] != 'PAID' && e['status'] != 'WAIVED')) ...[
            const SizedBox(height: 12),
            AutoDebitCard(loanId: _loanId, onChanged: _fetch),
          ],
          if (_cooling != null) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _paying == null ? _coolOff : null,
              icon: const Icon(Icons.undo_rounded),
              label: const Text('Cancel this loan (cooling-off)'),
            ),
          ],
          if (widget.loan['status'] == 'disbursed' && _emis.any((e) => e['status'] != 'PAID' && e['status'] != 'WAIVED')) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _paying == null ? _foreclose : null,
              icon: const Icon(Icons.flag_rounded),
              label: const Text('Close loan early'),
            ),
          ],
          const SizedBox(height: 16),
          const Text('EMI Schedule',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
          const SizedBox(height: 10),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator(color: kNavy)),
            )
          else if (_error != null)
            Column(children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 8),
              ElevatedButton(onPressed: _fetch, child: const Text('Retry')),
            ])
          else if (_emis.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('The EMI schedule is created once the loan is disbursed.',
                  textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF6B7280))),
            )
          else
            for (int i = 0; i < _emis.length; i++) _emiTile(_emis[i], i == nextUnpaid),
        ],
      ),
    );
  }

  Widget _summaryCard(int paid, int total) {
    final l = widget.loan;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l['loanType']?.toString() ?? 'Personal Loan',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          Row(children: [
            _stat('Amount', _fmtMoney(l['loanAmount'])),
            _stat('EMI', _fmtMoney(l['monthlyEMI'])),
            _stat('Tenure', '${l['tenure']} mo'),
          ]),
          if (total > 0) ...[
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: paid / total,
                minHeight: 8,
                backgroundColor: const Color(0xFFE5E7EB),
                valueColor: const AlwaysStoppedAnimation<Color>(kGreen),
              ),
            ),
            const SizedBox(height: 6),
            Text('$paid of $total EMIs paid',
                style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          ],
        ],
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 10, color: Color(0xFF9CA3AF), fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _emiTile(Map<String, dynamic> emi, bool isNext) {
    final status = emi['status']?.toString() ?? 'PENDING';
    final n = (emi['emiNumber'] as num).toInt();
    final color = _statusColor(status);
    final penalty = _num(emi['penaltyApplied']);
    final canPay = status != 'PAID' && status != 'WAIVED';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: isNext ? Border.all(color: kNavy, width: 1.5) : null,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('EMI #$n  •  ${_fmtMoney(emi['amount'])}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                const SizedBox(height: 3),
                Text(
                  status == 'PAID'
                      ? 'Paid on ${_fmtDate(emi['paidDate'])}'
                      : 'Due ${_fmtDate(emi['dueDate'])}',
                  style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                ),
                if (penalty > 0 && status != 'PAID')
                  Text('Late fee ${_fmtMoney(penalty)}',
                      style: const TextStyle(fontSize: 12, color: Color(0xFFEF4444))),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: color.withOpacity(0.12),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(_statusLabel(status),
                style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
          if (canPay) ...[
            const SizedBox(width: 8),
            _paying == n
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                : TextButton(
                    onPressed: _paying == null ? () => _pay(emi) : null,
                    child: const Text('Pay'),
                  ),
          ],
        ],
      ),
    );
  }
}
