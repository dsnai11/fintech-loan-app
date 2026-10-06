import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'terms_screen.dart' show kDarkBg, kDarkCard, kDarkLine, kDarkMuted;

// The phone check: six boxes, the code is checked as soon as the last digit goes in, and the keyboard offers the
// code from the SMS on phones that support it. Sends nothing by itself: the caller has already asked for a code.
class OtpScreen extends StatefulWidget {
  final String maskedPhone;
  final String? sandboxOtp;
  final VoidCallback? onVerified;

  const OtpScreen({Key? key, required this.maskedPhone, this.sandboxOtp, this.onVerified}) : super(key: key);

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final _field = TextEditingController();
  final _focus = FocusNode();

  bool _verifying = false;
  bool _resending = false;
  String? _error;
  int _wait = 30;
  Timer? _timer;
  String? _sandboxOtp;

  @override
  void initState() {
    super.initState();
    _sandboxOtp = widget.sandboxOtp;
    _startTimer(30);
    _field.addListener(() => setState(() {}));
    // With no SMS provider set up the server hands the code back so the flow can be tried.
    if (_sandboxOtp != null) {
      Future.delayed(const Duration(milliseconds: 600), () {
        if (mounted && _sandboxOtp != null) {
          _field.text = _sandboxOtp!;
          _verify();
        }
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _field.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _wait = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_wait <= 1) {
        t.cancel();
        if (mounted) setState(() => _wait = 0);
      } else if (mounted) {
        setState(() => _wait--);
      }
    });
  }

  Future<void> _verify() async {
    final code = _field.text.trim();
    if (code.length != 6 || _verifying) return;
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      await context.read<ApiService>().verifyOtp(code);
      HapticFeedback.mediumImpact();
      if (!mounted) return;
      if (widget.onVerified != null) {
        widget.onVerified!();
      } else {
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } catch (e) {
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _verifying = false;
      });
      _field.clear();
      _focus.requestFocus();
    }
  }

  Future<void> _resend() async {
    setState(() {
      _resending = true;
      _error = null;
    });
    try {
      final r = await context.read<ApiService>().sendOtp();
      _field.clear();
      _sandboxOtp = r['sandboxOtp']?.toString();
      _startTimer(((r['resendAfterSeconds'] as num?) ?? 30).toInt());
      if (_sandboxOtp != null) {
        _field.text = _sandboxOtp!;
        _verify();
      }
    } catch (e) {
      setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  String get _clock => '0:${_wait.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final code = _field.text;
    return Scaffold(
      backgroundColor: kDarkBg,
      appBar: AppBar(backgroundColor: kDarkBg, foregroundColor: Colors.white, elevation: 0),
      body: SafeArea(
        child: GestureDetector(
          onTap: () => _focus.requestFocus(),
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Verify your number', style: TextStyle(color: Colors.white, fontSize: 30, height: 1.15, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                Text('Enter the 6-digit code we sent by SMS to ${widget.maskedPhone}', style: const TextStyle(color: kDarkMuted, fontSize: 15, height: 1.5)),
                const SizedBox(height: 32),

                // One real text field, invisible, so the keyboard can suggest the code from the SMS.
                SizedBox(
                  height: 0,
                  width: 0,
                  child: TextField(
                    controller: _field,
                    focusNode: _focus,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                    onChanged: (v) {
                      if (v.length == 6) _verify();
                    },
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: List.generate(6, (i) {
                    final filled = i < code.length;
                    final active = i == code.length && !_verifying;
                    return Container(
                      width: (MediaQuery.of(context).size.width - 48 - 5 * 10) / 6,
                      height: 60,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: kDarkCard,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: _error != null ? const Color(0xFFFF6B6B) : active ? kGreen : kDarkLine, width: active ? 1.8 : 1),
                      ),
                      child: Text(filled ? code[i] : '', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700)),
                    );
                  }),
                ),
                const SizedBox(height: 16),
                if (_error != null) Text(_error!, style: const TextStyle(color: Color(0xFFFF8A8A), fontSize: 13.5, height: 1.4)),
                if (_sandboxOtp != null && _error == null)
                  Container(
                    margin: const EdgeInsets.only(top: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: const Color(0xFF2A2412), borderRadius: BorderRadius.circular(10)),
                    child: const Text('Test mode: no SMS provider is set up yet, so the code was filled in for you.', style: TextStyle(color: Color(0xFFF0C766), fontSize: 12.5, height: 1.4)),
                  ),
                const SizedBox(height: 20),
                if (_verifying)
                  Row(children: const [
                    SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: kGreen)),
                    SizedBox(width: 10),
                    Text('Checking...', style: TextStyle(color: kDarkMuted)),
                  ])
                else if (_wait > 0)
                  Text('Resend code in $_clock', style: const TextStyle(color: kDarkMuted, fontSize: 14))
                else
                  GestureDetector(
                    onTap: _resending ? null : _resend,
                    child: Text(_resending ? 'Sending...' : 'Send a new code', style: const TextStyle(color: kGreen, fontSize: 14.5, fontWeight: FontWeight.w700)),
                  ),
                const Spacer(),
                const Text('We will never ask you to share this code with anyone, including our staff.', style: TextStyle(color: kDarkMuted, fontSize: 12.5, height: 1.4)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
