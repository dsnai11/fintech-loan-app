import 'package:flutter/foundation.dart';
import 'api_service.dart';

// The phone's side of push notifications.
//
// Push alerts need Firebase added to the app build (the steps are in docs/PUSH_SETUP.md). Until that is done this
// reports "not supported" and everything else carries on: alerts still appear in the notification bell inside the app.
//
// When the Firebase build is added, only the three marked spots below change:
//   supported  -> true
//   deviceToken() -> FirebaseMessaging.instance.getToken()
//   requestPermission() -> FirebaseMessaging.instance.requestPermission()
class PushService {
  static final PushService instance = PushService._();
  PushService._();

  bool get supported => false; // <- 1. true once Firebase is in the build

  Future<bool> requestPermission() async {
    if (!supported) return false;
    return false; // <- 2. ask the phone's permission and return whether it was given
  }

  Future<String?> deviceToken() async {
    if (!supported) return null;
    return null; // <- 3. return this phone's Firebase token
  }

  // Tells the company's server which phone to send this customer's alerts to.
  Future<bool> syncToken(ApiService api) async {
    try {
      final token = await deviceToken();
      if (token == null || token.isEmpty) return false;
      await api.registerPushToken(token, defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
      return true;
    } catch (_) {
      return false;
    }
  }
}
