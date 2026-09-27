import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

class OtpScreen extends StatefulWidget {
  final String maskedPhone;
  final String? sandboxOtp;
  final VoidCallback? onVerified;

  const OtpScreen({
    Key? key,
    required this.maskedPhone,
    this.sandboxOtp,
    this.onVerified,
  }) : super(key: key);

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final List<TextEditingController> _ctls = List.generate(6, (_) => TextEditingController());
  final List<FocusNode> _nodes = List.generate(6, (_) => FocusNode());

  bool _isLoading = false;
  bool _isResending = false;
  String? _error;
  int _resendSeconds = 30;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startResendTimer();
    if (widget.sandboxOtp != null) {
      // Pre-fill sandbox OTP for development
      Future.delayed(const Duration(milliseconds: 400), () {
        final digits = widget.sandboxOtp!.split('');
        for (int i = 0; i < digits.length && i < 6; i++) {
          _ctls[i].text = digits[i];
        }
        setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final c in _ctls) c.dispose();
    for (final n in _nodes) n.dispose();
    super.dispose();
  }

  void _startResendTimer() {
    _resendSeconds = 30;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_resendSeconds == 0) {
        t.cancel();
      } else {
        setState(() => _resendSeconds--);
      }
    });
  }

  String get _otp => _ctls.map((c) => c.text).join();

  Future<void> _verify() async {
    if (_otp.length != 6) {
      setState(() => _error = 'Enter all 6 digits');
      return;
    }
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      await api.verifyOtp(_otp);
      if (mounted) {
        if (widget.onVerified != null) {
          widget.onVerified!();
        } else {
          Navigator.of(context).pushReplacementNamed('/home');
        }
      }
    } catch (e) {
      setState(() { _error = friendlyError(e); _isLoading = false; });
    }
  }

  Future<void> _resend() async {
    setState(() { _isResending = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      await api.sendOtp();
      _startResendTimer();
    } catch (e) {
      setState(() => _error = friendlyError(e));
    } finally {
      setState(() => _isResending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('Verify Phone', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: kNavy.withOpacity(0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.sms_rounded, color: kNavy, size: 40),
            ),
            const SizedBox(height: 20),
            const Text('OTP Verification',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
            const SizedBox(height: 8),
            Text(
              'We sent a 6-digit OTP to\n${widget.maskedPhone}',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: Color(0xFF6B7280), height: 1.5),
            ),
            if (widget.sandboxOtp != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF9C3),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFFDE047)),
                ),
                child: Text(
                  'Sandbox OTP: ${widget.sandboxOtp}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF854D0E)),
                ),
              ),
            ],
            const SizedBox(height: 36),

            // OTP boxes
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(6, (i) => Container(
                width: 46,
                height: 54,
                margin: EdgeInsets.only(left: i == 0 ? 0 : 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: _ctls[i].text.isNotEmpty ? kNavy : const Color(0xFFE5E7EB),
                    width: _ctls[i].text.isNotEmpty ? 2 : 1,
                  ),
                  boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 8)],
                ),
                child: TextField(
                  controller: _ctls[i],
                  focusNode: _nodes[i],
                  textAlign: TextAlign.center,
                  keyboardType: TextInputType.number,
                  maxLength: 1,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF111827)),
                  decoration: const InputDecoration(
                    counterText: '',
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    fillColor: Colors.transparent,
                    filled: false,
                  ),
                  onChanged: (v) {
                    setState(() {});
                    if (v.isNotEmpty && i < 5) {
                      _nodes[i + 1].requestFocus();
                    } else if (v.isEmpty && i > 0) {
                      _nodes[i - 1].requestFocus();
                    }
                    if (_otp.length == 6) _verify();
                  },
                ),
              )),
            ),

            if (_error != null) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
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

            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: (_isLoading || _otp.length != 6) ? null : _verify,
                style: ElevatedButton.styleFrom(
                  backgroundColor: kNavy,
                  disabledBackgroundColor: kNavy.withOpacity(0.4),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: _isLoading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('Verify OTP', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ),
            const SizedBox(height: 20),

            if (_resendSeconds > 0)
              Text(
                'Resend OTP in ${_resendSeconds}s',
                style: const TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
              )
            else
              GestureDetector(
                onTap: _isResending ? null : _resend,
                child: Text(
                  _isResending ? 'Sending...' : 'Resend OTP',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: _isResending ? const Color(0xFF9CA3AF) : kNavy,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
