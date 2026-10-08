import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'onboarding_bank_screen.dart';
import 'onboarding_kyc_screen.dart';
import 'onboarding_profile_screen.dart';
import 'selfie_liveness_screen.dart';

// Account set-up, step by step: identity through DigiLocker, personal details, a selfie with a blink check, and the
// bank account. Steps already done are skipped. Returns true when everything is done. "Not now" on any step stops
// the walk-through; the home screen then reminds the customer to finish before they can apply for a loan.
Future<bool> runAccountSetup(BuildContext context, Map<String, dynamic> setup) async {
  final nav = Navigator.of(context);
  Future<bool> go(Widget screen) async => (await nav.push<bool>(MaterialPageRoute(builder: (_) => screen))) == true;

  if (setup['kyc'] != true && !await go(const OnboardingKycScreen())) return false;
  if (setup['profile'] != true && !await go(const OnboardingProfileScreen(step: 2))) return false;
  if (setup['selfie'] != true && !await go(const SelfieLivenessScreen(step: 3))) return false;
  if (setup['bank'] != true && !await go(const OnboardingBankScreen(step: 4))) return false;
  return true;
}

bool setupComplete(Map<String, dynamic>? setup) => setup != null && setup['complete'] == true;
