import 'package:flutter/material.dart';
import '../main.dart';
import 'splash_screen.dart';

// Shown instead of the app while it is locked for maintenance or too old to use.
class AppGateScreen extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final bool canRetry;

  const AppGateScreen({Key? key, required this.icon, required this.title, required this.message, this.canRetry = true}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 72, color: kNavy),
                const SizedBox(height: 24),
                Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
                const SizedBox(height: 12),
                Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: Color(0xFF4B5563), height: 1.5)),
                if (canRetry) ...[
                  const SizedBox(height: 28),
                  ElevatedButton(
                    onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const SplashScreen())),
                    child: const Text('Try again'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
