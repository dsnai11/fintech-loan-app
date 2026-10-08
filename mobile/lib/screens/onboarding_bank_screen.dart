import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'setup_scaffold.dart';

// The bank account the loan will be paid into. Asked once, here, and again only if the customer changes it.
class OnboardingBankScreen extends StatefulWidget {
  final int step;
  final bool fromProfile;
  const OnboardingBankScreen({Key? key, this.step = 4, this.fromProfile = false}) : super(key: key);

  @override
  State<OnboardingBankScreen> createState() => _OnboardingBankScreenState();
}

class _OnboardingBankScreenState extends State<OnboardingBankScreen> {
  final _holder = TextEditingController();
  final _number = TextEditingController();
  final _again = TextEditingController();
  final _ifsc = TextEditingController();
  bool _saving = false;
  String? _error;
  String? _bankName;

  @override
  void initState() {
    super.initState();
    _prefill();
  }

  @override
  void dispose() {
    for (final c in [_holder, _number, _again, _ifsc]) {
      c.dispose();
    }
    super.dispose();
  }

  // The account holder is almost always the customer, so start with their name.
  Future<void> _prefill() async {
    try {
      final p = await context.read<ApiService>().getUserProfile();
      if (mounted && _holder.text.isEmpty) _holder.text = '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim();
    } catch (_) {}
  }

  Future<void> _save() async {
    final number = _number.text.trim();
    final ifsc = _ifsc.text.trim().toUpperCase();
    if (_holder.text.trim().length < 3) return setState(() => _error = 'Enter the name on the bank account');
    if (!RegExp(r'^\d{9,18}$').hasMatch(number)) return setState(() => _error = 'Enter the account number, 9 to 18 digits');
    if (number != _again.text.trim()) return setState(() => _error = 'The two account numbers do not match');
    if (!RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$').hasMatch(ifsc)) return setState(() => _error = 'Enter a valid IFSC code, like SBIN0001234');
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final r = await context.read<ApiService>().verifyBank(accountNumber: number, ifscCode: ifsc, accountHolder: _holder.text.trim());
      if (!mounted) return;
      setState(() => _bankName = (r['bank'] is Map ? (r['bank'] as Map)['bankName'] : null)?.toString());
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _saving = false;
      });
    }
  }

  Widget _label(String t) => Padding(padding: const EdgeInsets.only(bottom: 6, top: 14), child: Text(t, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF6B7280))));

  @override
  Widget build(BuildContext context) {
    return SetupScaffold(
      step: widget.step,
      canSkip: !widget.fromProfile,
      title: 'Your bank account',
      subtitle: 'Your loan is sent here. The account must be in your own name.',
      bottom: Column(mainAxisSize: MainAxisSize.min, children: [
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13))),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Checking...' : 'Save bank account'))),
      ]),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _label('NAME ON THE ACCOUNT'),
          TextField(controller: _holder, textCapitalization: TextCapitalization.words),
          _label('ACCOUNT NUMBER'),
          TextField(controller: _number, keyboardType: TextInputType.number, obscureText: true, maxLength: 18, decoration: const InputDecoration(counterText: '')),
          _label('ENTER IT AGAIN'),
          TextField(controller: _again, keyboardType: TextInputType.number, maxLength: 18, decoration: const InputDecoration(counterText: '')),
          _label('IFSC CODE'),
          TextField(controller: _ifsc, textCapitalization: TextCapitalization.characters, maxLength: 11, decoration: const InputDecoration(hintText: 'SBIN0001234', counterText: '')),
          if (_bankName != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_bankName!, style: const TextStyle(color: kGreen, fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}
