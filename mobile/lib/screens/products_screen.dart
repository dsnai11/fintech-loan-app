import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/app_settings.dart';
import '../utils/format.dart';
import '../utils/product_catalog.dart';
import '../widgets/tr_text.dart';
import '../widgets/ui_kit.dart';

// Every loan product in one place, with what each costs, who it is for and how long it runs, so a customer can choose with the facts in front of them.
class ProductsScreen extends StatefulWidget {
  const ProductsScreen({Key? key}) : super(key: key);

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  Map<String, dynamic>? _pricing;
  Map<String, dynamic>? _payday;
  num? _offer;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final api = context.read<ApiService>();
    try { _pricing = await api.getPricing(); } catch (_) {}
    try { final r = await api.getPaydayStatus(); _payday = r['enabled'] == true ? r : null; } catch (_) {}
    try {
      final m = await api.getMyOffer();
      final o = m['offer'];
      if (o is Map && o['status'] != 'DECLINED') _offer = asNum(o['amount']);
    } catch (_) {}
    if (mounted) setState(() => _loaded = true);
  }

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettings>();
    final products = buildProducts(settingsProducts: settings.products, pricing: _pricing, payday: _payday, offerMax: _offer, marketplace: settings.marketplace);
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(title: const Text('Loan products')),
      body: !_loaded && products.isEmpty
          ? const Center(child: CircularProgressIndicator(color: kNavy))
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
              children: [
                const Text('Choose the loan that fits', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: kInk, height: 1.2)),
                const SizedBox(height: 4),
                const Text('Your identity check is done once. After that, applying for any product takes a few taps.', style: TextStyle(fontSize: 13, color: kMuted, height: 1.45)),
                const SizedBox(height: 18),
                if (products.length > 1) ...[_compare(products), const SizedBox(height: 20)],
                for (final p in products) ...[_detail(p), const SizedBox(height: 16)],
                const Text('The amount and price you are offered depend on your income and credit record. You see the exact figures, with every charge, before you accept.', style: TextStyle(fontSize: 11.5, color: kMuted, height: 1.45)),
              ],
            ),
    );
  }

  Widget _compare(List<ProductInfo> products) {
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
          child: Row(children: const [
            Expanded(flex: 4, child: Text('At a glance', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: kInk))),
            Expanded(flex: 3, child: Text('Up to', style: TextStyle(fontSize: 11.5, color: kMuted, fontWeight: FontWeight.w600))),
            Expanded(flex: 4, child: Text('Repay', style: TextStyle(fontSize: 11.5, color: kMuted, fontWeight: FontWeight.w600))),
          ]),
        ),
        for (final p in products) ...[
          const Divider(height: 1),
          InkWell(
            onTap: () => openProduct(context, p),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(children: [
                Expanded(
                  flex: 4,
                  child: Row(children: [
                    Container(width: 8, height: 8, decoration: BoxDecoration(color: p.look.colors.first, shape: BoxShape.circle)),
                    const SizedBox(width: 8),
                    Expanded(child: Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: kInk))),
                  ]),
                ),
                Expanded(flex: 3, child: Text(p.maxAmount > 0 ? formatMoney(p.maxAmount) : '-', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: kNavy))),
                Expanded(flex: 4, child: Text(p.repay, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: kMuted))),
              ]),
            ),
          ),
        ],
      ]),
    );
  }

  Widget _stat(String label, String value) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 11, color: kMuted, fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(value, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: kInk, height: 1.25)),
        ]),
      );

  Widget _detail(ProductInfo p) {
    final range = p.minAmount > 0 && p.maxAmount > 0 ? '${formatMoney(p.minAmount)} to ${formatMoney(p.maxAmount)}' : (p.maxAmount > 0 ? 'Up to ${formatMoney(p.maxAmount)}' : 'Shown on apply');
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: Container(
        decoration: BoxDecoration(color: Colors.white, border: Border.all(color: kLine), borderRadius: BorderRadius.circular(22)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
            decoration: BoxDecoration(gradient: LinearGradient(colors: p.look.colors, begin: Alignment.topLeft, end: Alignment.bottomRight)),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(color: Colors.white.withOpacity(0.18), borderRadius: BorderRadius.circular(14)),
                child: Icon(p.look.icon, color: Colors.white, size: 24),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(p.name, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700))),
                    if (p.badge != null) Container(padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3), decoration: BoxDecoration(color: Colors.white.withOpacity(0.22), borderRadius: BorderRadius.circular(20)), child: Text(p.badge!, style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w700))),
                  ]),
                  const SizedBox(height: 4),
                  Text(p.tagline, style: TextStyle(color: Colors.white.withOpacity(0.88), fontSize: 12.5, height: 1.4)),
                ]),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(18),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [_stat('Amount', range), const SizedBox(width: 12), _stat('Cost', p.cost), const SizedBox(width: 12), _stat('Repay', p.repay)]),
              const SizedBox(height: 16),
              for (final f in p.facts)
                Padding(
                  padding: const EdgeInsets.only(bottom: 7),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Icon(Icons.check_circle_rounded, size: 16, color: kGood),
                    const SizedBox(width: 8),
                    Expanded(child: Text(f, style: const TextStyle(fontSize: 13, color: kInk, height: 1.35))),
                  ]),
                ),
              const SizedBox(height: 4),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.person_outline_rounded, size: 16, color: kMuted),
                const SizedBox(width: 8),
                Expanded(child: Text('For: ${p.audience}', style: const TextStyle(fontSize: 12.5, color: kMuted, height: 1.35))),
              ]),
              const SizedBox(height: 16),
              SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => openProduct(context, p), child: Text(p.isLead ? 'Talk to us about ${p.name}' : 'Apply for ${p.name}'))),
            ]),
          ),
        ]),
      ),
    );
  }
}
