import 'package:flutter/material.dart';
import '../main.dart';
import 'loan_flow_scaffold.dart';
import 'bank_details_screen.dart';

class LoanApprovedScreen extends StatelessWidget {
  final int planIndex;

  const LoanApprovedScreen({Key? key, required this.planIndex}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final plans = [
      {'plan': 'One Time', 'tenure': '30 Days', 'interest': '0%', 'final': '₹30,000', 'charges': '₹1,770'},
      {'plan': '3-Month EMI', 'tenure': '3 Months', 'interest': '5%', 'final': '₹31,500', 'charges': '₹1,770'},
      {'plan': '6-Month EMI', 'tenure': '6 Months', 'interest': '9%', 'final': '₹32,700', 'charges': '₹1,770'},
    ];
    final p = plans[planIndex];

    return LoanFlowScaffold(
      step: 5,
      title: 'Loan Approved',
      buttonLabel: 'Proceed to Bank Details →',
      onContinue: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const BankDetailsScreen()),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const SizedBox(height: 12),

            // Success icon
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: kGreen.withOpacity(0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle_rounded,
                  color: kGreen, size: 56),
            ),
            const SizedBox(height: 16),
            const Text('Congratulations! 🎉',
                style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF111827))),
            const SizedBox(height: 4),
            const Text('Your loan has been approved',
                style: TextStyle(fontSize: 14, color: Color(0xFF6B7280))),
            const SizedBox(height: 24),

            // Approved amount
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
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
                  const Text('APPROVED AMOUNT',
                      style: TextStyle(
                          color: Colors.white60,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.8)),
                  const SizedBox(height: 6),
                  const Text('₹30,000',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 36,
                          fontWeight: FontWeight.w900)),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Loan detail card
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE5E7EB)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.04),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Column(
                children: [
                  _row('Repayment Plan', p['plan']!),
                  _divider(),
                  _row('Tenure', p['tenure']!),
                  _divider(),
                  _row('Interest', p['interest']!),
                  _divider(),
                  _row('Final Amount', p['final']!, highlight: true),
                  _divider(),
                  _row('Total Charges', p['charges']!),
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
                    child: Text('Repayment Schedule',
                        style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                            color: Color(0xFF111827))),
                  ),
                  const Divider(height: 1, color: Color(0xFFF3F4F6)),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('DUE DATE',
                                style: TextStyle(
                                    fontSize: 10,
                                    color: Color(0xFF9CA3AF),
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.8)),
                            SizedBox(height: 4),
                            Text('26 Oct 2026',
                                style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 14,
                                    color: Color(0xFF111827))),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            const Text('AMOUNT',
                                style: TextStyle(
                                    fontSize: 10,
                                    color: Color(0xFF9CA3AF),
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.8)),
                            const SizedBox(height: 4),
                            Text(p['final']!,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 14,
                                    color: Color(0xFF111827))),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
          Text(value,
              style: TextStyle(
                  fontSize: highlight ? 16 : 13,
                  fontWeight: FontWeight.w700,
                  color: highlight ? kNavy : const Color(0xFF111827))),
        ],
      ),
    );
  }

  Widget _divider() =>
      const Divider(height: 1, color: Color(0xFFF3F4F6), indent: 16, endIndent: 16);
}
