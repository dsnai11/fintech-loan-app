import 'dart:io';
import 'package:flutter/foundation.dart';

// A simple check for a rooted (Android) or jailbroken (iPhone) phone: the files such phones leave behind. It is a signal for the
// company's own review, not proof. It can be fooled by someone who hides them, and it can in rare cases name a normal phone, so the
// company decides what it means (a note for staff, a rule of their own, or blocking the app) in the web portal.
class DeviceRisk {
  DeviceRisk._();
  static bool rooted = false;

  static const _android = [
    '/system/app/Superuser.apk', '/system/app/SuperSU.apk', '/sbin/su', '/system/bin/su', '/system/xbin/su', '/data/local/xbin/su',
    '/data/local/bin/su', '/data/local/su', '/system/sd/xbin/su', '/su/bin/su', '/sbin/.magisk', '/data/adb/magisk',
  ];
  static const _ios = [
    '/Applications/Cydia.app', '/Library/MobileSubstrate/MobileSubstrate.dylib', '/usr/sbin/sshd', '/etc/apt', '/private/var/lib/apt/', '/Applications/Sileo.app',
  ];

  static Future<void> init() async {
    if (kIsWeb) return;
    try {
      final paths = Platform.isAndroid ? _android : (Platform.isIOS ? _ios : const <String>[]);
      for (final p in paths) {
        if (await File(p).exists() || await Directory(p).exists()) {
          rooted = true;
          return;
        }
      }
    } catch (_) {
      // a phone that will not let us look is treated as normal
    }
  }
}
