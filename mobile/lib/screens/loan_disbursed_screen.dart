import 'package:flutter/material.dart';
import '../main.dart';

class LoanDisbursedScreen extends StatefulWidget {
  final Map<String, dynamic>? loanData;

  const LoanDisbursedScreen({Key? key, this.loanData}) : super(key: key);

  @override
  State<LoanDisbursedScreen> createState() => _LoanDisbursedScreenState();
}

class _LoanDisbursedScreenState extends State<LoanDisbursedScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _scaleAnim;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 800));
    _scaleAnim = CurvedAnimation(parent: _ctrl, curve: Curves.elasticOut);
    _fadeAnim = CurvedAnimation(parent: _ctrl, curve: Curves.easeIn);
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  String _fmt(dynamic v) => v?.toString() ?? '—';
  String _fmtMoney(dynamic v) {
    if (v == null) return '₹—';
    final n = (v is num) ? v.toInt() : int.tryParse(v.toString()) ?? 0;
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (m) => '${m[1]},')}';
  }

  @override
  Widget build(BuildContext context) {
    final loan = widget.loanData ?? {};
    final disbursed = loan['disbursedAmount'] ?? loan['loanAmount'];
    final repayment = loan['repaymentSchedule'] as List? ?? [];
    final txnId = loan['transactionId'] ?? 'TXN${DateTime.now().millisecondsSinceEpoch}';

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Container(
              color: kNavy,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: Row(
                children: [
                  const Expanded(
                    child: Center(
                      child: Text('Loan Application',
                          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Text('7 / 7',
                        style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: FadeTransition(
                  opacity: _fadeAnim,
                  child: Column(
                    children: [
                      const SizedBox(height: 8),

                      ScaleTransition(
                        scale: _scaleAnim,
                        child: Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: kGreen.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.check_circle_rounded, color: kGreen, size: 64),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text('Application Submitted! 🎉',
                          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
                      const SizedBox(height: 6),
                      const Text(
                        'Your loan application is under review.\nWe will notify you within 24 working hours.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14, color: Color(0xFF6B7280), height: 1.5),
                      ),
                      const SizedBox(height: 20),

                      // Amount card
                      Container(
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [kNavy, Color(0xFF312E81)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Column(
                          children: [
                            Padding(
                              padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
                              child: Column(
                                children: [
                                  const Text('APPLIED LOAN AMOUNT',
                                      style: TextStyle(
                                          color: Colors.white60, fontSize: 11,
                                          fontWeight: FontWeight.w600, letterSpacing: 0.8)),
                                  const SizedBox(height: 6),
                                  Text(_fmtMoney(disbursed),
                                      style: const TextStyle(
                                          color: Colors.white, fontSize: 36, fontWeight: FontWeight.w900)),
                                ],
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.08),
                                borderRadius: const BorderRadius.vertical(bottom: Radius.circular(16)),
                              ),
                              child: Column(
                                children: [
                                  _row('Loan Amount', _fmtMoney(loan['loanAmount'])),
                                  _row('Processing Fee', '- ${_fmtMoney(loan['processingFee'])}'),
                                  _row('GST (${loan['gstPercent'] ?? 18}%)', '- ${_fmtMoney(loan['gst'])}'),
                                  const SizedBox(height: 6),
                                  _row('Txn ID', _fmt(txnId),
                                      valueColor: const Color(0xFF86EFAC)),
                                  _row('Application Status', 'Under Review',
                                      valueColor: const Color(0xFFFBBF24)),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Repayment schedule
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Padding(
                              padding: EdgeInsets.fromLTRB(16, 14, 16, 8),
                              child: Text('Repayment Plan',
                                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14,
                                      color: Color(0xFF111827))),
                            ),
                            const Divider(height: 1, color: Color(0xFFF3F4F6)),
                            if (repayment.isEmpty)
                              const Padding(
                                padding: EdgeInsets.all(16),
                                child: Text('No schedule available',
                                    style: TextStyle(color: Color(0xFF9CA3AF))),
                              )
                            else
                              ...repayment.asMap().entries.map((entry) {
                                final i = entry.key;
                                final r = entry.value as Map;
                                final dateStr = _formatDate(r['dueDate']?.toString());
                                return Column(
                                  children: [
                                    if (i > 0)
                                      const Divider(height: 1, color: Color(0xFFF3F4F6),
                                          indent: 16, endIndent: 16),
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                                      child: Row(
                                        children: [
                                          Container(
                                            width: 28, height: 28,
                                            decoration: BoxDecoration(
                                              color: kNavy.withOpacity(0.08),
                                              shape: BoxShape.circle,
                                            ),
                                            child: Center(
                                              child: Text('${i + 1}',
                                                  style: const TextStyle(
                                                      color: kNavy, fontWeight: FontWeight.w700, fontSize: 12)),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(dateStr,
                                                    style: const TextStyle(fontWeight: FontWeight.w600,
                                                        fontSize: 13, color: Color(0xFF111827))),
                                                const Text('Pay in the app',
                                                    style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                                              ],
                                            ),
                                          ),
                                          Text(_fmtMoney(r['amount']),
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.w700, fontSize: 14,
                                                  color: Color(0xFF111827))),
                                        ],
                                      ),
                                    ),
                                  ],
                                );
                              }).toList(),
                            const Padding(
                              padding: EdgeInsets.fromLTRB(16, 4, 16, 14),
                              child: Text(
                                'On-time payments help build your credit score.',
                                style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF),
                                    fontStyle: FontStyle.italic),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),

                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: () =>
                              Navigator.of(context).pushNamedAndRemoveUntil('/home', (_) => false),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: kNavy,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          child: const Text('Back to Home',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white60, fontSize: 12)),
          Text(value,
              style: TextStyle(
                  color: valueColor ?? Colors.white,
                  fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  String _formatDate(String? iso) {
    if (iso == null) return '—';
    try {
      final d = DateTime.parse(iso);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${d.day} ${months[d.month - 1]} ${d.year}';
    } catch (_) {
      return iso;
    }
  }
}
