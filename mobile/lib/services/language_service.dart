import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_service.dart';

// The language the customer chose, and the words for it. The words come from the company's server (so the wording
// can be corrected from the web portal without a new app) and are kept on the phone for next time. Anything with no
// translation is shown in English, so nothing ever goes blank.
class LanguageService extends ChangeNotifier {
  static final LanguageService instance = LanguageService._();
  LanguageService._();

  static const _english = {'code': 'en', 'name': 'English', 'native': 'English'};

  ApiService? _api;
  String code = 'en';
  Map<String, String> _strings = {};
  List<Map<String, String>> available = [_english];

  String get currentNative => available.firstWhere((l) => l['code'] == code, orElse: () => _english)['native'] ?? 'English';

  // Called once when the app starts. Reads what was saved last time, then refreshes from the server in the background.
  Future<void> init(ApiService api) async {
    _api = api;
    try {
      final p = await SharedPreferences.getInstance();
      code = p.getString('lang') ?? 'en';
      _strings = _readStrings(p.getString('strings_$code'));
      final saved = p.getString('langs');
      if (saved != null) available = _readLanguages(saved);
    } catch (_) {}
    notifyListeners();
    refresh();
  }

  Map<String, String> _readStrings(String? raw) {
    if (raw == null) return {};
    try {
      return (jsonDecode(raw) as Map).map((k, v) => MapEntry(k.toString(), v.toString()));
    } catch (_) {
      return {};
    }
  }

  List<Map<String, String>> _readLanguages(String raw) {
    try {
      final list = (jsonDecode(raw) as List).whereType<Map>().map((m) => m.map((k, v) => MapEntry(k.toString(), v.toString()))).toList();
      return list.isEmpty ? [_english] : list;
    } catch (_) {
      return [_english];
    }
  }

  // Fetches the list of languages on offer and the words for the chosen one.
  Future<void> refresh() async {
    final api = _api;
    if (api == null) return;
    try {
      final langs = await api.getLanguages();
      if (langs.isNotEmpty) {
        available = langs;
        if (!available.any((l) => l['code'] == code)) {
          code = 'en';
          _strings = {};
        }
      }
      final p = await SharedPreferences.getInstance();
      await p.setString('langs', jsonEncode(available));
      if (code != 'en') {
        final r = await api.getStrings(code);
        _strings = (r['strings'] as Map? ?? {}).map((k, v) => MapEntry(k.toString(), v.toString()));
        await p.setString('strings_$code', jsonEncode(_strings));
      }
      await p.setString('lang', code);
      notifyListeners();
    } catch (_) {} // offline: keep what we have
  }

  Future<void> setLanguage(String newCode) async {
    code = newCode;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString('lang', code);
      _strings = code == 'en' ? {} : _readStrings(p.getString('strings_$code'));
    } catch (_) {}
    notifyListeners();
    await refresh();
    _api?.setUserLanguage(code); // only works when signed in; fine if it does not
  }

  String t(String s) => code == 'en' ? s : (_strings[s] ?? s);
}
