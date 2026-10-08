import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'api_service.dart';

// The phone's side of push notifications, through Firebase.
//
// It switches itself on only when the app was built with the company's Firebase file (google-services.json for Android,
// GoogleService-Info.plist for iPhone). Without it, `supported` stays false and everything else carries on: alerts
// still appear in the notification bell inside the app. Nothing here can stop the app from starting.
class PushService {
  static final PushService instance = PushService._();
  PushService._();

  bool _ready = false;
  ApiService? _api;

  // Set by the app to open the right screen when a customer taps a notification (for example an offer)
  void Function(Map<String, dynamic> data)? onOpen;

  bool get supported => _ready;

  Future<void> init(ApiService api) async {
    _api = api;
    if (kIsWeb) return;
    try {
      await Firebase.initializeApp().timeout(const Duration(seconds: 8));
      _ready = true;
      FirebaseMessaging.onMessageOpenedApp.listen(_opened); // tapped while the app was in the background
      final first = await FirebaseMessaging.instance.getInitialMessage(); // tapped while the app was closed
      if (first != null) _opened(first);
      FirebaseMessaging.instance.onTokenRefresh.listen(_register);
    } catch (_) {
      _ready = false;
    }
  }

  void _opened(RemoteMessage m) {
    final data = Map<String, dynamic>.from(m.data);
    // Give the app a moment to finish starting before opening a screen
    Future.delayed(const Duration(milliseconds: 900), () => onOpen?.call(data));
  }

  bool _granted(NotificationSettings s) => s.authorizationStatus == AuthorizationStatus.authorized || s.authorizationStatus == AuthorizationStatus.provisional;

  // Has the customer already allowed notifications on this phone?
  Future<bool> isAllowed() async {
    if (!_ready) return false;
    try {
      return _granted(await FirebaseMessaging.instance.getNotificationSettings());
    } catch (_) {
      return false;
    }
  }

  // Asks the phone for permission (Android 13 and newer, and iPhone, show a prompt)
  Future<bool> requestPermission() async {
    if (!_ready) return false;
    try {
      return _granted(await FirebaseMessaging.instance.requestPermission());
    } catch (_) {
      return false;
    }
  }

  Future<void> _register(String token) async {
    try {
      await _api?.registerPushToken(token, defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
    } catch (_) {} // not signed in yet, or offline: it is sent again next time
  }

  // Tells the company's server which phone to send this customer's alerts to.
  Future<bool> syncToken([ApiService? api]) async {
    if (api != null) _api = api;
    if (!_ready) return false;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return false;
      await _api?.registerPushToken(token, defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
      return true;
    } catch (_) {
      return false;
    }
  }

  // Called when the customer opens the app signed in: refreshes the phone's address, but never shows a prompt
  Future<void> syncIfAllowed() async {
    if (await isAllowed()) await syncToken();
  }

  // Called when the customer signs out, so the next person on this phone does not get their alerts
  Future<void> unregister() async {
    if (!_ready) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _api?.unregisterPushToken(token);
    } catch (_) {}
  }
}
