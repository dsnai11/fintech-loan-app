import 'services/device_risk.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'services/api_service.dart';
import 'services/auth_service.dart';
import 'services/app_settings.dart';
import 'services/app_lock.dart';
import 'widgets/lock_gate.dart';
import 'services/language_service.dart';
import 'services/push_service.dart';
import 'screens/offers_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/signup_screen.dart';
import 'screens/main_shell.dart';

// Brand and surface colours used across the app. The company's own colours from the web portal still override the home header and banners.
const kNavy = Color(0xFF7B0000);
const kGreen = Color(0xFFC41E3A);
const kBg = Color(0xFFFAF6F6);
const kInk = Color(0xFF1B1416);
const kMuted = Color(0xFF6B7280);
const kLine = Color(0xFFEADFE0);
const kGold = Color(0xFFD9A441);
const kGood = Color(0xFF15803D);

// Lets a tapped notification open a screen from outside any widget
final navigatorKey = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: kNavy,
    statusBarIconBrightness: Brightness.light,
  ));
  final api = ApiService();
  await AppLock.instance.init();
  await DeviceRisk.init();
  await LanguageService.instance.init(api);
  PushService.instance.onOpen = (data) {
    if (data['type'] == 'OFFER') {
      navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => OffersScreen(openOfferId: '${data['offerId'] ?? ''}')));
    }
  };
  PushService.instance.init(api); // starts in the background; the app does not wait for it
  runApp(MyApp(api: api));
}

class MyApp extends StatelessWidget {
  final ApiService api;
  const MyApp({Key? key, required this.api}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: api),
        ChangeNotifierProvider<LanguageService>.value(value: LanguageService.instance),
        ChangeNotifierProvider<AppSettings>(create: (context) => AppSettings(context.read<ApiService>())),
        ChangeNotifierProvider<AppLock>.value(value: AppLock.instance),
        ProxyProvider<ApiService, AuthService>(
          update: (_, apiService, authService) =>
              authService ?? AuthService(apiService),
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        builder: (context, child) => LockGate(child: _webFrame(context, child ?? const SizedBox.shrink())),
        title: 'LIFC - Laxmi India Finance',
        debugShowCheckedModeBanner: false,
        theme: _theme(),
        home: const SplashScreen(),
        routes: {
          '/login': (_) => const LoginScreen(),
          '/signup': (_) => const SignupScreen(),
          '/home': (_) => const MainShell(),
        },
      ),
    );
  }
}

// In a web browser on a wide screen, keep the app at phone width in the middle of the page, as on a phone, so every screen looks as designed
Widget _webFrame(BuildContext context, Widget child) {
  if (!kIsWeb) return child;
  return LayoutBuilder(builder: (context, box) {
    if (box.maxWidth <= 720) return child;
    const width = 460.0;
    final mq = MediaQuery.of(context);
    return ColoredBox(
      color: const Color(0xFFEFE6E7),
      child: Align(
        alignment: Alignment.topCenter,
        child: Container(
          width: width,
          height: box.maxHeight,
          decoration: BoxDecoration(boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.12), blurRadius: 30)]),
          child: ClipRect(child: MediaQuery(data: mq.copyWith(size: Size(width, box.maxHeight)), child: child)),
        ),
      ),
    );
  });
}

ThemeData _theme() {
  final base = ColorScheme.fromSeed(seedColor: kNavy, primary: kNavy, secondary: kGreen, background: kBg, surface: Colors.white);
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: c, width: w));
  return ThemeData(
    useMaterial3: true,
    colorScheme: base,
    scaffoldBackgroundColor: kBg,
    fontFamily: 'Poppins',
    textTheme: ThemeData.light().textTheme.apply(fontFamily: 'Poppins', bodyColor: kInk, displayColor: kInk),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: CupertinoPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    appBarTheme: const AppBarTheme(
      backgroundColor: kNavy,
      foregroundColor: Colors.white,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      systemOverlayStyle: SystemUiOverlayStyle(statusBarColor: kNavy, statusBarIconBrightness: Brightness.light, statusBarBrightness: Brightness.dark),
      titleTextStyle: TextStyle(fontFamily: 'Poppins', fontSize: 17, fontWeight: FontWeight.w600, color: Colors.white),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 12,
      shadowColor: kNavy.withOpacity(0.25),
      indicatorColor: kNavy.withOpacity(0.10),
      labelTextStyle: MaterialStateProperty.resolveWith((s) => TextStyle(fontFamily: 'Poppins', fontSize: 11, fontWeight: s.contains(MaterialState.selected) ? FontWeight.w600 : FontWeight.w500, color: s.contains(MaterialState.selected) ? kNavy : kMuted)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: border(kLine),
      enabledBorder: border(kLine),
      focusedBorder: border(kNavy, 1.6),
      errorBorder: border(const Color(0xFFDC2626)),
      focusedErrorBorder: border(const Color(0xFFDC2626), 1.6),
      labelStyle: const TextStyle(color: kMuted, fontSize: 14),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0xFFD9CFCF),
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
        textStyle: const TextStyle(fontFamily: 'Poppins', fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: kNavy,
        side: const BorderSide(color: kNavy, width: 1.2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 20),
        textStyle: const TextStyle(fontFamily: 'Poppins', fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: kNavy, textStyle: const TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w600))),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: kNavy.withOpacity(0.12),
      side: const BorderSide(color: kLine),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      labelStyle: const TextStyle(fontFamily: 'Poppins', fontSize: 13, fontWeight: FontWeight.w500),
    ),
    dialogTheme: DialogTheme(backgroundColor: Colors.white, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22))),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: Colors.white, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24)))),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), backgroundColor: kInk),
    sliderTheme: SliderThemeData(activeTrackColor: kNavy, thumbColor: kNavy, inactiveTrackColor: kNavy.withOpacity(0.15), overlayColor: kNavy.withOpacity(0.12), trackHeight: 5),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: kNavy, linearTrackColor: Color(0xFFF1E7E8)),
    dividerTheme: const DividerThemeData(color: kLine, thickness: 1, space: 1),
    listTileTheme: const ListTileThemeData(iconColor: kNavy),
  );
}
