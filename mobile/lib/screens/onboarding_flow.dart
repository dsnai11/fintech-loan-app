import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'account_setup_flow.dart';
import 'otp_screen.dart';
import 'terms_screen.dart';

// Asks for a code, then shows the code window. Returns true once the number is verified.
Future<bool> verifyPhone(BuildContext context) async {
  final api = context.read<ApiService>();
  final nav = Navigator.of(context);
  final messenger = ScaffoldMessenger.of(context);
  Map<String, dynamic> sent;
  try {
    sent = await api.sendOtp();
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    return false;
  }
  if (sent['alreadyVerified'] == true) return true;
  final ok = await nav.push<bool>(MaterialPageRoute(
    builder: (_) => OtpScreen(
      maskedPhone: (sent['phone'] ?? '').toString(),
      sandboxOtp: sent['sandboxOtp']?.toString(),
      onVerified: () => nav.pop(true),
    ),
  ));
  return ok == true;
}

// What happens after signing in, or opening the app while signed in: accept the current terms if needed, check
// the phone number, then go home. The server says what is still outstanding. If it cannot be reached the
// customer goes straight home, and the server still enforces both before any loan application.
Future<void> continueToHome(BuildContext context) async {
  final api = context.read<ApiService>();
  final nav = Navigator.of(context);
  Map<String, dynamic>? status;
  try {
    status = await api.getOnboarding();
  } catch (_) {}

  if (status != null && status['termsRequired'] == true) {
    final ok = await nav.push<bool>(MaterialPageRoute(builder: (_) => const TermsScreen(mustAccept: true)));
    if (ok != true) return;
  }
  if (status != null && status['phoneVerified'] != true && context.mounted) {
    await verifyPhone(context); // skipping is allowed; the home screen keeps reminding
  }
  // Then the account set-up (identity, details, selfie, bank). Skipping is allowed; the home screen keeps reminding.
  final setup = status?['setup'];
  if (setup is Map && setup['complete'] != true && context.mounted) {
    await runAccountSetup(context, Map<String, dynamic>.from(setup));
  }
  nav.pushNamedAndRemoveUntil('/home', (_) => false);
}
