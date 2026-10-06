import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../services/app_settings.dart';
import '../services/selected_product.dart';
import '../utils/format.dart';
import '../main.dart';
import 'pan_verify_screen.dart';
import 'notifications_screen.dart';
import 'help_screen.dart';
import 'emi_calculator_screen.dart';
import 'loan_detail_screen.dart';
import 'agreement_screen.dart';
import 'onboarding_flow.dart';

// Home tab. Top to bottom: greeting, any notice from the company, the offer, the customer's own loan (progress and
// next instalment, or where an application stands), shortcuts, and the loan products.
class HomeScreen extends StatefulWidget {
  final void Function(int tab)? onOpenTab;
  const HomeScreen({Key? key, this.onOpenTab}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _pricing;
  num? _repeatMax;
  bool _phoneUnverified = false;
  Map<String, dynamic>? _loan; // the loan that matters right now, if any
  List<Map<String, dynamic>> _emis = [];

  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AuthService>().loadUserProfile());
    Future.microtask(_refresh);
  }

  Future<void> _refresh() async {
    await Future.wait([_loadPricing(), _loadPhoneStatus(), _loadLoan()]);
  }

  Future<void> _loadPricing() async {
    try {
      final p = await context.read<ApiService>().getPricing();
      if (mounted) setState(() => _pricing = p);
      final offer = await context.read<ApiService>().getRepeatOffer();
      if (mounted) setState(() => _repeatMax = offer['eligible'] == true ? asNum(offer['maxAmount']) : null);
    } catch (_) {}
  }

  Future<void> _loadPhoneStatus() async {
    try {
      final s = await context.read<ApiService>().getOnboarding();
      if (mounted) setState(() => _phoneUnverified = s['phoneVerified'] != true);
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

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettings>();
    final user = context.watch<AuthService>().user;
    final first = (user?['firstName'] ?? '').toString().trim();
    return Scaffold(
      backgroundColor: kBg,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: kNavy,
          onRefresh: _refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
            children: [
              _topBar(first),
              const SizedBox(height: 18),
              if (_phoneUnverified) _verifyPhoneCard(),
              if (settings.banner != null) _banner(settings.banner!),
              _hero(settings),
              const SizedBox(height: 18),
              if (_loan != null) ...[_loanCard(_loan!), const SizedBox(height: 18)],
              _shortcuts(settings),
              const SizedBox(height: 22),
              _section('Loan offers'),
              const SizedBox(height: 10),
              if (settings.products.isEmpty)
                _offerCard('Personal Loan', _productLine({'key': 'personal', 'maxAmount': _pricing?['maxAmount'], 'description': ''}), () => _apply('personal', 'Personal Loan')),
              for (final p in settings.products)
                _offerCard((p['name'] ?? '').toString(), _productLine(p), () => _apply((p['key'] ?? 'personal').toString(), (p['name'] ?? 'Personal Loan').toString())),
              const SizedBox(height: 22),
              _howItWorks(),
              const SizedBox(height: 22),
              _footer(),
            ],
          ),
        ),
      ),
    );
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  Widget _topBar(String first) {
    return Row(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.asset('assets/images/lifc_logo.jpg', height: 40, width: 40, fit: BoxFit.contain),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Hi, ${first.isEmpty ? 'there' : first}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
            const Text('Laxmi India Finance', style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          ]),
        ),
        const NotificationBell(),
      ],
    );
  }

  Widget _section(String title) => Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF111827)));

  Widget _hero(AppSettings settings) {
    final max = _repeatMax ?? asNum(_pricing?['maxAmount'] ?? 0);
    final plans = (_pricing?['plans'] as Map?)?.values.map((p) => asNum((p as Map)['tenureMonths']).toInt()).toList() ?? <int>[];
    plans.sort();
    final repay = plans.isEmpty ? 'Repay in easy instalments' : 'Repay in ${plans.join(', ')} month${plans.length == 1 && plans.first == 1 ? '' : 's'}';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [kNavy, Color(0xFF9B1B30)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [BoxShadow(color: kNavy.withOpacity(0.25), blurRadius: 18, offset: const Offset(0, 8))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_repeatMax != null ? 'WELCOME BACK. YOUR LIMIT' : 'PERSONAL LOAN UP TO', style: const TextStyle(color: Colors.white70, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1)),
          const SizedBox(height: 8),
          Text(max == 0 ? '₹ —' : formatMoney(max), style: const TextStyle(color: Colors.white, fontSize: 38, fontWeight: FontWeight.w900, height: 1.05)),
          const SizedBox(height: 8),
          Text('$repay. Every charge is shown before you accept.', style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.4)),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => _apply('personal', 'Personal Loan'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: kNavy, padding: const EdgeInsets.symmetric(vertical: 15), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
              child: Text(_loan != null && (_loan!['status'] == 'disbursed' || _loan!['status'] == 'defaulted') ? 'Apply for another loan' : 'Check your offer', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ),
          ),
        ],
      ),
    );
  }

  // The customer's own loan: where an application stands, or how repayment is going.
  Widget _loanCard(Map<String, dynamic> loan) {
    final status = (loan['status'] ?? '').toString();
    final repaying = status == 'disbursed' || status == 'defaulted';
    final amount = asNum(loan['loanAmount'] ?? loan['amount'] ?? 0);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: repaying ? _repaymentBody(loan, amount, status) : _applicationBody(loan, amount, status),
    );
  }

  Widget _chip(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800)),
      );

  Widget _repaymentBody(Map<String, dynamic> loan, num amount, String status) {
    final live = _emis.where((e) => e['status'] != 'WAIVED').toList();
    final paid = live.where((e) => e['status'] == 'PAID').length;
    final total = live.length;
    final next = live.where((e) => e['status'] != 'PAID').toList();
    final nextEmi = next.isEmpty ? null : next.first;
    final overdue = status == 'defaulted' || (nextEmi != null && nextEmi['status'] == 'OVERDUE');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Expanded(child: Text('YOUR LOAN', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1, color: Color(0xFF9CA3AF)))),
          _chip(overdue ? 'Payment overdue' : 'Active', overdue ? const Color(0xFFB91C1C) : kGreen),
        ]),
        const SizedBox(height: 6),
        Text(formatMoney(amount), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
        const SizedBox(height: 14),
        if (total > 0) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(value: total == 0 ? 0 : paid / total, minHeight: 8, backgroundColor: const Color(0xFFF3F4F6), color: kGreen),
          ),
          const SizedBox(height: 6),
          Text('$paid of $total instalments paid', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          const SizedBox(height: 14),
        ],
        if (nextEmi != null)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: overdue ? const Color(0xFFFEF2F2) : const Color(0xFFF9FAFB), borderRadius: BorderRadius.circular(14)),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(overdue ? 'Overdue instalment' : 'Next instalment', style: TextStyle(fontSize: 12, color: overdue ? const Color(0xFFB91C1C) : const Color(0xFF6B7280), fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(formatMoney(asNum(nextEmi['amount']) + asNum(nextEmi['penaltyApplied'] ?? 0)), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
                  Text('Due ${_date(nextEmi['dueDate'])}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                ]),
              ),
              ElevatedButton(
                onPressed: () => _openLoan(loan),
                style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Expanded(child: Text('YOUR APPLICATION', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1, color: Color(0xFF9CA3AF)))),
          _chip(status == 'approved' ? 'Approved' : 'Under review', status == 'approved' ? const Color(0xFF2563EB) : const Color(0xFFD97706)),
        ]),
        const SizedBox(height: 6),
        Text(formatMoney(amount), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
        const SizedBox(height: 16),
        Row(
          children: List.generate(labels.length * 2 - 1, (i) {
            if (i.isOdd) {
              final done = (i ~/ 2) < step;
              return Expanded(child: Container(height: 2, color: done ? kGreen : const Color(0xFFE5E7EB)));
            }
            final idx = i ~/ 2;
            final done = idx < step;
            final current = idx == step;
            return Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: done ? kGreen : Colors.white,
                border: Border.all(color: done || current ? kGreen : const Color(0xFFD1D5DB), width: 2),
              ),
              child: done ? const Icon(Icons.check, size: 13, color: Colors.white) : null,
            );
          }),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [for (final l in labels) Text(l, style: const TextStyle(fontSize: 10.5, color: Color(0xFF6B7280), fontWeight: FontWeight.w600))],
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
          const Text('We are checking your details. You will get a notification as soon as there is an update.', style: TextStyle(fontSize: 12.5, color: Color(0xFF6B7280), height: 1.4)),
      ],
    );
  }

  Widget _shortcuts(AppSettings settings) {
    final items = <List<dynamic>>[
      [Icons.history_rounded, 'My loans', const Color(0xFF7C3AED), () => widget.onOpenTab?.call(1)],
      if (settings.emiCalculator) [Icons.calculate_rounded, 'EMI calculator', const Color(0xFF0891B2), () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmiCalculatorScreen()))],
      if (settings.support) [Icons.chat_bubble_rounded, 'Message us', const Color(0xFF059669), () => widget.onOpenTab?.call(2)],
      [Icons.support_agent_rounded, 'Help', const Color(0xFFD97706), () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HelpScreen()))],
    ];
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (final i in items)
          GestureDetector(
            onTap: i[3] as VoidCallback,
            child: SizedBox(
              width: 74,
              child: Column(children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(color: (i[2] as Color).withOpacity(0.12), borderRadius: BorderRadius.circular(18)),
                  child: Icon(i[0] as IconData, color: i[2] as Color, size: 26),
                ),
                const SizedBox(height: 8),
                Text(i[1] as String, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFF374151), height: 1.2)),
              ]),
            ),
          ),
      ],
    );
  }

  String _productLine(Map<String, dynamic> p) {
    final isMain = (p['key'] ?? '') == 'personal';
    final raw = p['maxAmount'];
    final max = (isMain && _repeatMax != null) ? _repeatMax! : asNum(raw ?? 0);
    final prefix = max == 0 ? 'Quick personal loan' : (isMain && _repeatMax != null) ? 'Up to ${formatMoney(max)} for you' : 'Up to ${formatMoney(max)}';
    final desc = (p['description'] ?? '').toString();
    return '$prefix${desc.isEmpty ? '' : '\n$desc'}';
  }

  Widget _offerCard(String title, String subtitle, VoidCallback onApply) {
    return GestureDetector(
      onTap: onApply,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: kNavy.withOpacity(0.10), borderRadius: BorderRadius.circular(14)),
            child: const Icon(Icons.currency_rupee_rounded, color: kNavy, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
              const SizedBox(height: 2),
              Text(subtitle, style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280), height: 1.35)),
            ]),
          ),
          const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }

  Widget _howItWorks() {
    const steps = [
      [Icons.badge_outlined, 'Verify', 'PAN and phone number'],
      [Icons.local_offer_outlined, 'See your offer', 'Every charge shown first'],
      [Icons.account_balance_outlined, 'Get the money', 'Sent to your bank account'],
    ];
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _section('How it works'),
          const SizedBox(height: 14),
          for (var i = 0; i < steps.length; i++)
            Padding(
              padding: EdgeInsets.only(bottom: i == steps.length - 1 ? 0 : 12),
              child: Row(children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(color: kNavy.withOpacity(0.08), shape: BoxShape.circle),
                  child: Icon(steps[i][0] as IconData, color: kNavy, size: 19),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${i + 1}. ${steps[i][1]}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
                    Text(steps[i][2] as String, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                  ]),
                ),
              ]),
            ),
        ],
      ),
    );
  }

  // Who the lender is, as set on the Pricing page. Nothing is claimed that has not been filled in there.
  Widget _footer() {
    final inst = (_pricing?['institution'] as Map?) ?? const {};
    final name = (inst['lenderName'] ?? '').toString();
    final reg = (inst['registrationNumber'] ?? '').toString();
    if (name.isEmpty) return const SizedBox.shrink();
    return Center(
      child: Text(reg.isEmpty ? name : '$name · Reg. no. $reg', textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, color: Color(0xFF9CA3AF))),
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
        margin: const EdgeInsets.only(bottom: 14),
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

  // The company's notice from the web portal
  Widget _banner(Map<String, dynamic> b) {
    final warn = b['level'] == 'warning';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: warn ? const Color(0xFFFEF3C7) : const Color(0xFFE0ECFF), borderRadius: BorderRadius.circular(12)),
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
