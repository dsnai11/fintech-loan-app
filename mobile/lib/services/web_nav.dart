import 'package:flutter/foundation.dart';
import '../main.dart' show navigatorKey;

// The website's top menu and the signed-in screens agree on which section is open through this. Choosing a section from any page
// first goes back to the main screen, then switches to it.
class WebNav {
  WebNav._();
  static final ValueNotifier<int> tab = ValueNotifier<int>(0); // 0 home, 1 offers, 2 pay, 3 my loans, 4 profile

  static void go(int index) {
    tab.value = index;
    navigatorKey.currentState?.popUntil((r) => r.settings.name == '/home' || r.isFirst);
  }
}
