import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';

// Face ID or fingerprint, to unlock the app instead of typing the PIN. The PIN stays: it is the fallback, and what the customer
// sets up first. Every call is wrapped so a phone without it, or a web browser, simply reports "not available".
class Biometric {
  Biometric._();
  static final LocalAuthentication _auth = LocalAuthentication();

  // True when this phone has Face ID or a fingerprint set up and the app can use it
  static Future<bool> available() async {
    if (kIsWeb) return false;
    try {
      if (!await _auth.isDeviceSupported()) return false;
      final kinds = await _auth.getAvailableBiometrics();
      return kinds.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  // Shows the phone's own prompt. True only when the person was recognised.
  static Future<bool> confirm(String reason) async {
    if (kIsWeb) return false;
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(biometricOnly: true, stickyAuth: true),
      );
    } catch (_) {
      return false;
    }
  }
}
