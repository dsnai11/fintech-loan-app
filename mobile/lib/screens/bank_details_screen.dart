import 'package:flutter/material.dart';
import '../main.dart';
import 'loan_flow_scaffold.dart';
import 'loan_disbursed_screen.dart';

class BankDetailsScreen extends StatefulWidget {
  const BankDetailsScreen({Key? key}) : super(key: key);

  @override
  State<BankDetailsScreen> createState() => _BankDetailsScreenState();
}

class _BankDetailsScreenState extends State<BankDetailsScreen> {
  final _holderController = TextEditingController(text: 'Suraj Ludhani');
  final _accountController = TextEditingController();
  final _confirmController = TextEditingController();
  final _ifscController = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _holderController.dispose();
    _accountController.dispose();
    _confirmController.dispose();
    _ifscController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_accountController.text.isEmpty ||
        _ifscController.text.isEmpty ||
        _accountController.text != _confirmController.text) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please fill all fields correctly'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    setState(() => _isLoading = true);
    await Future.delayed(const Duration(milliseconds: 1500));
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => const LoanDisbursedScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 6,
      title: 'Bank Details',
      buttonLabel: 'Save & Verify',
      onContinue: _verify,
      isLoading: _isLoading,
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: kNavy.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.account_balance_rounded,
                      color: kNavy, size: 22),
                ),
                const SizedBox(width: 14),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Add your bank account',
                        style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF111827))),
                    SizedBox(height: 2),
                    Text('Used for disbursement & repayment',
                        style: TextStyle(
                            fontSize: 12, color: Color(0xFF6B7280))),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 20),

            loanFieldLabel('ACCOUNT HOLDER NAME'),
            TextField(
              controller: _holderController,
              decoration: const InputDecoration(hintText: 'Full name as per bank'),
            ),

            loanFieldLabel('ACCOUNT NUMBER'),
            TextField(
              controller: _accountController,
              keyboardType: TextInputType.number,
              obscureText: true,
              decoration: const InputDecoration(hintText: 'Enter account number'),
            ),

            loanFieldLabel('CONFIRM ACCOUNT NUMBER'),
            TextField(
              controller: _confirmController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: 'Re-enter account number'),
            ),

            loanFieldLabel('IFSC CODE'),
            TextField(
              controller: _ifscController,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                hintText: 'e.g. SBIN0001234',
                prefixIcon: Icon(Icons.code_rounded,
                    size: 18, color: Color(0xFF9CA3AF)),
              ),
            ),
            const SizedBox(height: 20),

            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: kGreen.withOpacity(0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: kGreen.withOpacity(0.2)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.lock_rounded, color: kGreen, size: 18),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Your bank details are encrypted & secured with 256-bit SSL',
                      style: TextStyle(
                          fontSize: 12,
                          color: Color(0xFF374151),
                          height: 1.4),
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
}
