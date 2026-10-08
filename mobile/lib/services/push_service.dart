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
  String? initError; // why Firebase could not start, if it could not
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
    } catch (e) {
      _ready = false;
      initError = e.toString().split('\n').first;
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

  // A plain list of what is and is not working on this phone, for the Notifications screen
  Future<List<List<String>>> diagnose(ApiService api) async {
    _api = api;
    final rows = <List<String>>[];
    rows.add(['Notifications built into this app', _ready ? 'yes' : 'no: ${initError ?? 'Firebase did not start. This app was probably built without the Firebase file.'}']);
    if (!_ready) return rows;
    final allowed = await isAllowed();
    rows.add(['Permission on this phone', allowed ? 'allowed' : 'not allowed yet. Tap "Turn on notifications" and choose Allow.']);
    String? token;
    try {
      token = await FirebaseMessaging.instance.getToken();
      rows.add(['This phone\'s notification address', token == null || token.isEmpty ? 'not received from Google yet' : 'received']);
    } catch (e) {
      rows.add(['This phone\'s notification address', 'failed: ${e.toString().split('\n').first}']);
    }
    if (token != null && token.isNotEmpty) {
      try {
        await api.registerPushToken(token, defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
        rows.add(['Registered with LIFC', 'yes']);
      } catch (e) {
        rows.add(['Registered with LIFC', 'failed: $e']);
      }
    }
    return rows;
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
