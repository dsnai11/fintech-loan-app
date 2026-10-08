import 'api_service.dart';

// The iPhone build uses this in place of push_service.dart (the build copies it over), because the Firebase push plugin
// does not yet fit alongside the face-detection library on iPhone, and the unsigned iPhone build cannot receive pushes
// anyway. Keep the members the same as in push_service.dart. Alerts still appear in the notification bell in the app.
class PushService {
  static final PushService instance = PushService._();
  PushService._();

  void Function(Map<String, dynamic> data)? onOpen;

  bool get supported => false;

  Future<void> init(ApiService api) async {}
  Future<bool> isAllowed() async => false;
  Future<bool> requestPermission() async => false;
  Future<bool> syncToken([ApiService? api]) async => false;
  Future<void> syncIfAllowed() async {}
  Future<void> unregister() async {}
}
