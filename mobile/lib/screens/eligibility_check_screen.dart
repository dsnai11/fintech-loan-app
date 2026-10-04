import 'package:flutter/material.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import 'loan_plan_screen.dart';

class EligibilityCheckScreen extends StatefulWidget {
  final LoanApplicationState? appState;
  const EligibilityCheckScreen({Key? key, this.appState}) : super(key: key);

  @override
  State<EligibilityCheckScreen> createState() => _EligibilityCheckScreenState();
}

class _EligibilityCheckScreenState extends State<EligibilityCheckScreen>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnim;
  int _checkIndex = 0;
  bool _done = false;

  final _checks = [
    'Verifying identity...',
    'Checking credit bureau...',
    'Calculating eligibility...',
    'Preparing loan offers...',
  ];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fadeAnim = CurvedAnimation(parent: _controller, curve: Curves.easeIn);
    _controller.forward();
    _runChecks();
  }

  void _runChecks() async {
    for (int i = 0; i < _checks.length; i++) {
      await Future.delayed(const Duration(milliseconds: 900));
      if (!mounted) return;
      setState(() => _checkIndex = i + 1);
    }
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    setState(() => _done = true);
    await Future.delayed(const Duration(milliseconds: 800));
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => LoanPlanScreen(appState: widget.appState)),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: FadeTransition(
          opacity: _fadeAnim,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: _done
                          ? kGreen.withOpacity(0.1)
                          : kNavy.withOpacity(0.06),
                      shape: BoxShape.circle,
                    ),
                    child: _done
                        ? const Icon(Icons.check_circle_rounded,
                            color: kGreen, size: 52)
                        : const Padding(
                            padding: EdgeInsets.all(28),
                            child: CircularProgressIndicator(
                                color: kNavy, strokeWidth: 3),
                          ),
                  ),
                  const SizedBox(height: 28),
                  Text(
                    _done ? 'You\'re Eligible! 🎉' : 'Checking Eligibility',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: _done ? kGreen : const Color(0xFF111827),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _done
                        ? 'Your details look good. You may be eligible for a loan, subject to verification.'
                        : 'Please wait while we verify your details',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 14, color: Color(0xFF6B7280), height: 1.5),
                  ),
                  const SizedBox(height: 36),

                  // Check list
                  ...List.generate(_checks.length, (i) {
                    final done = i < _checkIndex;
                    final active = i == _checkIndex && !_done;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 300),
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: done
                                  ? kGreen
                                  : active
                                      ? kNavy.withOpacity(0.15)
                                      : const Color(0xFFF3F4F6),
                            ),
                            child: done
                                ? const Icon(Icons.check_rounded,
                                    color: Colors.white, size: 14)
                                : active
                                    ? const Padding(
                                        padding: EdgeInsets.all(5),
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2, color: kNavy),
                                      )
                                    : null,
                          ),
                          const SizedBox(width: 12),
                          Text(
                            _checks[i],
                            style: TextStyle(
                              fontSize: 14,
                              color: done
                                  ? const Color(0xFF111827)
                                  : const Color(0xFF9CA3AF),
                              fontWeight: done
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
