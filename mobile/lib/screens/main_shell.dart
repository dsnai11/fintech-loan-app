import 'package:flutter/material.dart';
import '../main.dart';
import '../widgets/tr_text.dart' show tr;
import 'home_screen.dart';
import 'loan_history_screen.dart';
import 'profile_screen.dart';
import 'support_screen.dart';

// The signed-in app: four tabs along the bottom (home, loans, messages, profile), the usual layout of
// consumer lending apps. Everything else opens on top of it.
class MainShell extends StatefulWidget {
  const MainShell({Key? key}) : super(key: key);

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _tab = 0;

  void _open(int tab) => setState(() => _tab = tab);

  @override
  Widget build(BuildContext context) {
    // Home keeps its place. The other tabs are built fresh each time you open them, so they are never stale
    // and the messages tab only checks for replies while you are looking at it.
    final pages = <Widget>[
      HomeScreen(onOpenTab: _open),
      _tab == 1 ? const LoanHistoryScreen(embedded: true) : const SizedBox.shrink(),
      _tab == 2 ? const SupportScreen() : const SizedBox.shrink(),
      _tab == 3 ? const ProfileScreen(embedded: true) : const SizedBox.shrink(),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: _open,
        backgroundColor: Colors.white,
        indicatorColor: kNavy.withOpacity(0.10),
        height: 66,
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home_rounded, color: kNavy), label: tr('Home')),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), selectedIcon: const Icon(Icons.account_balance_wallet_rounded, color: kNavy), label: tr('My Loans')),
          NavigationDestination(icon: const Icon(Icons.chat_bubble_outline_rounded), selectedIcon: const Icon(Icons.chat_bubble_rounded, color: kNavy), label: tr('Messages')),
          NavigationDestination(icon: const Icon(Icons.person_outline_rounded), selectedIcon: const Icon(Icons.person_rounded, color: kNavy), label: tr('Profile')),
        ],
      ),
    );
  }
}
