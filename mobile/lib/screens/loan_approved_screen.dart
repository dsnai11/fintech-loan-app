import 'package:flutter/material.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../utils/format.dart';
import 'loan_flow_scaffold.dart';
import 'bank_details_screen.dart';

// The offer, with every charge spelled out (a Key Fact Statement) before the customer commits.
// It is an offer only: nothing is approved until the lender has verified the application.
class LoanApprovedScreen extends StatelessWidget {
  final Map<String, dynamic> quote;
  final LoanApplicationState appState;

  const LoanApprovedScreen({Key? key, required this.quote, required this.appState}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final q = quote;
    final months = asNum(q['tenureMonths']).toInt();
    final rate = formatPercent(asNum(q['interestRatePercent']));
    final interestText = q['interestType'] == 'flat'
        ? (asNum(q['interestRatePercent']) == 0 ? 'No interest' : '$rate% flat')
        : '$rate% a year';
    final lateFee = (q['lateFee'] as Map?) ?? const {};
    final coolingOff = asNum(q['coolingOffDays']).toInt();

    return LoanFlowScaffold(
      step: 5,
      title: 'Your Loan Offer',
      buttonLabel: 'Proceed to Bank Details →',
      onContinue: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => BankDetailsScreen(appState: appState)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: kNavy.withOpacity(0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.receipt_long_rounded, color: kNavy, size: 48),
            ),
            const SizedBox(height: 16),
            const Text('Here is your offer',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
            const SizedBox(height: 4),
            const Text('Final approval follows verification of your details',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: Color(0xFF6B7280))),
            const SizedBox(height: 24),

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
                  const Text('LOAN AMOUNT',
                      style: TextStyle(
                          color: Colors.white60,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.8)),
                  const SizedBox(height: 6),
                  Text(formatMoney(asNum(q['amount'])),
                      style: const TextStyle(
                          color: Colors.white, fontSize: 36, fontWeight: FontWeight.w900)),
                ],
              ),
            ),
            const SizedBox(height: 16),

            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: Column(
                children: [
                  _row('Repayment plan', q['label'].toString()),
                  _divider(),
                  _row('Tenure', months == 1 ? '1 month' : '$months months'),
                  _divider(),
                  _row('Interest', interestText),
                  _divider(),
                  _row('Processing fee (${formatPercent(asNum(q['processingFeePercent']))}%)',
                      '- ${formatMoney(asNum(q['processingFee']))}'),
                  _divider(),
                  _row('GST (${formatPercent(asNum(q['gstPercent']))}%)', '- ${formatMoney(asNum(q['gst']))}'),
                  _divider(),
                  _row('You receive', formatMoney(asNum(q['netDisbursed'])), highlight: true),
                  _divider(),
                  _row(months == 1 ? 'You repay' : 'EMI',
                      months == 1 ? formatMoney(asNum(q['emi'])) : '${formatMoney(asNum(q['emi']))} × $months'),
                  _divider(),
                  _row('Total interest', formatMoney(asNum(q['totalInterest']))),
                  _divider(),
                  _row('Total you repay', formatMoney(asNum(q['totalRepayable'])), highlight: true),
                  _divider(),
                  _row('APR (all costs)', '${formatPercent(asNum(q['aprPercent']))}%'),
                ],
              ),
            ),
            const SizedBox(height: 16),

            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFF9FAFB),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Good to know',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: Color(0xFF111827))),
                  const SizedBox(height: 8),
                  _note('The first instalment is due about 1 month after the money reaches your bank account.'),
                  _note(
                      'Late payment: ${formatPercent(asNum(lateFee['percentPerMonth']))}% of the instalment for each month late, minimum ${formatMoney(asNum(lateFee['minimum']))}.'),
                  _note(
                      'Closing early: ${formatPercent(asNum(q['foreclosureFeePercent']))}% of the principal still owed, plus interest to date.'),
                  if (coolingOff > 0)
                    _note(
                        'Changed your mind? You can cancel within $coolingOff day(s) of receiving the money. You return what you received plus interest for the days you had it.'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _note(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text('•  $text',
          style: const TextStyle(fontSize: 12, color: Color(0xFF4B5563), height: 1.45)),
    );
  }

  Widget _row(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(label, style: const TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
          ),
          const SizedBox(width: 12),
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
