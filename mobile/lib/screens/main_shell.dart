import 'package:flutter/material.dart';
import '../main.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../widgets/tr_text.dart' show tr;
import 'offers_screen.dart';
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
  int _newOffers = 0; // offers the customer has not looked at yet, shown as a dot on the tab

  @override
  void initState() {
    super.initState();
    Future.microtask(_refreshOffers);
  }

  Future<void> _refreshOffers() async {
    final n = await OffersSeen.unseen(context.read<ApiService>());
    if (mounted) setState(() => _newOffers = n);
  }

  void _open(int tab) {
    final leftOffers = _tab == 1 && tab != 1;
    setState(() { _tab = tab; if (tab == 1) _newOffers = 0; });
    if (leftOffers || tab == 0) _refreshOffers();
  }

  @override
  Widget build(BuildContext context) {
    // Home keeps its place. The other tabs are built fresh each time you open them, so they are never stale
    // and the messages tab only checks for replies while you are looking at it.
    final pages = <Widget>[
      HomeScreen(onOpenTab: _open),
      _tab == 1 ? OffersScreen(embedded: true, onOpenTab: _open) : const SizedBox.shrink(),
      _tab == 2 ? const LoanHistoryScreen(embedded: true) : const SizedBox.shrink(),
      _tab == 3 ? const SupportScreen() : const SizedBox.shrink(),
      _tab == 4 ? const ProfileScreen(embedded: true) : const SizedBox.shrink(),
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
          NavigationDestination(icon: Badge(isLabelVisible: _newOffers > 0, smallSize: 9, child: const Icon(Icons.local_offer_outlined)), selectedIcon: const Icon(Icons.local_offer_rounded, color: kNavy), label: tr('Offers')),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), selectedIcon: const Icon(Icons.account_balance_wallet_rounded, color: kNavy), label: tr('My Loans')),
          NavigationDestination(icon: const Icon(Icons.chat_bubble_outline_rounded), selectedIcon: const Icon(Icons.chat_bubble_rounded, color: kNavy), label: tr('Messages')),
          NavigationDestination(icon: const Icon(Icons.person_outline_rounded), selectedIcon: const Icon(Icons.person_rounded, color: kNavy), label: tr('Profile')),
        ],
      ),
    );
  }
}
