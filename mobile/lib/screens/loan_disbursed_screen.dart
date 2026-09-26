import 'package:flutter/material.dart';
import '../main.dart';

class LoanDisbursedScreen extends StatefulWidget {
  const LoanDisbursedScreen({Key? key}) : super(key: key);

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
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _scaleAnim = CurvedAnimation(parent: _ctrl, curve: Curves.elasticOut);
    _fadeAnim = CurvedAnimation(parent: _ctrl, curve: Curves.easeIn);
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w700)),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Text('7 / 7',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600)),
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
                      const SizedBox(height: 16),

                      // Animated checkmark
                      ScaleTransition(
                        scale: _scaleAnim,
                        child: Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: kGreen.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.check_circle_rounded,
                              color: kGreen, size: 64),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text('Loan Disbursed! 🎉',
                          style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF111827))),
                      const SizedBox(height: 8),
                      const Text(
                        'Loan amount will be credited to your bank\naccount within 24 working hours.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 14,
                            color: Color(0xFF6B7280),
                            height: 1.5),
                      ),
                      const SizedBox(height: 24),

                      // Amount summary card
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
                            const Padding(
                              padding: EdgeInsets.all(20),
                              child: Column(
                                children: [
                                  Text('FINAL PAYMENT AMOUNT',
                                      style: TextStyle(
                                          color: Colors.white60,
                                          fontSize: 11,
                                          fontWeight: FontWeight.w600,
                                          letterSpacing: 0.8)),
                                  SizedBox(height: 6),
                                  Text('₹29,115',
                                      style: TextStyle(
                                          color: Colors.white,
                                          fontSize: 36,
                                          fontWeight: FontWeight.w900)),
                                ],
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 20, vertical: 16),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.08),
                                borderRadius: const BorderRadius.vertical(
                                    bottom: Radius.circular(16)),
                              ),
                              child: Column(
                                children: [
                                  _summaryRow('Approved Amount', '₹30,000'),
                                  _summaryRow('Processing Fees', '- ₹750'),
                                  _summaryRow('GST (18%)', '- ₹135'),
                                  const SizedBox(height: 8),
                                  _summaryRow('Payment Status', 'Pending',
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
                                  style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14,
                                      color: Color(0xFF111827))),
                            ),
                            const Divider(height: 1, color: Color(0xFFF3F4F6)),
                            Padding(
                              padding: const EdgeInsets.all(16),
                              child: Row(
                                children: [
                                  Container(
                                    width: 32,
                                    height: 32,
                                    decoration: BoxDecoration(
                                      color: kNavy.withOpacity(0.08),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Center(
                                      child: Text('1',
                                          style: TextStyle(
                                              color: kNavy,
                                              fontWeight: FontWeight.w700,
                                              fontSize: 14)),
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  const Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text('26 Oct 2026',
                                            style: TextStyle(
                                                fontWeight: FontWeight.w600,
                                                fontSize: 14,
                                                color: Color(0xFF111827))),
                                        SizedBox(height: 2),
                                        Text('Auto-debit',
                                            style: TextStyle(
                                                fontSize: 12,
                                                color: Color(0xFF6B7280))),
                                      ],
                                    ),
                                  ),
                                  const Text('₹30,000',
                                      style: TextStyle(
                                          fontWeight: FontWeight.w800,
                                          fontSize: 16,
                                          color: Color(0xFF111827))),
                                ],
                              ),
                            ),
                            const Padding(
                              padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                              child: Text(
                                'On-time payments help build your credit score.',
                                style: TextStyle(
                                    fontSize: 12,
                                    color: Color(0xFF9CA3AF),
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
                          onPressed: () {
                            Navigator.of(context).pushNamedAndRemoveUntil(
                                '/home', (_) => false);
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: kNavy,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14)),
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          child: const Text('Back to Home',
                              style: TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w700)),
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

  Widget _summaryRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: const TextStyle(color: Colors.white60, fontSize: 13)),
          Text(value,
              style: TextStyle(
                  color: valueColor ?? Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
