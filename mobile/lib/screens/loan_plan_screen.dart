import 'package:flutter/material.dart';
import '../main.dart';
import 'loan_flow_scaffold.dart';
import 'loan_approved_screen.dart';

class LoanPlanScreen extends StatefulWidget {
  const LoanPlanScreen({Key? key}) : super(key: key);

  @override
  State<LoanPlanScreen> createState() => _LoanPlanScreenState();
}

class _LoanPlanScreenState extends State<LoanPlanScreen> {
  int _selected = 1;

  final _plans = [
    {
      'title': 'One Time Repayment',
      'tag': 'No Interest',
      'tagColor': kGreen,
      'desc': 'Pay the full loan amount in one single payment',
      'amount': '₹30,000',
      'detail': '30 Days',
      'detailLabel': 'Tenure',
    },
    {
      'title': '3-Month EMI Plan',
      'tag': 'Popular',
      'tagColor': const Color(0xFF7C3AED),
      'desc': 'Spread repayment over 3 months with easy EMIs',
      'amount': '₹30,000',
      'detail': '₹10,500 × 3',
      'detailLabel': 'EMI',
    },
    {
      'title': '6-Month EMI Plan',
      'tag': null,
      'tagColor': null,
      'desc': 'Lower monthly payments with a 6-month plan',
      'amount': '₹30,000',
      'detail': '₹5,450 × 6',
      'detailLabel': 'EMI',
    },
  ];

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 4,
      title: 'Choose Your Plan',
      buttonLabel: 'Continue →',
      onContinue: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => LoanApprovedScreen(planIndex: _selected),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: kNavy.withOpacity(0.05),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: const [
                  Icon(Icons.info_outline_rounded, color: kNavy, size: 18),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Need a higher amount? Verify your income to unlock up to ₹2,00,000',
                      style: TextStyle(
                          fontSize: 12,
                          color: kNavy,
                          fontWeight: FontWeight.w500,
                          height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            ...List.generate(_plans.length, (i) {
              final plan = _plans[i];
              final isSelected = _selected == i;
              final tag = plan['tag'] as String?;
              final tagColor = plan['tagColor'] as Color?;
              return GestureDetector(
                onTap: () => setState(() => _selected = i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: isSelected ? kNavy : const Color(0xFFE5E7EB),
                      width: isSelected ? 2 : 1,
                    ),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: kNavy.withOpacity(0.1),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            )
                          ]
                        : [],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              plan['title'] as String,
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: isSelected
                                    ? kNavy
                                    : const Color(0xFF111827),
                              ),
                            ),
                          ),
                          if (tag != null)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: tagColor!.withOpacity(0.12),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                tag,
                                style: TextStyle(
                                    color: tagColor,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700),
                              ),
                            ),
                          const SizedBox(width: 8),
                          Container(
                            width: 20,
                            height: 20,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isSelected ? kNavy : Colors.transparent,
                              border: Border.all(
                                  color: isSelected
                                      ? kNavy
                                      : const Color(0xFFD1D5DB),
                                  width: 2),
                            ),
                            child: isSelected
                                ? const Icon(Icons.check_rounded,
                                    color: Colors.white, size: 12)
                                : null,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        plan['desc'] as String,
                        style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF6B7280),
                            height: 1.4),
                      ),
                      const SizedBox(height: 12),
                      const Divider(color: Color(0xFFF3F4F6)),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('AMOUNT',
                                    style: TextStyle(
                                        fontSize: 10,
                                        color: Color(0xFF9CA3AF),
                                        fontWeight: FontWeight.w600,
                                        letterSpacing: 0.8)),
                                const SizedBox(height: 3),
                                Text(plan['amount'] as String,
                                    style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w800,
                                        color: Color(0xFF111827))),
                              ],
                            ),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  plan['detailLabel'] as String,
                                  style: const TextStyle(
                                      fontSize: 10,
                                      color: Color(0xFF9CA3AF),
                                      fontWeight: FontWeight.w600,
                                      letterSpacing: 0.8),
                                ),
                                const SizedBox(height: 3),
                                Text(plan['detail'] as String,
                                    style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w800,
                                        color: Color(0xFF111827))),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}
