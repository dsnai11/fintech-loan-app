import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/app_settings.dart';
import 'app_gate_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({Key? key}) : super(key: key);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _checkAuth();
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

    final authService = context.read<AuthService>();

    if (authService.isAuthenticated) {
      Navigator.of(context).pushReplacementNamed('/home');
    } else {
      Navigator.of(context).pushReplacementNamed('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.credit_card,
                size: 80,
                color: Colors.blue.shade600,
              ),
            ),
            const SizedBox(height: 30),
            Text(
              'FinTech Loan',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Instant Loans, Better Future',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.grey.shade600,
              ),
            ),
            const SizedBox(height: 50),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
