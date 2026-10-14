import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/format.dart';
import '../widgets/tr_text.dart';
import '../widgets/ui_kit.dart';
import 'loan_detail_screen.dart';
import 'pay_options_screen.dart';
import 'products_screen.dart';
import '../utils/responsive.dart';

// The Pay tab: what is due, across every loan, and the quickest way to pay it.
class PayHubScreen extends StatefulWidget {
  const PayHubScreen({Key? key}) : super(key: key);

  @override
  State<PayHubScreen> createState() => _PayHubScreenState();
}

class _Due {
  final Map<String, dynamic> loan;
  final Map<String, dynamic> emi;
  _Due(this.loan, this.emi);
  DateTime get date => DateTime.tryParse('${emi['dueDate']}')?.toLocal() ?? DateTime(2100);
  num get amount => asNum(emi['amount']) + asNum(emi['penaltyApplied'] ?? 0);
  bool get overdue => emi['status'] == 'OVERDUE' || emi['status'] == 'FAILED' || DateTime(date.year, date.month, date.day).isBefore(DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day));
  String get loanName {
    final k = loan['kfs'];
    final n = k is Map ? (k['productName'] ?? '').toString() : '';
    return n.isNotEmpty ? n : (loan['loanType'] ?? 'Loan').toString();
  }
}

class _PayHubScreenState extends State<PayHubScreen> {
  List<_Due> _dues = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      final api = context.read<ApiService>();
      final loans = await api.getAllLoans();
      final dues = <_Due>[];
      for (final l in loans.where((l) => l['status'] == 'disbursed' || l['status'] == 'defaulted')) {
        try {
          final sch = await api.getEmiSchedule(l['_id'].toString());
          for (final e in List<Map<String, dynamic>>.from(sch['emis'] ?? [])) {
            if (e['status'] != 'PAID' && e['status'] != 'WAIVED') dues.add(_Due(l, e));
          }
        } catch (_) {}
      }
      dues.sort((a, b) => a.date.compareTo(b.date));
      if (mounted) setState(() { _dues = dues; _loading = false; _error = null; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _error = 'We could not load your payments. Pull down to try again.'; });
    }
  }

  String _date(DateTime d) {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${m[d.month - 1]} ${d.year}';
  }

  String _when(_Due d) {
    final now = DateTime.now();
    final days = DateTime(d.date.year, d.date.month, d.date.day).difference(DateTime(now.year, now.month, now.day)).inDays;
    if (days == 0) return 'Due today';
    if (days == 1) return 'Due tomorrow';
    if (days > 1) return 'Due in $days days';
    return '${-days} day${days == -1 ? '' : 's'} overdue';
  }

  Future<void> _pay(_Due d) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LoanDetailScreen(loan: d.loan)));
    _load();
  }

  Future<void> _more(_Due d) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PayOptionsScreen(loanId: d.loan['_id'].toString())));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final overdue = _dues.where((d) => d.overdue).toList();
    final soon = _dues.where((d) => !d.overdue && d.date.difference(DateTime.now()).inDays <= 30).toList();
    final overdueTotal = overdue.fold<num>(0, (a, d) => a + d.amount);
    final soonTotal = soon.fold<num>(0, (a, d) => a + d.amount);
    final next = _dues.isEmpty ? null : _dues.first;
    if (isWide(context)) return _wideBuild(overdue, soon, overdueTotal, soonTotal, next);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(statusBarColor: kNavy, statusBarIconBrightness: Brightness.light, statusBarBrightness: Brightness.dark),
      child: Scaffold(
        backgroundColor: kBg,
        body: RefreshIndicator(
          color: kNavy,
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            children: [
              _header(overdueTotal, soonTotal, overdue.length),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
                child: _loading ? _skeleton() : (_error != null ? _errorBox() : (_dues.isEmpty ? _allClear() : _content(next!, overdue, soon))),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statCard(String label, String value, String note, Color tone) => AppCard(
        padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: kMuted, fontSize: 12.5, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(color: tone, fontSize: 28, fontWeight: FontWeight.w800, height: 1.1)),
          const SizedBox(height: 4),
          Text(note, style: const TextStyle(color: kMuted, fontSize: 12)),
        ]),
      );

  Widget _wideBuild(List<_Due> overdue, List<_Due> soon, num overdueTotal, num soonTotal, _Due? next) {
    final hasOverdue = overdueTotal > 0;
    return Scaffold(
      backgroundColor: kBg,
      body: RefreshIndicator(
        color: kNavy,
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(32, 32, 32, 40),
          children: [
            const Text('Pay', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: kInk)),
            const SizedBox(height: 4),
            const Text('Your instalments, in one place.', style: TextStyle(fontSize: 14.5, color: kMuted)),
            const SizedBox(height: 24),
            if (_loading) _skeleton()
            else if (_error != null) _errorBox()
            else if (_dues.isEmpty) Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: _allClear()))
            else ...[
              Row(children: [
                Expanded(child: _statCard('Overdue', hasOverdue ? formatMoney(overdueTotal) : '₹0', hasOverdue ? '${overdue.length} instalment${overdue.length == 1 ? '' : 's'}' : 'Nothing late', hasOverdue ? const Color(0xFFB91C1C) : kGood)),
                const SizedBox(width: 20),
                Expanded(child: _statCard('Due in 30 days', formatMoney(soonTotal), soonTotal > 0 ? 'Plan ahead' : 'All clear', kInk)),
              ]),
              const SizedBox(height: 24),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(flex: 5, child: _nextCard(next!)),
                const SizedBox(width: 24),
                Expanded(flex: 6, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (_dues.length > 1) _comingUp(_dues.skip(1).take(8).toList()),
                  const SizedBox(height: 20),
                  _autoDebitNote(),
                ])),
              ]),
            ],
          ],
        ),
      ),
    );
  }

  Widget _header(num overdueTotal, num soonTotal, int overdueCount) {
    final hasOverdue = overdueTotal > 0;
    return Container(
      padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 18, 20, 24),
      decoration: const BoxDecoration(
        gradient: LinearGradient(colors: [kNavy, Color(0xFF9B1B30)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Pay', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)),
        const SizedBox(height: 2),
        Text('Your instalments, in one place', style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 13)),
        const SizedBox(height: 18),
        if (_loading)
          Row(children: [
            Expanded(child: Container(height: 74, decoration: BoxDecoration(color: Colors.white.withOpacity(0.14), borderRadius: BorderRadius.circular(18)))),
            const SizedBox(width: 12),
            Expanded(child: Container(height: 74, decoration: BoxDecoration(color: Colors.white.withOpacity(0.14), borderRadius: BorderRadius.circular(18)))),
          ])
        else
          Row(children: [
            Expanded(child: _headStat('Overdue', hasOverdue ? formatMoney(overdueTotal) : '₹0', hasOverdue ? '$overdueCount instalment${overdueCount == 1 ? '' : 's'}' : 'Nothing late', hasOverdue ? const Color(0xFFFFB4B4) : const Color(0xFFBBF7D0))),
            const SizedBox(width: 12),
            Expanded(child: _headStat('Due in 30 days', formatMoney(soonTotal), soonTotal > 0 ? 'Plan ahead' : 'All clear', Colors.white)),
          ]),
      ]),
    );
  }

  Widget _headStat(String label, String value, String note, Color tone) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white.withOpacity(0.14), borderRadius: BorderRadius.circular(18)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 11.5, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(color: tone, fontSize: 21, fontWeight: FontWeight.w800, height: 1.15)),
          const SizedBox(height: 2),
          Text(note, style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 11)),
        ]),
      );

  Widget _content(_Due next, List<_Due> overdue, List<_Due> soon) {
    final rest = _dues.skip(1).take(8).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _nextCard(next),
      if (rest.isNotEmpty) ...[const SizedBox(height: 24), _comingUp(rest)],
      const SizedBox(height: 22),
      _autoDebitNote(),
    ]);
  }

  Widget _nextCard(_Due next) {
    final late = next.overdue;
    return AppCard(
      padding: const EdgeInsets.all(18),
      borderColor: late ? const Color(0xFFFECACA) : kLine,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(late ? 'PAY THIS FIRST' : 'NEXT PAYMENT', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1, color: kMuted))),
          Pill(_when(next), color: late ? const Color(0xFFB91C1C) : kGood),
        ]),
        const SizedBox(height: 8),
        Text(formatMoney(next.amount), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: kInk, height: 1.1)),
        const SizedBox(height: 4),
        Text('${next.loanName} · instalment ${next.emi['emiNumber'] ?? ''} · ${_date(next.date)}', style: const TextStyle(fontSize: 12.5, color: kMuted)),
        if (asNum(next.emi['penaltyApplied'] ?? 0) > 0) ...[
          const SizedBox(height: 6),
          Text('Includes a late fee of ${formatMoney(asNum(next.emi['penaltyApplied']))}', style: const TextStyle(fontSize: 12, color: Color(0xFFB91C1C))),
        ],
        const SizedBox(height: 16),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => _pay(next), child: Text('Pay ${formatMoney(next.amount)}'))),
        const SizedBox(height: 8),
        SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => _more(next), child: const Text('More ways to pay'))),
      ]),
    );
  }

  Widget _comingUp(List<_Due> rest) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionTitle('Coming up'),
      const SizedBox(height: 12),
      AppCard(
        padding: EdgeInsets.zero,
        child: Column(children: [
          for (var i = 0; i < rest.length; i++) ...[
            if (i > 0) const Divider(height: 1),
            InkWell(
              onTap: () => _pay(rest[i]),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                child: Row(children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(color: (rest[i].overdue ? const Color(0xFFB91C1C) : kNavy).withOpacity(0.09), borderRadius: BorderRadius.circular(13)),
                    child: Icon(Icons.event_rounded, size: 20, color: rest[i].overdue ? const Color(0xFFB91C1C) : kNavy),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(formatMoney(rest[i].amount), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: kInk)),
                      Text('${rest[i].loanName} · ${_date(rest[i].date)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: kMuted)),
                    ]),
                  ),
                  Text(_when(rest[i]), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: rest[i].overdue ? const Color(0xFFB91C1C) : kMuted)),
                ]),
              ),
            ),
          ],
        ]),
      ),
    ]);
  }

  Widget _autoDebitNote() => AppCard(
        color: kNavy.withOpacity(0.05),
        borderColor: Colors.transparent,
        shadow: false,
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: const [
          Icon(Icons.autorenew_rounded, color: kNavy, size: 22),
          SizedBox(width: 12),
          Expanded(child: Text('Never miss a due date. Open a loan and switch on auto-debit, and the instalment is collected from your bank account on the day.', style: TextStyle(fontSize: 12.5, color: kInk, height: 1.45))),
        ]),
      );

  Widget _allClear() {
    return Column(children: [
      const SizedBox(height: 18),
      Container(
        width: 84,
        height: 84,
        decoration: BoxDecoration(color: kGood.withOpacity(0.12), shape: BoxShape.circle),
        child: const Icon(Icons.verified_rounded, color: kGood, size: 44),
      ),
      const SizedBox(height: 16),
      const Text('Nothing to pay right now', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: kInk)),
      const SizedBox(height: 6),
      const Text('When you have a loan, its instalments show up here with the quickest way to pay.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: kMuted, height: 1.45)),
      const SizedBox(height: 20),
      ElevatedButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProductsScreen())), child: const Text('Explore loans')),
    ]);
  }

  Widget _errorBox() => AppCard(child: Column(children: [
        const Icon(Icons.cloud_off_rounded, color: kMuted, size: 34),
        const SizedBox(height: 10),
        Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: kMuted)),
        const SizedBox(height: 10),
        TextButton(onPressed: () { setState(() => _loading = true); _load(); }, child: const Text('Try again')),
      ]));

  Widget _skeleton() => Column(children: const [
        Skeleton(height: 200, radius: 20),
        SizedBox(height: 20),
        Skeleton(height: 70, radius: 16),
        SizedBox(height: 10),
        Skeleton(height: 70, radius: 16),
      ]);
}
