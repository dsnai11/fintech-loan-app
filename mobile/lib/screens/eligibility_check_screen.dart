import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../utils/format.dart';
import 'loan_plan_screen.dart';

// The credit check and the offer that comes from it. The customer agrees to the credit check, the server
// checks their credit record and applies the lender's rules, and the amount they can borrow comes back.
class EligibilityCheckScreen extends StatefulWidget {
  final LoanApplicationState? appState;
  const EligibilityCheckScreen({Key? key, this.appState}) : super(key: key);

  @override
  State<EligibilityCheckScreen> createState() => _EligibilityCheckScreenState();
}

enum _Stage { loading, consent, checking, result, error }

class _EligibilityCheckScreenState extends State<EligibilityCheckScreen> {
  _Stage _stage = _Stage.loading;
  bool _agreed = false;
  String? _error;
  Map<String, dynamic>? _offer;
  int _step = 0;
  Timer? _ticker;

  static const _steps = ['Checking your credit record', 'Applying the lending rules', 'Working out your offer'];

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  // A valid offer from earlier is shown straight away. Otherwise the customer is asked for permission to check.
  Future<void> _start() async {
    try {
      final r = await context.read<ApiService>().getMyOffer();
      if (!mounted) return;
      final o = r['offer'];
      if (o is Map) {
        setState(() {
          _offer = Map<String, dynamic>.from(o);
          _stage = _Stage.result;
        });
      } else {
        setState(() => _stage = _Stage.consent);
      }
    } catch (_) {
      if (mounted) setState(() => _stage = _Stage.consent);
    }
  }

  Future<void> _check() async {
    setState(() {
      _stage = _Stage.checking;
      _step = 0;
      _error = null;
    });
    _ticker = Timer.periodic(const Duration(milliseconds: 900), (_) {
      if (mounted && _step < _steps.length - 1) setState(() => _step++);
    });
    try {
      final started = DateTime.now();
      final r = await context.read<ApiService>().checkEligibility(consent: true);
      // Show the steps for at least a moment, so the check does not flash by.
      final spent = DateTime.now().difference(started).inMilliseconds;
      if (spent < 1800) await Future.delayed(Duration(milliseconds: 1800 - spent));
      _ticker?.cancel();
      if (!mounted) return;
      setState(() {
        _offer = Map<String, dynamic>.from(r['offer'] as Map);
        _stage = _Stage.result;
      });
    } catch (e) {
      _ticker?.cancel();
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _stage = _Stage.error;
      });
    }
  }

  void _continue() {
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => LoanPlanScreen(appState: widget.appState, offer: _offer)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(backgroundColor: Colors.white, foregroundColor: const Color(0xFF111827), elevation: 0),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: switch (_stage) {
            _Stage.loading => const Center(child: CircularProgressIndicator(color: kNavy)),
            _Stage.consent => _consent(),
            _Stage.checking => _checking(),
            _Stage.result => _result(),
            _Stage.error => _errorView(),
          },
        ),
      ),
    );
  }

  Widget _consent() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: kNavy.withOpacity(0.08), shape: BoxShape.circle),
          child: const Icon(Icons.verified_user_outlined, color: kNavy, size: 34),
        ),
        const SizedBox(height: 20),
        const Text('Check how much you can borrow', style: TextStyle(fontSize: 26, height: 1.15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
        const SizedBox(height: 12),
        const Text(
          'We look at your credit record and your details, apply our lending rules, and tell you the most you can borrow. It takes a few seconds and does not commit you to anything.',
          style: TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF6B7280)),
        ),
        const Spacer(),
        GestureDetector(
          onTap: () => setState(() => _agreed = !_agreed),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 22,
              height: 22,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(color: _agreed ? kNavy : Colors.white, border: Border.all(color: _agreed ? kNavy : const Color(0xFFD1D5DB)), borderRadius: BorderRadius.circular(5)),
              child: _agreed ? const Icon(Icons.check, size: 15, color: Colors.white) : null,
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text('I agree that Laxmi India Finance may get my credit record from a credit bureau to work out my loan offer.', style: TextStyle(fontSize: 13, height: 1.45, color: Color(0xFF374151))),
            ),
          ]),
        ),
        const SizedBox(height: 18),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _agreed ? _check : null, child: const Text('Check my eligibility'))),
      ],
    );
  }

  Widget _checking() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(width: 56, height: 56, child: CircularProgressIndicator(color: kNavy, strokeWidth: 4)),
          const SizedBox(height: 28),
          const Text('Checking your eligibility', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
          const SizedBox(height: 24),
          for (var i = 0; i < _steps.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(i < _step ? Icons.check_circle_rounded : Icons.radio_button_unchecked, size: 20, color: i <= _step ? kGreen : const Color(0xFFD1D5DB)),
                const SizedBox(width: 10),
                Text(_steps[i], style: TextStyle(fontSize: 14, color: i <= _step ? const Color(0xFF111827) : const Color(0xFF9CA3AF))),
              ]),
            ),
        ],
      ),
    );
  }

  Widget _result() {
    final o = _offer ?? const {};
    final status = (o['status'] ?? '').toString();
    final amount = asNum(o['amount'] ?? 0);
    if (status == 'DECLINED') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 24),
          const Icon(Icons.info_outline_rounded, size: 52, color: Color(0xFF6B7280)),
          const SizedBox(height: 18),
          const Text('We cannot offer a loan right now', style: TextStyle(fontSize: 24, height: 1.2, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
          const SizedBox(height: 12),
          Text((o['reason'] ?? 'We are not able to offer you a loan at this time.').toString(), style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF6B7280))),
          const Spacer(),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back'))),
        ],
      );
    }
    final review = status == 'REVIEW';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: (review ? const Color(0xFFD97706) : kGreen).withOpacity(0.12), shape: BoxShape.circle),
          child: Icon(review ? Icons.hourglass_top_rounded : Icons.check_circle_rounded, color: review ? const Color(0xFFD97706) : kGreen, size: 34),
        ),
        const SizedBox(height: 20),
        Text(review ? 'You can ask for up to' : 'You can borrow up to', style: const TextStyle(fontSize: 15, color: Color(0xFF6B7280))),
        const SizedBox(height: 4),
        Text(formatMoney(amount), style: const TextStyle(fontSize: 48, height: 1.1, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
        const SizedBox(height: 14),
        Text(
          review
              ? 'Our team will look at your application before it is approved. Choose any amount up to this on the next screen.'
              : 'Choose any amount up to this on the next screen. You will see every charge before you accept.',
          style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF6B7280)),
        ),
        if (o['creditCheck'] == 'sandbox')
          Container(
            margin: const EdgeInsets.only(top: 16),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(10)),
            child: const Text('Test mode: no credit bureau is connected yet, so this offer used a test score.', style: TextStyle(fontSize: 12.5, color: Color(0xFF92400E), height: 1.4)),
          ),
        const Spacer(),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _continue, child: const Text('Choose my amount'))),
      ],
    );
  }

  Widget _errorView() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline_rounded, size: 48, color: Color(0xFFB91C1C)),
          const SizedBox(height: 14),
          Text(_error ?? 'Something went wrong', textAlign: TextAlign.center, style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF374151))),
          const SizedBox(height: 20),
          ElevatedButton(onPressed: _check, child: const Text('Try again')),
        ],
      ),
    );
  }
}
