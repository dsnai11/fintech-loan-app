import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:screen_protector/screen_protector.dart';

// Blocks screenshots and screen recording in the phone app (the screen shows black), and hides the app in the phone's app
// switcher. Android does this fully. iPhone does it on most versions. A browser cannot be controlled this way, so the website
// does nothing here. It never throws: if the phone cannot do it, the app simply carries on.
class ScreenGuard {
  static bool? _on;

  static Future<void> apply(bool block) async {
    if (kIsWeb || _on == block) return;
    _on = block;
    try {
      if (block) {
        await ScreenProtector.preventScreenshotOn();
        await ScreenProtector.protectDataLeakageWithBlur();
      } else {
        await ScreenProtector.preventScreenshotOff();
        await ScreenProtector.protectDataLeakageOff();
      }
    } catch (_) {}
  }
}
