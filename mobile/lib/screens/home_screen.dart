import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../widgets/home_banners.dart';
import '../widgets/ui_kit.dart';
import '../services/language_service.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../services/app_settings.dart';
import '../services/selected_product.dart';
import '../utils/format.dart';
import '../utils/product_catalog.dart';
import '../main.dart';
import 'pan_verify_screen.dart';
import 'notifications_screen.dart';
import 'help_screen.dart';
import 'emi_calculator_screen.dart';
import 'eligibility_check_screen.dart';
import 'credit_score_screen.dart';
import 'callback_screen.dart';
import 'support_screen.dart';
import 'products_screen.dart';
import 'loan_detail_screen.dart';
import 'agreement_screen.dart';
import 'onboarding_flow.dart';
import 'account_setup_flow.dart';
import 'referral_screen.dart';
import 'app_actions.dart';
import '../services/push_service.dart';

// Home tab. Top to bottom: the branded header with the customer's offer, any notice, their own loan, shortcuts, the company's
// offers, the loan products, why to trust the company, how it works, and who the lender is.
// The icon names the web portal can pick for a tile or a step
IconData homeIcon(String name) {
  const icons = <String, IconData>{
    'receipt': Icons.receipt_long_rounded, 'shield': Icons.verified_user_rounded, 'lock': Icons.lock_rounded, 'translate': Icons.translate_rounded,
    'bolt': Icons.bolt_rounded, 'heart': Icons.favorite_rounded, 'star': Icons.star_rounded, 'support': Icons.support_agent_rounded,
    'rupee': Icons.currency_rupee_rounded, 'clock': Icons.schedule_rounded, 'check': Icons.check_circle_rounded, 'gift': Icons.card_giftcard_rounded,
    'calendar': Icons.event_rounded, 'badge': Icons.badge_outlined, 'draw': Icons.draw_outlined, 'bank': Icons.account_balance_outlined,
    'offer': Icons.local_offer_outlined, 'speed': Icons.speed_rounded,
  };
  return icons[name] ?? Icons.check_circle_rounded;
}

class HomeScreen extends StatefulWidget {
  // Switches the bottom tabs: 0 home, 1 offers, 2 my loans, 3 messages, 4 profile, 5 pay
  final void Function(int tab)? onOpenTab;
  const HomeScreen({Key? key, this.onOpenTab}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _pricing;
  num? _repeatMax;
  Map<String, dynamic>? _myOffer; // the offer from the customer's credit check, if still valid
  bool _phoneUnverified = false;
  Map<String, dynamic>? _setup; // what is still to do in the account set-up
  Map<String, dynamic>? _home; // branding and offer banners from the web portal
  Map<String, dynamic>? _referral; // the refer-and-earn programme, when it is on
  Map<String, dynamic>? _payday; // the payday advance, when it is on
  Map<String, dynamic>? _loan; // the loan that matters right now, if any
  List<Map<String, dynamic>> _emis = [];

  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AuthService>().loadUserProfile());
    Future.microtask(() => PushService.instance.syncIfAllowed()); // keeps this phone's address fresh; never shows a prompt
    Future.microtask(_refresh);
  }

  Future<void> _refresh() async {
    await Future.wait([_loadPricing(), _loadPhoneStatus(), _loadLoan(), _loadHome(), _loadReferral(), _loadPayday()]);
  }

  Future<void> _loadReferral() async {
    try {
      final r = await context.read<ApiService>().getReferral();
      if (mounted) setState(() => _referral = r['enabled'] == true ? r : null);
    } catch (_) {}
  }

  Future<void> _loadPayday() async {
    try {
      final r = await context.read<ApiService>().getPaydayStatus();
      if (mounted) setState(() => _payday = r['enabled'] == true ? r : null);
    } catch (_) {}
  }

  Future<void> _loadHome() async {
    try {
      final h = await context.read<ApiService>().getHomeContent(lang: LanguageService.instance.code);
      if (mounted) setState(() => _home = h);
    } catch (_) {} // without it the screen simply shows no banners and the standard header
  }

  // What a banner's button does (the same actions as the Offers tab)
  Future<void> _bannerAction(String action, String url) => runAppAction(context, action, url, onOpenTab: widget.onOpenTab);

  Future<void> _loadPricing() async {
    try {
      final p = await context.read<ApiService>().getPricing();
      if (mounted) setState(() => _pricing = p);
      final offer = await context.read<ApiService>().getRepeatOffer();
      if (mounted) setState(() => _repeatMax = offer['eligible'] == true ? asNum(offer['maxAmount']) : null);
      final mine = await context.read<ApiService>().getMyOffer();
      if (mounted) setState(() => _myOffer = mine['offer'] is Map ? Map<String, dynamic>.from(mine['offer'] as Map) : null);
    } catch (_) {}
  }

  Future<void> _loadPhoneStatus() async {
    try {
      final s = await context.read<ApiService>().getOnboarding();
      if (mounted) {
        setState(() {
          _phoneUnverified = s['phoneVerified'] != true;
          _setup = s['setup'] is Map ? Map<String, dynamic>.from(s['setup'] as Map) : null;
        });
      }
    } catch (_) {}
  }

  static const _live = ['disbursed', 'defaulted', 'approved', 'under_review', 'submitted'];

  Future<void> _loadLoan() async {
    try {
      final api = context.read<ApiService>();
      final loans = await api.getAllLoans();
      loans.sort((a, b) => (DateTime.tryParse('${b['createdAt']}') ?? DateTime(2000)).compareTo(DateTime.tryParse('${a['createdAt']}') ?? DateTime(2000)));
      final live = loans.where((l) => _live.contains(l['status'])).toList();
      // A loan being repaid comes first, then an application in progress.
      final repaying = live.where((l) => l['status'] == 'disbursed' || l['status'] == 'defaulted').toList();
      final pick = repaying.isNotEmpty ? repaying.first : (live.isNotEmpty ? live.first : null);
      List<Map<String, dynamic>> emis = [];
      if (pick != null && (pick['status'] == 'disbursed' || pick['status'] == 'defaulted')) {
        try {
          final sch = await api.getEmiSchedule(pick['_id'].toString());
          emis = List<Map<String, dynamic>>.from(sch['emis'] ?? []);
        } catch (_) {}
      }
      if (mounted) setState(() { _loan = pick; _emis = emis; });
    } catch (_) {}
  }

  void _apply(String key, String name) {
    SelectedProduct.choose(key, name);
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PanVerifyScreen()));
  }

  String _date(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${m[d.month - 1]}';
  }

  // "Due today", "Due in 3 days", "2 days overdue"
  String _dueText(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    final now = DateTime.now();
    final days = DateTime(d.year, d.month, d.day).difference(DateTime(now.year, now.month, now.day)).inDays;
    if (days == 0) return 'Due today';
    if (days == 1) return 'Due tomorrow';
    if (days > 1) return 'Due in $days days';
    return '${-days} day${days == -1 ? '' : 's'} overdue';
  }

  void _push(Widget screen) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettings>();
    final user = context.watch<AuthService>().user;
    final first = (user?['firstName'] ?? '').toString().trim();
    final brand = _home?['brand'] is Map ? Map<String, dynamic>.from(_home!['brand'] as Map) : null;
    final banners = (_home?['banners'] is List) ? (_home!['banners'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
    final autoplay = (_home?['carousel'] is Map) ? (((_home!['carousel'] as Map)['autoplaySeconds'] as num?) ?? 4).toInt() : 4;
    final serverTime = DateTime.tryParse('${_home?['serverTime']}') ?? DateTime.now();
    final top = brandColors(brand, kNavy, const Color(0xFF9B1B30)).first;
    final hasOffer = _myOffer != null && _myOffer!['status'] != 'DECLINED';
    final products = buildProducts(settingsProducts: settings.products, pricing: _pricing, payday: _payday, repeatMax: _repeatMax, offerMax: hasOffer ? asNum(_myOffer!['amount']) : null);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle(statusBarColor: top, statusBarIconBrightness: Brightness.light, statusBarBrightness: Brightness.dark),
      child: Scaffold(
        backgroundColor: kBg,
        body: SafeArea(
          top: false,
          bottom: false,
          child: RefreshIndicator(
            color: kNavy,
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: EdgeInsets.zero,
              children: [
                BrandHeader(
                  first: first,
                  brand: brand,
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    if (settings.support) ...[
                      GestureDetector(
                        onTap: () => _push(const SupportScreen()),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(color: Colors.white.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
                          child: const Icon(Icons.chat_bubble_outline_rounded, color: Colors.white, size: 20),
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    const NotificationBell(),
                  ]),
                  logo: Image.asset('assets/images/lifc_logo.jpg', fit: BoxFit.contain),
                  bottom: _offerHero(hasOffer),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_phoneUnverified) _verifyPhoneCard(),
                      if (_setup != null && !setupComplete(_setup)) _setupCard(),
                      if (settings.banner != null) _banner(settings.banner!),
                    ],
                  ),
                ),
                // The rest of the screen is laid out from the web portal: which sections, in what order, with what words
                for (final id in settings.homeSections) ..._section(id, settings, products, banners, brand, autoplay, serverTime),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 26, 20, 28),
                  child: _footer(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // One home section, or nothing when it has nothing to show
  List<Widget> _section(String id, AppSettings settings, List<ProductInfo> products, List<Map<String, dynamic>> banners, Map<String, dynamic>? brand, int autoplay, DateTime serverTime) {
    const pad = EdgeInsets.fromLTRB(20, 24, 20, 0);
    switch (id) {
      case 'loan':
        return _loan == null ? [] : [Padding(padding: pad, child: _loanCard(_loan!))];
      case 'shortcuts':
        return [Padding(padding: pad, child: _shortcuts(settings))];
      case 'offers':
        if (banners.isEmpty) return [];
        return [
          Padding(padding: pad, child: SectionTitle(settings.homeText('offersTitle', 'Offers for you'))),
          const SizedBox(height: 12),
          OfferBanners(
            key: ValueKey(banners.map((b) => b['id']).join(',')),
            banners: banners,
            brand: brand,
            autoplaySeconds: autoplay,
            serverTime: serverTime,
            onAction: _bannerAction,
            onEvent: (i, type) => context.read<ApiService>().sendBannerEvent(i, type),
          ),
        ];
      case 'products':
        return [
          Padding(padding: pad, child: SectionTitle(settings.homeText('productsTitle', 'Loans made for you'), subtitle: settings.homeText('productsSubtitle', 'Pick what fits. Every charge is shown before you accept.'), action: products.length > 1 ? 'See all' : null, onAction: () => _push(const ProductsScreen()))),
          const SizedBox(height: 14),
          _productRail(products),
        ];
      case 'referral':
        return _referral == null ? [] : [Padding(padding: pad, child: _referralCard(_referral!))];
      case 'why':
        return [Padding(padding: pad, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [SectionTitle(settings.homeText('whyTitle', 'Why customers choose LIFC')), const SizedBox(height: 12), _whyGrid(settings)]))];
      case 'how':
        return [Padding(padding: pad, child: _howItWorks(settings))];
      case 'help':
        return [Padding(padding: pad, child: _helpCard(settings))];
    }
    return [];
  }

  // ── Header card: the customer's offer ──────────────────────────────────────

  Widget _offerHero(bool hasOffer) {
    if (_pricing == null) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
          Skeleton(height: 12, width: 110),
          SizedBox(height: 12),
          Skeleton(height: 34, width: 180),
          SizedBox(height: 14),
          Skeleton(height: 12),
          SizedBox(height: 18),
          Skeleton(height: 48, radius: 14),
        ]),
      );
    }
    final max = hasOffer ? asNum(_myOffer!['amount']) : (_repeatMax ?? asNum(_pricing?['maxAmount'] ?? 0));
    final rate = asNum(_pricing?['annualRatePercent'] ?? 0);
    final fee = asNum(_pricing?['processingFeePercent'] ?? 0);
    final lo = asNum(_pricing?['minTenureMonths'] ?? 0).toInt();
    final hi = asNum(_pricing?['maxTenureMonths'] ?? 0).toInt();
    final repaying = _loan != null && (_loan!['status'] == 'disbursed' || _loan!['status'] == 'defaulted');
    final label = hasOffer ? 'YOUR PRE-APPROVED OFFER' : (_repeatMax != null ? 'WELCOME BACK. YOUR LIMIT' : 'PERSONAL LOAN UP TO');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24), boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.18), blurRadius: 22, offset: const Offset(0, 10))]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(label, style: const TextStyle(color: kMuted, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1))),
            if (hasOffer) const Pill('Ready for you', color: kGood),
          ]),
          const SizedBox(height: 6),
          Text(max == 0 ? '₹ —' : formatMoney(max), style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800, height: 1.1, color: kNavy)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (rate > 0) _fact(Icons.percent_rounded, 'From ${formatPercent(rate)}% a year'),
            if (lo > 0 && hi > 0) _fact(Icons.event_repeat_rounded, lo == hi ? '$lo month${lo == 1 ? '' : 's'}' : '$lo to $hi months'),
            _fact(Icons.receipt_long_rounded, fee > 0 ? 'Fee ${formatPercent(fee)}% + GST' : 'No hidden charges'),
          ]),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => _apply('personal', 'Personal Loan'),
              child: Text(repaying ? 'Apply for another loan' : (hasOffer ? 'Get your loan' : 'Check your offer')),
            ),
          ),
          if (!hasOffer && !repaying) ...[
            const SizedBox(height: 8),
            const Center(child: Text('Checking does not commit you to anything.', style: TextStyle(fontSize: 11.5, color: kMuted))),
          ],
        ],
      ),
    );
  }

  Widget _fact(IconData icon, String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: kNavy.withOpacity(0.06), borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: kNavy),
          const SizedBox(width: 5),
          Text(text, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: kInk)),
        ]),
      );

  // ── The customer's own loan ────────────────────────────────────────────────

  Widget _loanCard(Map<String, dynamic> loan) {
    final status = (loan['status'] ?? '').toString();
    final repaying = status == 'disbursed' || status == 'defaulted';
    final amount = asNum(loan['loanAmount'] ?? loan['amount'] ?? 0);
    return AppCard(
      padding: const EdgeInsets.all(18),
      child: repaying ? _repaymentBody(loan, amount, status) : _applicationBody(loan, amount, status),
    );
  }

  Widget _repaymentBody(Map<String, dynamic> loan, num amount, String status) {
    final live = _emis.where((e) => e['status'] != 'WAIVED').toList();
    final paid = live.where((e) => e['status'] == 'PAID').length;
    final total = live.length;
    final next = live.where((e) => e['status'] != 'PAID').toList();
    final nextEmi = next.isEmpty ? null : next.first;
    final overdue = status == 'defaulted' || (nextEmi != null && nextEmi['status'] == 'OVERDUE');
    final tone = overdue ? const Color(0xFFB91C1C) : kGood;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Expanded(child: Text('YOUR LOAN', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1, color: kMuted))),
          Pill(overdue ? 'Payment overdue' : 'Active', color: tone),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(formatMoney(amount), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: kInk, height: 1.1)),
              const SizedBox(height: 4),
              Text(total > 0 ? '$paid of $total instalments paid' : 'Repayment schedule is being prepared', style: const TextStyle(fontSize: 12, color: kMuted)),
            ]),
          ),
          if (total > 0)
            ProgressRing(
              value: paid / total,
              color: tone,
              child: Text('${((paid / total) * 100).round()}%', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: tone)),
            ),
        ]),
        const SizedBox(height: 14),
        if (nextEmi != null)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: overdue ? const Color(0xFFFEF2F2) : kBg, borderRadius: BorderRadius.circular(16), border: Border.all(color: overdue ? const Color(0xFFFECACA) : kLine)),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(overdue ? 'Overdue instalment' : 'Next instalment', style: TextStyle(fontSize: 12, color: overdue ? const Color(0xFFB91C1C) : kMuted, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(formatMoney(asNum(nextEmi['amount']) + asNum(nextEmi['penaltyApplied'] ?? 0)), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: kInk)),
                  Text('${_dueText(nextEmi['dueDate'])} · ${_date(nextEmi['dueDate'])}', style: TextStyle(fontSize: 12, color: overdue ? const Color(0xFFB91C1C) : kMuted, fontWeight: overdue ? FontWeight.w600 : FontWeight.w400)),
                ]),
              ),
              ElevatedButton(
                onPressed: () => _openLoan(loan),
                style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 13)),
                child: const Text('Pay now'),
              ),
            ]),
          )
        else
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(onPressed: () => _openLoan(loan), child: const Text('View loan details')),
          ),
      ],
    );
  }

  Future<void> _openLoan(Map<String, dynamic> loan) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LoanDetailScreen(loan: loan)));
    _loadLoan();
  }

  Widget _applicationBody(Map<String, dynamic> loan, num amount, String status) {
    final step = status == 'approved' ? 2 : 1;
    const labels = ['Applied', 'Review', 'Approved', 'Money sent'];
    final tone = status == 'approved' ? const Color(0xFF2563EB) : const Color(0xFFD97706);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Expanded(child: Text('YOUR APPLICATION', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1, color: kMuted))),
          Pill(status == 'approved' ? 'Approved' : 'Under review', color: tone),
        ]),
        const SizedBox(height: 8),
        Text(formatMoney(amount), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: kInk, height: 1.1)),
        const SizedBox(height: 18),
        Row(
          children: List.generate(labels.length * 2 - 1, (i) {
            if (i.isOdd) {
              final done = (i ~/ 2) < step;
              return Expanded(child: Container(height: 3, decoration: BoxDecoration(color: done ? kGood : kLine, borderRadius: BorderRadius.circular(2))));
            }
            final idx = i ~/ 2;
            final done = idx < step;
            final current = idx == step;
            return Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: done ? kGood : Colors.white,
                border: Border.all(color: done || current ? kGood : const Color(0xFFD1D5DB), width: 2),
              ),
              child: done ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
            );
          }),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [for (final l in labels) Text(l, style: const TextStyle(fontSize: 10.5, color: kMuted, fontWeight: FontWeight.w600))],
        ),
        const SizedBox(height: 14),
        if (status == 'approved')
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => AgreementScreen(loan: loan)));
                _loadLoan();
              },
              child: const Text('Accept the agreement to get your money'),
            ),
          )
        else
          const Text('We are checking your details. You will get a notification as soon as there is an update.', style: TextStyle(fontSize: 12.5, color: kMuted, height: 1.4)),
      ],
    );
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────────

  Widget _shortcuts(AppSettings settings) {
    final items = <QuickAction>[
      QuickAction(Icons.payments_rounded, 'Pay EMI', kNavy, () => widget.onOpenTab?.call(5)),
      QuickAction(Icons.account_balance_wallet_rounded, 'My loans', const Color(0xFF7C3AED), () => widget.onOpenTab?.call(2)),
      if (settings.emiCalculator) QuickAction(Icons.calculate_rounded, 'EMI calculator', const Color(0xFF0891B2), () => _push(const EmiCalculatorScreen())),
      if (settings.eligibilityCheck) QuickAction(Icons.fact_check_rounded, 'Check eligibility', const Color(0xFF059669), () => _push(const EligibilityCheckScreen())),
      QuickAction(Icons.speed_rounded, 'Credit score', const Color(0xFFD97706), () => _push(const CreditScoreScreen())),
      if (_referral != null) QuickAction(Icons.card_giftcard_rounded, 'Refer & earn', const Color(0xFFDB2777), () => _push(const ReferralScreen())),
      QuickAction(Icons.phone_callback_rounded, 'Call back', const Color(0xFF2563EB), () => _push(const CallbackScreen())),
      if (settings.support) QuickAction(Icons.chat_bubble_rounded, 'Message us', const Color(0xFF0D9488), () => _push(const SupportScreen())),
    ];
    return QuickActionGrid(items: items.take(8).toList());
  }

  // ── Products ───────────────────────────────────────────────────────────────

  Widget _productRail(List<ProductInfo> products) {
    if (_pricing == null && products.isEmpty) {
      return const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: Skeleton(height: 250, radius: 22));
    }
    return SizedBox(
      height: 322,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
        itemCount: products.length,
        separatorBuilder: (_, __) => const SizedBox(width: 14),
        itemBuilder: (_, i) {
          final p = products[i];
          return ProductCard(name: p.name, tagline: p.tagline, upTo: p.upTo, facts: p.facts, icon: p.look.icon, colors: p.look.colors, badge: p.badge, onTap: () => openProduct(context, p));
        },
      ),
    );
  }

  // ── Trust, how it works, help, who we are ──────────────────────────────────

  static const _whyColors = [Color(0xFF7B0000), Color(0xFF0F766E), Color(0xFF1D4ED8), Color(0xFFB45309), Color(0xFF7C3AED), Color(0xFFDB2777)];
  static const _whyDefault = <Map<String, dynamic>>[
    {'icon': 'receipt', 'title': 'Charges shown first', 'text': 'A Key Fact Statement with the yearly cost, before you accept.'},
    {'icon': 'shield', 'title': 'Paperless KYC', 'text': 'Verify with DigiLocker and a quick selfie. No forms to post.'},
    {'icon': 'lock', 'title': 'Private and protected', 'text': 'App PIN lock, automatic sign-out, and your data stays yours.'},
    {'icon': 'translate', 'title': 'Help in your language', 'text': 'Message us, or ask for a call back at a time that suits you.'},
  ];

  Widget _whyGrid(AppSettings settings) {
    final tiles = settings.homeList('whyTiles', _whyDefault);
    return LayoutBuilder(builder: (context, c) {
      final w = (c.maxWidth - 12) / 2;
      return Wrap(spacing: 12, runSpacing: 12, children: [
        for (var i = 0; i < tiles.length; i++)
          SizedBox(width: w, child: TrustTile(icon: homeIcon('${tiles[i]['icon']}'), title: '${tiles[i]['title'] ?? ''}', subtitle: '${tiles[i]['text'] ?? ''}', color: _whyColors[i % _whyColors.length])),
      ]);
    });
  }

  static const _howDefault = <Map<String, dynamic>>[
    {'icon': 'badge', 'title': 'Verify yourself', 'text': 'PAN, phone number and a quick selfie'},
    {'icon': 'offer', 'title': 'See your offer', 'text': 'Every charge is shown before you accept'},
    {'icon': 'draw', 'title': 'Sign online', 'text': 'Read the agreement and sign in the app'},
    {'icon': 'bank', 'title': 'Get the money', 'text': 'Sent straight to your own bank account'},
  ];

  Widget _howItWorks(AppSettings settings) {
    final list = settings.homeList('howSteps', _howDefault);
    final steps = [for (final e in list) [homeIcon('${e['icon']}'), '${e['title'] ?? ''}', '${e['text'] ?? ''}']];
    return AppCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionTitle(settings.homeText('howTitle', 'How it works')),
          const SizedBox(height: 16),
          for (var i = 0; i < steps.length; i++)
            IntrinsicHeight(
              child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                SizedBox(
                  width: 38,
                  child: Column(children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(color: kNavy.withOpacity(0.09), shape: BoxShape.circle),
                      child: Icon(steps[i][0] as IconData, color: kNavy, size: 19),
                    ),
                    if (i != steps.length - 1) Expanded(child: Container(width: 2, margin: const EdgeInsets.symmetric(vertical: 4), color: kLine)),
                  ]),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: i == steps.length - 1 ? 0 : 16, top: 2),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${i + 1}. ${tr(steps[i][1] as String)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: kInk)),
                      const SizedBox(height: 2),
                      Text(steps[i][2] as String, style: const TextStyle(fontSize: 12, color: kMuted, height: 1.35)),
                    ]),
                  ),
                ),
              ]),
            ),
        ],
      ),
    );
  }

  Widget _helpCard(AppSettings settings) {
    return AppCard(
      color: kNavy.withOpacity(0.05),
      borderColor: Colors.transparent,
      shadow: false,
      padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(settings.homeText('helpTitle', 'Need a hand?'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: kInk)),
        const SizedBox(height: 4),
        Text(settings.homeText('helpText', 'Our team can walk you through any step, in your language.'), style: const TextStyle(fontSize: 12.5, color: kMuted, height: 1.4)),
        const SizedBox(height: 14),
        Row(children: [
          if (settings.support) ...[
            Expanded(child: ElevatedButton.icon(onPressed: () => _push(const SupportScreen()), icon: const Icon(Icons.chat_bubble_rounded, size: 17), label: const Text('Message us'), style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 13)))),
            const SizedBox(width: 10),
          ],
          Expanded(child: OutlinedButton.icon(onPressed: () => _push(const CallbackScreen()), icon: const Icon(Icons.phone_callback_rounded, size: 17), label: const Text('Call back'), style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 13), backgroundColor: Colors.white))),
        ]),
        const SizedBox(height: 4),
        Center(child: TextButton(onPressed: () => _push(const HelpScreen()), child: const Text('Help centre and contact details'))),
      ]),
    );
  }

  // Who the lender is, as set on the Pricing page. Nothing is claimed that has not been filled in there.
  Widget _footer() {
    final inst = (_pricing?['institution'] as Map?) ?? const {};
    final name = (inst['lenderName'] ?? '').toString();
    final reg = (inst['registrationNumber'] ?? '').toString();
    final gName = (inst['grievanceOfficerName'] ?? '').toString();
    final gMail = (inst['grievanceOfficerEmail'] ?? '').toString();
    if (name.isEmpty) return const SizedBox.shrink();
    return Column(children: [
      Text(reg.isEmpty ? name : '$name · Reg. no. $reg', textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, color: kMuted, fontWeight: FontWeight.w500)),
      if (gName.isNotEmpty || gMail.isNotEmpty) ...[
        const SizedBox(height: 4),
        Text('Grievance officer: ${[gName, gMail].where((e) => e.isNotEmpty).join(' · ')}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF), height: 1.4)),
      ],
    ]);
  }

  // A slim invitation to refer friends, shown only while the programme is on
  Widget _referralCard(Map<String, dynamic> r) {
    final mine = asNum(r['referrerReward'] ?? 0);
    return AppCard(
      onTap: () => _push(const ReferralScreen()),
      padding: const EdgeInsets.all(16),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: const Color(0xFFDB2777).withOpacity(0.10), borderRadius: BorderRadius.circular(14)),
          child: const Icon(Icons.card_giftcard_rounded, color: Color(0xFFDB2777), size: 24),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Refer & earn', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: kInk)),
            const SizedBox(height: 2),
            Text(mine > 0 ? 'Earn ${formatMoney(mine)} for every friend who joins' : 'Invite your friends', style: const TextStyle(fontSize: 12.5, color: kMuted)),
          ]),
        ),
        const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
      ]),
    );
  }

  Widget _setupCard() {
    final s = _setup!;
    final left = ['kyc', 'profile', 'selfie', 'bank'].where((k) => s[k] != true).length;
    return GestureDetector(
      onTap: () async {
        await runAccountSetup(context, s);
        _loadPhoneStatus();
      },
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(16)),
        child: Row(children: [
          const Icon(Icons.assignment_ind_outlined, color: Color(0xFF92400E), size: 22),
          const SizedBox(width: 12),
          Expanded(child: Text('Finish setting up your account: $left step${left == 1 ? '' : 's'} left (identity, details, selfie, bank). You need this before you can apply.', style: const TextStyle(color: Color(0xFF92400E), fontSize: 13, height: 1.4))),
          const Icon(Icons.chevron_right_rounded, color: Color(0xFF92400E)),
        ]),
      ),
    );
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
        decoration: BoxDecoration(color: kInk, borderRadius: BorderRadius.circular(16)),
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

  // The company's notice from the web portal
  Widget _banner(Map<String, dynamic> b) {
    final warn = b['level'] == 'warning';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: warn ? const Color(0xFFFEF3C7) : const Color(0xFFE0ECFF), borderRadius: BorderRadius.circular(14)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(warn ? Icons.warning_amber_rounded : Icons.info_outline_rounded, size: 20, color: warn ? const Color(0xFFB45309) : const Color(0xFF1D4ED8)),
          const SizedBox(width: 10),
          Expanded(child: Text((b['text'] ?? '').toString(), style: TextStyle(fontSize: 13, height: 1.4, color: warn ? const Color(0xFF92400E) : const Color(0xFF1E3A8A)))),
        ],
      ),
    );
  }
}
