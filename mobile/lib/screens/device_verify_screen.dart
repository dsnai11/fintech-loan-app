import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';
import '../widgets/ui_kit.dart';

// Signing in from a phone this account has not used before: we send a code to the number on the account, and the customer enters it.
// Only the person who holds that phone number gets in, even if someone else learned the password.
class DeviceVerifyScreen extends StatefulWidget {
  const DeviceVerifyScreen({Key? key}) : super(key: key);

  @override
  State<DeviceVerifyScreen> createState() => _DeviceVerifyScreenState();
}

class _DeviceVerifyScreenState extends State<DeviceVerifyScreen> {
  final _code = TextEditingController();
  Timer? _tick;
  int _wait = 0;
  bool _sending = false;
  bool _verifying = false;
  String? _error;
  String? _note;

  String get _token => '${context.read<AuthService>().pendingDevice?['deviceToken'] ?? ''}';
  String get _phone => '${context.read<AuthService>().pendingDevice?['phone'] ?? ''}';

  @override
  void initState() {
    super.initState();
    Future.microtask(_send);
  }

  @override
  void dispose() {
    _tick?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startWait(int seconds) {
    _tick?.cancel();
    setState(() => _wait = seconds);
    _tick = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _wait = _wait - 1);
      if (_wait <= 0) t.cancel();
    });
  }

  Future<void> _send() async {
    setState(() { _sending = true; _error = null; });
    try {
      final r = await context.read<ApiService>().sendDeviceCode(_token);
      if (!mounted) return;
      setState(() {
        _note = r['sandboxOtp'] != null ? 'Test mode: your code is ${r['sandboxOtp']}' : 'We sent a code to ${r['phone'] ?? _phone}.';
      });
      _startWait((r['resendAfterSeconds'] as num?)?.toInt() ?? 30);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
    if (mounted) setState(() => _sending = false);
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (code.length != 6) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() { _verifying = true; _error = null; });
    try {
      final r = await context.read<ApiService>().verifyDeviceCode(_token, code);
      await context.read<AuthService>().completeDeviceLogin(r);
      if (mounted) Navigator.of(context).pop(true);
      return;
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
    if (mounted) setState(() => _verifying = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(title: const Text('Confirm it is you')),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        const SizedBox(height: 8),
        Center(
          child: Container(
            width: 84,
            height: 84,
            decoration: BoxDecoration(color: kNavy.withOpacity(0.10), shape: BoxShape.circle),
            child: const Icon(Icons.phonelink_lock_rounded, color: kNavy, size: 42),
          ),
        ),
        const SizedBox(height: 20),
        const Center(child: Text('You are signing in on a new phone', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: kInk))),
        const SizedBox(height: 8),
        Center(
          child: Text(
            'For your safety we need to check that this is you. We send a code to the number registered with us${_phone.isEmpty ? '' : ' ($_phone)'}.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13.5, color: kMuted, height: 1.5),
          ),
        ),
        const SizedBox(height: 24),
        AppCard(
          padding: const EdgeInsets.all(18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (_note != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_note!, style: const TextStyle(fontSize: 12.5, color: kGood, fontWeight: FontWeight.w600))),
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 26, letterSpacing: 8, fontWeight: FontWeight.w700),
              decoration: const InputDecoration(counterText: '', hintText: '------'),
              onSubmitted: (_) => _verify(),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12.5))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _verifying ? null : _verify, child: Text(_verifying ? 'Checking...' : 'Confirm and sign in'))),
            const SizedBox(height: 6),
            Center(
              child: TextButton(
                onPressed: (_sending || _wait > 0) ? null : _send,
                child: Text(_wait > 0 ? 'Send the code again in ${_wait}s' : 'Send the code again'),
              ),
            ),
          ]),
        ),
        const SizedBox(height: 14),
        const Text('If you did not try to sign in, do not share the code with anyone. Change your password.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11.5, color: kMuted, height: 1.4)),
      ]),
    );
  }
}
