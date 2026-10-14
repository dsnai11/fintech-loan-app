import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/widgets.dart';

// The website layout is used in a web browser on a wide window. On a phone, and in a narrow browser window, the app looks as it always did.
const double kWideFrom = 900;
const double kWebContentMax = 1240;

bool isWide(BuildContext context) => kIsWeb && MediaQuery.of(context).size.width >= kWideFrom;
