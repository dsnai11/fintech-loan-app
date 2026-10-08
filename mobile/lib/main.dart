import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'services/api_service.dart';
import 'services/auth_service.dart';
import 'services/app_settings.dart';
import 'services/language_service.dart';
import 'services/push_service.dart';
import 'screens/offers_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/signup_screen.dart';
import 'screens/main_shell.dart';

const kNavy = Color(0xFF7B0000);
const kGreen = Color(0xFFC41E3A);
const kBg = Color(0xFFFFF8F8);

// Lets a tapped notification open a screen from outside any widget
final navigatorKey = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: kNavy,
    statusBarIconBrightness: Brightness.light,
  ));
  final api = ApiService();
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
        ProxyProvider<ApiService, AuthService>(
          update: (_, apiService, authService) =>
              authService ?? AuthService(apiService),
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'LIFC - Laxmi India Finance',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: kNavy,
            primary: kNavy,
            secondary: kGreen,
            background: kBg,
          ),
          scaffoldBackgroundColor: kBg,
          fontFamily: 'Roboto',
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: kNavy, width: 1.5),
            ),
          ),
          elevatedButtonTheme: ElevatedButtonThemeData(
            style: ElevatedButton.styleFrom(
              backgroundColor: kNavy,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              padding: const EdgeInsets.symmetric(vertical: 16),
              textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),
        ),
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
