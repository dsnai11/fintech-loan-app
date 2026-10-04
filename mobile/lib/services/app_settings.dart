import 'package:flutter/foundation.dart';
import 'api_service.dart';

// Keep in step with `version` in pubspec.yaml. The web portal can ask for a minimum version.
const String kAppVersion = '1.0.0';

// True when version `a` is older than version `b` (both like 1.2.0).
bool versionLess(String a, String b) {
  List<int> parse(String v) => v.split('.').map((p) => int.tryParse(p) ?? 0).toList();
  final x = parse(a);
  final y = parse(b);
  for (var i = 0; i < 3; i++) {
    final xi = i < x.length ? x[i] : 0;
    final yi = i < y.length ? y[i] : 0;
    if (xi != yi) return xi < yi;
  }
  return false;
}

// What the company's web portal controls in this app: products, notice, switches, maintenance.
// If the server cannot be reached the app carries on with everything switched on.
class AppSettings extends ChangeNotifier {
  final ApiService _api;
  AppSettings(this._api);

  Map<String, dynamic> _data = {};
  bool loaded = false;

  Future<void> load() async {
    try {
      _data = await _api.getAppSettings().timeout(const Duration(seconds: 5));
      loaded = true;
    } catch (_) {}
    notifyListeners();
  }

  bool _feature(String key) {
    final f = _data['features'];
    return !(f is Map && f[key] == false);
  }

  bool get emiCalculator => _feature('emiCalculator');
  bool get eligibilityCheck => _feature('eligibilityCheck');
  bool get support => _feature('support');

  Map<String, dynamic>? get banner {
    final b = _data['banner'];
    if (b is Map && b['enabled'] == true && (b['text'] ?? '').toString().trim().isNotEmpty) {
      return Map<String, dynamic>.from(b);
    }
    return null;
  }

  bool get maintenance {
    final m = _data['maintenance'];
    return m is Map && m['enabled'] == true;
  }

  String get maintenanceMessage {
    final m = _data['maintenance'];
    final text = m is Map ? (m['message'] ?? '').toString() : '';
    return text.isEmpty ? 'We are updating the app. Please try again in a little while.' : text;
  }

  String get minAppVersion => (_data['minAppVersion'] ?? '').toString();
  bool get updateRequired => minAppVersion.isNotEmpty && versionLess(kAppVersion, minAppVersion);

  List<Map<String, dynamic>> get products {
    final p = _data['products'];
    if (p is! List) return [];
    return p.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  String get supportEmail {
    final s = _data['support'];
    return s is Map ? (s['email'] ?? '').toString() : '';
  }

  String get supportPhone {
    final s = _data['support'];
    return s is Map ? (s['phone'] ?? '').toString() : '';
  }
}
