import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The app's PIN lock. The PIN is kept only on this phone, as a salted hash, and never sent anywhere.
/// (A later hardening step moves it to the phone's secure keystore and adds fingerprint or face unlock.)
class AppLock extends ChangeNotifier {
  AppLock._();
  static final AppLock instance = AppLock._();

  static const int pinLength = 4;
  static const int maxTries = 5;

  SharedPreferences? _p;
  bool pinSet = false;
  bool locked = false;
  int triesLeft = maxTries;
  DateTime? _leftAt;

  Future<void> init() async {
    _p = await SharedPreferences.getInstance();
    pinSet = _p!.getString('lock_hash') != null;
  }

  String _hash(String pin, String salt) {
    List<int> h = utf8.encode('$salt|$pin');
    for (var i = 0; i < 10000; i++) {
      h = sha256.convert(h).bytes;
    }
    return base64Encode(h);
  }

  Future<void> setPin(String pin) async {
    final salt = base64Encode(List<int>.generate(16, (_) => Random.secure().nextInt(256)));
    await _p!.setString('lock_salt', salt);
    await _p!.setString('lock_hash', _hash(pin, salt));
    pinSet = true;
    locked = false;
    triesLeft = maxTries;
    notifyListeners();
  }

  /// True when the PIN is right. A wrong PIN uses up one try; the caller signs the customer out when none are left.
  bool verify(String pin) {
    final salt = _p?.getString('lock_salt');
    final hash = _p?.getString('lock_hash');
    if (salt == null || hash == null) return false;
    if (_hash(pin, salt) == hash) {
      triesLeft = maxTries;
      locked = false;
      notifyListeners();
      return true;
    }
    triesLeft -= 1;
    notifyListeners();
    return false;
  }

  Future<void> removePin() async {
    await _p?.remove('lock_hash');
    await _p?.remove('lock_salt');
    pinSet = false;
    locked = false;
    triesLeft = maxTries;
    notifyListeners();
  }

  void lockNow() {
    if (!pinSet) return;
    locked = true;
    notifyListeners();
  }

  // The app went to the background / came back
  void left() => _leftAt = DateTime.now();
  Duration? awayFor() => _leftAt == null ? null : DateTime.now().difference(_leftAt!);
  void clearAway() => _leftAt = null;
}
