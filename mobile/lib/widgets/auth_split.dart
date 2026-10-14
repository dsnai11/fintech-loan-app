import 'package:flutter/material.dart' hide Text;
import '../main.dart';
import 'language_picker.dart';
import 'tr_text.dart';

// Sign-in and sign-up on the website: the brand on the left, the form on the right.
class AuthSplit extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget child;
  const AuthSplit({Key? key, required this.title, required this.subtitle, required this.child}) : super(key: key);

  static const _points = [
    [Icons.receipt_long_rounded, 'See your offer and every charge before you commit'],
    [Icons.verified_user_rounded, 'Verify with DigiLocker and a selfie. No paperwork to post'],
    [Icons.account_balance_rounded, 'Your money goes only to your own bank account'],
    [Icons.lock_rounded, 'Your details stay private, with an app PIN and automatic sign-out'],
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Row(children: [
        Expanded(
          flex: 5,
          child: Container(
            decoration: const BoxDecoration(gradient: LinearGradient(colors: [kNavy, Color(0xFF9B1B30)], begin: Alignment.topLeft, end: Alignment.bottomRight)),
            child: Stack(children: [
              Positioned(right: -120, top: -120, child: Container(width: 380, height: 380, decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withOpacity(0.06)))),
              Positioned(left: -80, bottom: -100, child: Container(width: 300, height: 300, decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withOpacity(0.05)))),
              Positioned(top: 24, right: 28, child: const LanguageChip()),
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Padding(
                    padding: const EdgeInsets.all(48),
                    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Container(
                          width: 64,
                          height: 64,
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                          child: ClipRRect(borderRadius: BorderRadius.circular(13), child: Image.asset('assets/images/lifc_logo.jpg', fit: BoxFit.contain)),
                        ),
                        const SizedBox(width: 14),
                        const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('LIFC', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: 2, height: 1.1)),
                          Text('Laxmi India Finance', style: TextStyle(color: Colors.white70, fontSize: 14)),
                        ]),
                      ]),
                      const SizedBox(height: 40),
                      const Text('Loans made simple.\nEvery charge shown first.', style: TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w800, height: 1.2)),
                      const SizedBox(height: 14),
                      Text('Apply online, track your loan and pay your instalments, all in one place.', style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 16, height: 1.5)),
                      const SizedBox(height: 32),
                      for (final p in _points)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Container(width: 34, height: 34, decoration: BoxDecoration(color: Colors.white.withOpacity(0.16), borderRadius: BorderRadius.circular(10)), child: Icon(p[0] as IconData, color: Colors.white, size: 18)),
                            const SizedBox(width: 14),
                            Expanded(child: Padding(padding: const EdgeInsets.only(top: 6), child: Text(p[1] as String, style: const TextStyle(color: Colors.white, fontSize: 14.5, height: 1.4)))),
                          ]),
                        ),
                    ]),
                  ),
                ),
              ),
            ]),
          ),
        ),
        Expanded(
          flex: 4,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(40, 40, 40, 40),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: kInk)),
                  const SizedBox(height: 6),
                  Text(subtitle, style: const TextStyle(fontSize: 14.5, color: kMuted)),
                  const SizedBox(height: 28),
                  child,
                ]),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
