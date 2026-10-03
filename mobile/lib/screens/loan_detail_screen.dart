import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

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

  String get _loanId => widget.loan['_id'].toString();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await context.read<ApiService>().getEmiSchedule(_loanId);
      setState(() {
        _emis = List<Map<String, dynamic>>.from(data['emis'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = friendlyError(e); _loading = false; });
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
    final nextUnpaid = _emis.indexWhere((e) => e['status'] != 'PAID');

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
    final canPay = status != 'PAID';

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
