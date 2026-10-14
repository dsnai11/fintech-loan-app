import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../screens/notifications_screen.dart';
import '../screens/support_screen.dart';
import '../services/app_settings.dart';
import '../services/auth_service.dart';
import '../services/web_nav.dart';
import '../utils/responsive.dart';
import 'tr_text.dart';

// The website's top menu: the logo, the main sections, messages, notifications and the customer's own menu.
class WebTopNav extends StatelessWidget {
  final int? active; // which section is open (0 home, 1 offers, 2 pay, 3 my loans, 4 profile), or null on a page opened from one
  const WebTopNav({Key? key, this.active}) : super(key: key);

  static const _items = [
    [Icons.home_rounded, 'Home'],
    [Icons.local_offer_rounded, 'Offers'],
    [Icons.payments_rounded, 'Pay'],
    [Icons.account_balance_wallet_rounded, 'My Loans'],
  ];

  Future<void> _signOut(BuildContext context) async {
    await context.read<AuthService>().logout();
    navigatorKey.currentState?.pushNamedAndRemoveUntil('/login', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthService>().user;
    final settings = context.watch<AppSettings>();
    final first = '${user?['firstName'] ?? ''}'.trim();
    final last = '${user?['lastName'] ?? ''}'.trim();
    final initials = '${first.isEmpty ? '?' : first[0]}${last.isEmpty ? '' : last[0]}'.toUpperCase();
    return Material(
      color: Colors.white,
      elevation: 0,
      child: Container(
        height: 68,
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: kLine))),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: kWebContentMax),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Row(children: [
                InkWell(
                  onTap: () => WebNav.go(0),
                  borderRadius: BorderRadius.circular(10),
                  child: Row(children: [
                    ClipRRect(borderRadius: BorderRadius.circular(9), child: SizedBox(width: 38, height: 38, child: Image.asset('assets/images/lifc_logo.jpg', fit: BoxFit.contain))),
                    const SizedBox(width: 10),
                    const Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('LIFC', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: kNavy, height: 1.1, letterSpacing: 1.5)),
                      Text('Laxmi India Finance', style: TextStyle(fontSize: 10.5, color: kMuted, height: 1.1)),
                    ]),
                  ]),
                ),
                const SizedBox(width: 40),
                for (var i = 0; i < _items.length; i++) _link(i, _items[i][0] as IconData, _items[i][1] as String),
                const Spacer(),
                if (settings.support) ...[
                  IconButton(
                    tooltip: 'Messages',
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SupportScreen())),
                    icon: const Icon(Icons.chat_bubble_outline_rounded, color: kNavy),
                  ),
                  const SizedBox(width: 6),
                ],
                const NotificationBell(dark: true),
                const SizedBox(width: 16),
                PopupMenuButton<String>(
                  tooltip: 'Your account',
                  offset: const Offset(0, 48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  onSelected: (v) {
                    if (v == 'profile') WebNav.go(4);
                    if (v == 'out') _signOut(context);
                  },
                  itemBuilder: (_) => [
                    PopupMenuItem(enabled: false, child: Text('$first $last'.trim().isEmpty ? 'Your account' : '$first $last'.trim(), style: const TextStyle(fontWeight: FontWeight.w700, color: kInk))),
                    const PopupMenuDivider(),
                    const PopupMenuItem(value: 'profile', child: Text('My profile')),
                    const PopupMenuItem(value: 'out', child: Text('Sign out')),
                  ],
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    CircleAvatar(radius: 18, backgroundColor: active == 4 ? kNavy : kNavy.withOpacity(0.12), child: Text(initials, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: active == 4 ? Colors.white : kNavy))),
                    const Icon(Icons.keyboard_arrow_down_rounded, color: kMuted),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  Widget _link(int i, IconData icon, String label) {
    final on = active == i;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: InkWell(
        onTap: () => WebNav.go(i),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: on ? kNavy.withOpacity(0.08) : Colors.transparent, borderRadius: BorderRadius.circular(10)),
          child: Row(children: [
            Icon(icon, size: 19, color: on ? kNavy : kMuted),
            const SizedBox(width: 8),
            Text(label, style: TextStyle(fontSize: 14, fontWeight: on ? FontWeight.w700 : FontWeight.w500, color: on ? kNavy : kInk)),
          ]),
        ),
      ),
    );
  }
}

// A page opened from a section (applying, KYC, the agreement, a loan's details, notifications): on the website it sits as a card in the
// middle of the page, under the same top menu, instead of stretching across the whole window.
class WebFrame extends StatelessWidget {
  final Widget child;
  const WebFrame({Key? key, required this.child}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: kBg,
      child: Column(children: [
        const WebTopNav(),
        Expanded(
          child: Align(
            alignment: Alignment.topCenter,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 760),
                child: Container(
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: kLine), boxShadow: [BoxShadow(color: kNavy.withOpacity(0.06), blurRadius: 24, offset: const Offset(0, 8))]),
                  child: ClipRRect(borderRadius: BorderRadius.circular(20), child: child),
                ),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
