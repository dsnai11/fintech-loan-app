import 'package:flutter/material.dart';
import '../main.dart';

// The frame shared by the account set-up steps: a step counter with a progress bar, the step's content, and a
// "Not now" link, since the customer can finish setting up later (they must before they can apply for a loan).
class SetupScaffold extends StatelessWidget {
  final int step; // 1 to 4
  final String title;
  final String subtitle;
  final Widget body;
  final Widget? bottom;
  final bool canSkip;

  const SetupScaffold({Key? key, required this.step, required this.title, required this.subtitle, required this.body, this.bottom, this.canSkip = true}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        automaticallyImplyLeading: false,
        title: Text('Step $step of 4', style: const TextStyle(fontSize: 14, color: Color(0xFF6B7280), fontWeight: FontWeight.w600)),
        actions: [
          if (canSkip) TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Not now', style: TextStyle(color: Color(0xFF6B7280)))),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(value: step / 4, minHeight: 4, backgroundColor: const Color(0xFFF3F4F6), color: kNavy),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 22, 24, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 26, height: 1.15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
                    const SizedBox(height: 10),
                    Text(subtitle, style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF6B7280))),
                    const SizedBox(height: 24),
                    body,
                  ],
                ),
              ),
            ),
            if (bottom != null) Padding(padding: const EdgeInsets.fromLTRB(24, 8, 24, 16), child: bottom),
          ],
        ),
      ),
    );
  }
}
