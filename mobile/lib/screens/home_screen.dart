import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../utils/format.dart';
import '../main.dart';
import 'pan_verify_screen.dart';
import 'loan_history_screen.dart';
import 'profile_screen.dart';
import 'notifications_screen.dart';
import 'help_screen.dart';
import 'emi_calculator_screen.dart';
import 'support_screen.dart';
import 'onboarding_flow.dart';
import '../services/app_settings.dart';
import '../services/selected_product.dart';

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
    Future.microtask(_loadPricing);
    Future.microtask(_loadPhoneStatus);
  }

  bool _phoneUnverified = false;

  Future<void> _loadPhoneStatus() async {
    try {
      final s = await context.read<ApiService>().getOnboarding();
      if (mounted) setState(() => _phoneUnverified = s['phoneVerified'] != true);
    } catch (_) {}
  }

  Widget _verifyPhoneCard() {
    return GestureDetector(
      onTap: () async {
        final ok = await verifyPhone(context);
        if (ok) _loadPhoneStatus();
      },
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFF16161C), borderRadius: BorderRadius.circular(14)),
        child: Row(children: const [
          Icon(Icons.sms_outlined, color: Colors.white, size: 22),
          SizedBox(width: 12),
          Expanded(
            child: Text('Verify your phone number. You need to do this before you can apply for a loan.', style: TextStyle(color: Colors.white, fontSize: 13, height: 1.4)),
          ),
          Icon(Icons.chevron_right_rounded, color: Colors.white70),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettings>();
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
                    if (_phoneUnverified) _verifyPhoneCard(),
                    if (settings.banner != null) _banner(settings.banner!),
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
                          onTap: () {
                            SelectedProduct.reset();
                            Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => const PanVerifyScreen()),
                            );
                          },
                        ),
                        _actionCard(
                          icon: Icons.history_rounded,
                          label: 'Loan\nHistory',
                          color: const Color(0xFF7C3AED),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const LoanHistoryScreen()),
                          ),
                        ),
                        if (settings.emiCalculator)
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
                        if (settings.support)
                        _actionCard(
                          icon: Icons.chat_bubble_rounded,
                          label: 'Message\nUs',
                          color: const Color(0xFF059669),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const SupportScreen()),
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
                    if (settings.products.isEmpty)
                      _offerCard(
                        title: 'Personal Loan',
                        subtitle: _pricing == null
                            ? 'Instant personal loan'
                            : _repeatMax != null
                                ? 'Welcome back! Up to ${formatMoney(_repeatMax!)} for you • exact charges shown before you apply'
                                : 'Up to ${formatMoney(asNum(_pricing!['maxAmount']))} • exact charges shown before you apply',
                        icon: Icons.person_pin_rounded,
                        color: kNavy,
                        onApply: () {
                          SelectedProduct.reset();
                          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PanVerifyScreen()));
                        },
                      ),
                    for (final p in settings.products)
                      _offerCard(
                        title: (p['name'] ?? '').toString(),
                        subtitle: _productLine(p),
                        icon: Icons.person_pin_rounded,
                        color: kNavy,
                        onApply: () {
                          SelectedProduct.choose((p['key'] ?? 'personal').toString(), (p['name'] ?? 'Personal Loan').toString());
                          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PanVerifyScreen()));
                        },
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

  Map<String, dynamic>? _pricing;
  num? _repeatMax;

  // One line under a product: the largest loan, the rate, and a reminder that charges are shown first.
  String _productLine(Map<String, dynamic> p) {
    final isMain = (p['key'] ?? '') == 'personal';
    final max = (isMain && _repeatMax != null) ? _repeatMax! : asNum(p['maxAmount']);
    final prefix = (isMain && _repeatMax != null) ? 'Welcome back! Up to ${formatMoney(max)} for you' : 'Up to ${formatMoney(max)}';
    final desc = (p['description'] ?? '').toString();
    return '$prefix • exact charges shown before you apply${desc.isEmpty ? '' : '\n$desc'}';
  }

  // The company's notice from the web portal
  Widget _banner(Map<String, dynamic> b) {
    final warn = b['level'] == 'warning';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: warn ? const Color(0xFFFEF3C7) : const Color(0xFFE0ECFF),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(warn ? Icons.warning_amber_rounded : Icons.info_outline_rounded, size: 20, color: warn ? const Color(0xFFB45309) : const Color(0xFF1D4ED8)),
          const SizedBox(width: 10),
          Expanded(
            child: Text((b['text'] ?? '').toString(), style: TextStyle(fontSize: 13, height: 1.4, color: warn ? const Color(0xFF92400E) : const Color(0xFF1E3A8A))),
          ),
        ],
      ),
    );
  }

  Future<void> _loadPricing() async {
    try {
      final p = await context.read<ApiService>().getPricing();
      if (mounted) setState(() => _pricing = p);
      final offer = await context.read<ApiService>().getRepeatOffer();
      if (mounted && offer['eligible'] == true) setState(() => _repeatMax = asNum(offer['maxAmount']));
    } catch (_) {}
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
