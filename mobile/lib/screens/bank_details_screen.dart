import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../services/api_service.dart';
import 'loan_flow_scaffold.dart';
import 'loan_disbursed_screen.dart';

class BankDetailsScreen extends StatefulWidget {
  final LoanApplicationState appState;

  const BankDetailsScreen({Key? key, required this.appState}) : super(key: key);

  @override
  State<BankDetailsScreen> createState() => _BankDetailsScreenState();
}

class _BankDetailsScreenState extends State<BankDetailsScreen> {
  final _holderController = TextEditingController(text: 'Suraj Ludhani');
  final _accountController = TextEditingController();
  final _confirmController = TextEditingController();
  final _ifscController = TextEditingController();
  bool _isLoading = false;
  String? _error;

  @override
  void dispose() {
    _holderController.dispose();
    _accountController.dispose();
    _confirmController.dispose();
    _ifscController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final acc = _accountController.text.trim();
    final ifsc = _ifscController.text.trim().toUpperCase();

    if (acc.isEmpty || ifsc.isEmpty) {
      setState(() => _error = 'Please fill in all fields');
      return;
    }
    if (acc != _confirmController.text.trim()) {
      setState(() => _error = 'Account numbers do not match');
      return;
    }
    if (ifsc.length != 11) {
      setState(() => _error = 'IFSC code must be 11 characters');
      return;
    }

    setState(() { _isLoading = true; _error = null; });

    try {
      final api = context.read<ApiService>();

      // Submit the full loan application
      final result = await api.applyLoanFull(
        loanAmount: widget.appState.loanAmount,
        tenure: widget.appState.tenure,
        purpose: 'Personal',
        planType: widget.appState.planType,
        bankDetails: {
          'accountHolder': _holderController.text.trim(),
          'accountNumber': acc,
          'ifscCode': ifsc,
        },
        personalDetails: {
          'gender': widget.appState.gender,
          'pincode': widget.appState.pincode,
          'address': widget.appState.address,
        },
      );

      if (mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => LoanDisbursedScreen(loanData: result['loan']),
          ),
        );
      }
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 6,
      title: 'Bank Details',
      buttonLabel: 'Save & Verify',
      onContinue: _submit,
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
                  child: const Icon(Icons.account_balance_rounded, color: kNavy, size: 22),
                ),
                const SizedBox(width: 14),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Add your bank account',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
                    SizedBox(height: 2),
                    Text('Used for disbursement & repayment',
                        style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
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
                prefixIcon: Icon(Icons.code_rounded, size: 18, color: Color(0xFF9CA3AF)),
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFCA5A5)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(_error!,
                          style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                    ),
                  ],
                ),
              ),
            ],

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
                      style: TextStyle(fontSize: 12, color: Color(0xFF374151), height: 1.4),
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
