import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import 'loan_flow_scaffold.dart';
import 'loan_disbursed_screen.dart';
import '../utils/error_utils.dart';
import '../widgets/form_inputs.dart';
import '../data/indian_data.dart';

class BankDetailsScreen extends StatefulWidget {
  final LoanApplicationState appState;

  const BankDetailsScreen({Key? key, required this.appState}) : super(key: key);

  @override
  State<BankDetailsScreen> createState() => _BankDetailsScreenState();
}

class _BankDetailsScreenState extends State<BankDetailsScreen> {
  final _holderController = TextEditingController();
  final _accountController = TextEditingController();
  final _confirmController = TextEditingController();
  final _ifscController = TextEditingController();

  bool _isLoading = false;
  bool _isVerifyingIfsc = false;
  String? _error;
  String? _bankName;
  String? _branchInfo;
  bool _bankVerified = false;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    try {
      final auth = context.read<AuthService>();
      final user = auth.user;
      if (user != null) {
        final name = '${user['firstName'] ?? ''} ${user['lastName'] ?? ''}'.trim();
        if (name.isNotEmpty) _holderController.text = name;
        if (user['bankAccount'] != null) {
          final bank = user['bankAccount'] as Map;
          if (bank['accountNumber'] != null) _accountController.text = bank['accountNumber'];
          if (bank['ifscCode'] != null) {
            _ifscController.text = bank['ifscCode'];
            _bankName = bank['bankName'];
          }
        }
        setState(() {});
      }
    } catch (_) {}
  }

  static final _ifscRegex = RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$');

  Future<void> _lookupIfsc() async {
    final ifsc = _ifscController.text.trim().toUpperCase();
    if (ifsc.length != 11) return;
    if (!_ifscRegex.hasMatch(ifsc)) {
      setState(() { _bankName = null; _branchInfo = null; _error = 'Invalid IFSC format. Must be like SBIN0001234 (5th character is always 0).'; });
      return;
    }
    setState(() { _isVerifyingIfsc = true; _bankName = null; _branchInfo = null; _error = null; });
    try {
      final api = context.read<ApiService>();
      final result = await api.verifyBank(
        accountNumber: _accountController.text.trim().isEmpty ? '000000000000' : _accountController.text.trim(),
        ifscCode: ifsc,
        accountHolder: _holderController.text.trim().isEmpty ? 'Account Holder' : _holderController.text.trim(),
      );
      setState(() {
        _bankName = result['bank']?['bankName'];
        final b = result['branch'];
        if (b != null) _branchInfo = '${b['branch'] ?? ''}, ${b['city'] ?? ''}';
        _bankVerified = result['verified'] == true;
      });
    } catch (e) {
      setState(() { _bankName = null; _error = friendlyError(e); });
    } finally {
      setState(() => _isVerifyingIfsc = false);
    }
  }

  Future<void> _submit() async {
    final acc = _accountController.text.trim();
    final ifsc = _ifscController.text.trim().toUpperCase();
    final holder = _holderController.text.trim();

    if (holder.isEmpty || acc.isEmpty || ifsc.isEmpty) {
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
    if (!_ifscRegex.hasMatch(ifsc)) {
      setState(() => _error = 'Invalid IFSC format. Must be like SBIN0001234 (5th character is always 0).');
      return;
    }

    setState(() { _isLoading = true; _error = null; });

    try {
      final api = context.read<ApiService>();

      // Verify bank and submit loan together
      await api.verifyBank(accountNumber: acc, ifscCode: ifsc, accountHolder: holder);

      final result = await api.applyLoanFull(
        loanAmount: widget.appState.loanAmount,
        tenure: widget.appState.tenure,
        purpose: 'Personal',
        planType: widget.appState.planType,
        optionalCharges: widget.appState.optionalCharges,
        bankDetails: { 'accountHolder': holder, 'accountNumber': acc, 'ifscCode': ifsc },
        personalDetails: {
          'gender': widget.appState.gender,
          'pincode': widget.appState.pincode,
          'address': widget.appState.address,
        },
      );

      if (mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => LoanDisbursedScreen(loanData: result['loan'])),
        );
      }
    } catch (e) {
      setState(() { _error = friendlyError(e); _isLoading = false; });
    }
  }

  @override
  void dispose() {
    _holderController.dispose();
    _accountController.dispose();
    _confirmController.dispose();
    _ifscController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 6,
      title: 'Bank Details',
      buttonLabel: 'Submit Application',
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
                  decoration: BoxDecoration(color: kNavy.withOpacity(0.08), borderRadius: BorderRadius.circular(12)),
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
              textCapitalization: TextCapitalization.words,
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
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _ifscController,
                  textCapitalization: TextCapitalization.characters,
                  onChanged: (v) {
                    if (v.length == 11) _lookupIfsc();
                    setState(() { _bankName = null; _bankVerified = false; });
                  },
                  decoration: InputDecoration(
                    hintText: 'e.g. SBIN0001234',
                    prefixIcon: const Icon(Icons.code_rounded, size: 18, color: Color(0xFF9CA3AF)),
                    suffixIcon: _isVerifyingIfsc
                        ? const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                          )
                        : _bankVerified
                            ? const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 20)
                            : null,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Or select from common banks:',
                  style: TextStyle(fontSize: 12, color: Color(0xFF6B7280), fontWeight: FontWeight.w500),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: commonIfscCodes
                        .map((item) => Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ElevatedButton(
                                onPressed: () {
                                  _ifscController.text = item['code']!;
                                  _lookupIfsc();
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFFF9FAFB),
                                  foregroundColor: kNavy,
                                  elevation: 0,
                                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                                ),
                                child: Text(
                                  item['bank']!.split(' ').first,
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ),
                            ))
                        .toList(),
                  ),
                ),
              ],
            ),

            if (_bankName != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0FFF4),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF86EFAC)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.account_balance_rounded, color: Color(0xFF16A34A), size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_bankName!, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFF166534))),
                          if (_branchInfo != null && _branchInfo!.trim() != ',')
                            Text(_branchInfo!, style: const TextStyle(fontSize: 11, color: Color(0xFF16A34A))),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],

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
                    Expanded(child: Text(_error!, style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13))),
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
