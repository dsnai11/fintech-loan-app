import '../services/device_risk.dart';
import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/app_settings.dart';
import '../services/app_lock.dart';
import '../main.dart';
import 'app_gate_screen.dart';
import 'onboarding_flow.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({Key? key}) : super(key: key);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _in = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..forward();

  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  @override
  void dispose() {
    _in.dispose();
    super.dispose();
  }

  Future<void> _checkAuth() async {
    final settings = context.read<AppSettings>();
    await Future.wait([Future.delayed(const Duration(seconds: 2)), settings.load()]);

    if (!mounted) return;

    // The company can lock the app for maintenance, or ask for a newer version, from the web portal.
    if (settings.maintenance) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => AppGateScreen(icon: Icons.build_circle_outlined, title: 'Back soon', message: settings.maintenanceMessage),
      ));
      return;
    }
    if (settings.updateRequired) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => const AppGateScreen(
          icon: Icons.system_update_alt_rounded,
          title: 'Please update the app',
          message: 'A newer version of the app is needed to keep your loan account safe. Install the latest version and open it again.',
          canRetry: false,
        ),
      ));
      return;
    }

    if (settings.blockRooted && DeviceRisk.rooted) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => const AppGateScreen(
          icon: Icons.gpp_maybe_outlined,
          title: 'This phone cannot be used',
          message: 'This phone looks like it has been modified (rooted or jailbroken), so we cannot keep your loan account safe on it. Please use another phone, or contact support.',
          canRetry: false,
        ),
      ));
      return;
    }

    final authService = context.read<AuthService>();

    if (authService.isAuthenticated) {
      if (settings.appLockMode != 'off') AppLock.instance.lockNow();
      await continueToHome(context);
    } else {
      Navigator.of(context).pushReplacementNamed('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    final fade = CurvedAnimation(parent: _in, curve: Curves.easeOut);
    return Scaffold(
      body: Container(
        width: double.infinity,
        decoration: const BoxDecoration(gradient: LinearGradient(colors: [kNavy, Color(0xFF9B1B30)], begin: Alignment.topLeft, end: Alignment.bottomRight)),
        child: SafeArea(
          child: Column(
            children: [
              const Spacer(flex: 3),
              FadeTransition(
                opacity: fade,
                child: ScaleTransition(
                  scale: Tween<double>(begin: 0.86, end: 1).animate(fade),
                  child: Column(children: [
                    Container(
                      width: 104,
                      height: 104,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(30), boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.25), blurRadius: 26, offset: const Offset(0, 12))]),
                      child: ClipRRect(borderRadius: BorderRadius.circular(22), child: Image.asset('assets/images/lifc_logo.jpg', fit: BoxFit.contain)),
                    ),
                    const SizedBox(height: 26),
                    const Text('LIFC', style: TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 3)),
                    const SizedBox(height: 4),
                    Text('Laxmi India Finance', style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 15, fontWeight: FontWeight.w500, letterSpacing: 0.5)),
                  ]),
                ),
              ),
              const Spacer(flex: 3),
              FadeTransition(
                opacity: fade,
                child: Column(children: [
                  Text('Loans made simple.\nEvery charge shown first.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white.withOpacity(0.9), fontSize: 14, height: 1.5)),
                  const SizedBox(height: 22),
                  const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white)),
                ]),
              ),
              const SizedBox(height: 44),
            ],
          ),
        ),
      ),
    );
  }
}
