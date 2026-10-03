import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../main.dart';
import 'pan_verify_screen.dart';
import 'loan_history_screen.dart';
import 'profile_screen.dart';
import 'notifications_screen.dart';
import 'emi_calculator_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AuthService>().loadUserProfile());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kNavy,
      body: Column(
        children: [
          // ── Navy header ──────────────────────────────────────────
          SafeArea(
            bottom: false,
            child: Consumer<AuthService>(
              builder: (context, auth, _) {
                final user = auth.user;
                final name = '${user?['firstName'] ?? ''} ${user?['lastName'] ?? ''}'.trim();
                return Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: Image.asset(
                                  'assets/images/lifc_logo.jpg',
                                  height: 36,
                                  width: 36,
                                  fit: BoxFit.contain,
                                ),
                              ),
                              const SizedBox(width: 10),
                              const Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('LIFC',
                                      style: TextStyle(
                                          color: Colors.white,
                                          fontSize: 18,
                                          fontWeight: FontWeight.w800,
                                          letterSpacing: 1.2)),
                                  Text('Laxmi India Finance Ltd.',
                                      style: TextStyle(
                                          color: Colors.white60,
                                          fontSize: 10,
                                          fontWeight: FontWeight.w500)),
                                ],
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              const NotificationBell(),
                              const SizedBox(width: 10),
                              GestureDetector(
                                onTap: () {
                                  auth.logout();
                                  Navigator.of(context).pushReplacementNamed('/login');
                                },
                                child: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Icon(Icons.logout_rounded,
                                      color: Colors.white, size: 20),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Text(
                        'Good day, ${name.isNotEmpty ? name.split(' ')[0] : 'User'} 👋',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Manage your loans easily',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Credit limit card
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.white.withOpacity(0.2)),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'PRE-APPROVED LIMIT',
                                    style: TextStyle(
                                      color: Colors.white60,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      letterSpacing: 0.8,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  const Text(
                                    '₹5,00,000',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 28,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Row(
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: kGreen.withOpacity(0.2),
                                          borderRadius: BorderRadius.circular(20),
                                        ),
                                        child: const Text(
                                          '✓ Eligible',
                                          style: TextStyle(
                                              color: kGreen,
                                              fontSize: 11,
                                              fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: kGreen,
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: const Icon(Icons.account_balance_wallet_rounded,
                                  color: Colors.white, size: 28),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 28),
                    ],
                  ),
                );
              },
            ),
          ),

          // ── White card body ──────────────────────────────────────
          Expanded(
            child: Container(
              decoration: const BoxDecoration(
                color: kBg,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Quick Actions',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // 2×2 grid actions
                    GridView.count(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 1.3,
                      children: [
                        _actionCard(
                          icon: Icons.description_rounded,
                          label: 'Apply for\nLoan',
                          color: kNavy,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                                builder: (_) => const PanVerifyScreen()),
                          ),
                        ),
                        _actionCard(
                          icon: Icons.history_rounded,
                          label: 'Loan\nHistory',
                          color: const Color(0xFF7C3AED),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const LoanHistoryScreen()),
                          ),
                        ),
                        _actionCard(
                          icon: Icons.calculate_rounded,
                          label: 'EMI\nCalculator',
                          color: const Color(0xFF0891B2),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const EmiCalculatorScreen()),
                          ),
                        ),
                        _actionCard(
                          icon: Icons.person_rounded,
                          label: 'My\nProfile',
                          color: const Color(0xFFD97706),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const ProfileScreen()),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // Loan offers section
                    const Text(
                      'Loan Offers',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _offerCard(
                      title: 'Personal Loan',
                      subtitle: 'Up to ₹5,00,000 • 15% p.a.',
                      icon: Icons.person_pin_rounded,
                      color: kNavy,
                      onApply: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const PanVerifyScreen()),
                      ),
                    ),
                    const SizedBox(height: 10),
                    _offerCard(
                      title: 'Business Loan',
                      subtitle: 'Up to ₹25,00,000 • 14% p.a.',
                      icon: Icons.business_center_rounded,
                      color: const Color(0xFF7C3AED),
                      onApply: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const PanVerifyScreen()),
                      ),
                    ),
                    const SizedBox(height: 10),
                    _offerCard(
                      title: 'Education Loan',
                      subtitle: 'Up to ₹10,00,000 • 12% p.a.',
                      icon: Icons.school_rounded,
                      color: const Color(0xFF0891B2),
                      onApply: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const PanVerifyScreen()),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _actionCard({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: color,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _offerCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    VoidCallback? onApply,
  }) {
    return GestureDetector(
      onTap: onApply,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                          color: Color(0xFF111827))),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xFF6B7280))),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: kNavy,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Text('Apply',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      ),
    );
  }
}
