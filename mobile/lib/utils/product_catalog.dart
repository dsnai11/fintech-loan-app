import 'package:flutter/material.dart';
import '../screens/pan_verify_screen.dart';
import '../screens/payday_screen.dart';
import '../services/selected_product.dart';
import '../widgets/ui_kit.dart';
import 'format.dart';

// One description of every loan product the customer can see, built from what the company set up in the web portal (the products
// list, the pricing, the payday advance switch). The home screen shows these as cards; the Explore screen shows them in full.
// A new product added in the portal appears here with no change to the app.
class ProductInfo {
  final String key;
  final String name;
  final String tagline;
  final bool isPayday;
  final num minAmount;
  final num maxAmount;
  final String upTo;
  final List<String> facts;
  final ProductLook look;
  final String cost; // the price in a few words
  final String repay; // how long, or when
  final String audience; // who it is for
  final String? badge;
  const ProductInfo({required this.key, required this.name, required this.tagline, required this.isPayday, required this.minAmount, required this.maxAmount, required this.upTo, required this.facts, required this.look, required this.cost, required this.repay, required this.audience, this.badge});
}

String _tenure(Map<String, dynamic>? pricing) {
  final lo = asNum(pricing?['minTenureMonths'] ?? 0).toInt();
  final hi = asNum(pricing?['maxTenureMonths'] ?? 0).toInt();
  if (lo <= 0 || hi <= 0) return 'Easy instalments';
  if (lo == hi) return '$lo month${lo == 1 ? '' : 's'}';
  return '$lo to $hi months';
}

String _audience(String key, String name) {
  final k = '$key $name'.toLowerCase();
  if (k.contains('payday') || k.contains('advance')) return 'Salaried customers who know their salary day';
  if (k.contains('salar')) return 'Salaried customers with a regular monthly income';
  if (k.contains('business') || k.contains('msme')) return 'Business owners and self-employed customers';
  return 'Customers with a regular income';
}

List<ProductInfo> buildProducts({
  required List<Map<String, dynamic>> settingsProducts,
  required Map<String, dynamic>? pricing,
  required Map<String, dynamic>? payday,
  num? repeatMax,
  num? offerMax,
}) {
  final out = <ProductInfo>[];
  final list = settingsProducts.isEmpty
      ? <Map<String, dynamic>>[{'key': 'personal', 'name': 'Personal Loan', 'description': 'Quick personal loan with the charges shown up front.', 'maxAmount': pricing?['maxAmount'], 'minAmount': pricing?['minAmount'], 'annualRatePercent': pricing?['annualRatePercent'], 'processingFeePercent': pricing?['processingFeePercent']}]
      : settingsProducts;
  for (final p in list) {
    final key = (p['key'] ?? 'personal').toString();
    final name = (p['name'] ?? 'Personal Loan').toString();
    final isMain = key == 'personal';
    var max = asNum(p['maxAmount'] ?? 0);
    if (isMain && repeatMax != null) max = repeatMax;
    if (isMain && offerMax != null && offerMax > 0) max = offerMax;
    final rate = asNum(p['annualRatePercent'] ?? 0);
    final fee = asNum(p['processingFeePercent'] ?? 0);
    final desc = (p['description'] ?? '').toString().trim();
    final look = productLook(key, name);
    out.add(ProductInfo(
      key: key,
      name: name,
      tagline: desc.isEmpty ? 'Quick money, every charge shown before you accept.' : desc,
      isPayday: false,
      minAmount: asNum(p['minAmount'] ?? 0),
      maxAmount: max,
      upTo: max > 0 ? 'Up to ${formatMoney(max)}' : 'Apply in minutes',
      facts: [
        if (rate > 0) 'Interest from ${formatPercent(rate)}% a year',
        'Repay in ${_tenure(pricing)}',
        if (fee > 0) 'Processing fee ${formatPercent(fee)}% plus GST' else 'All charges shown first',
      ],
      look: look,
      cost: rate > 0 ? 'From ${formatPercent(rate)}% a year' : (fee > 0 ? 'Fee ${formatPercent(fee)}% + GST' : 'Shown first'),
      repay: _tenure(pricing),
      audience: _audience(key, name),
      badge: isMain && (offerMax != null && offerMax > 0) ? 'Your offer' : null,
    ));
  }
  if (payday != null && payday['enabled'] == true) {
    final max = asNum(payday['maxAmount'] ?? 0);
    final fee = asNum(payday['feePercent'] ?? 0);
    out.add(ProductInfo(
      key: 'payday',
      name: 'Payday Advance',
      tagline: 'Part of your salary, early. Pay it back in one go on your payday.',
      isPayday: true,
      minAmount: asNum(payday['minAmount'] ?? 0),
      maxAmount: max,
      upTo: max > 0 ? 'Up to ${formatMoney(max)}' : 'Salary, a little early',
      facts: ['No monthly instalments', if (fee > 0) 'One flat fee of ${formatPercent(fee)}% plus GST' else 'One flat fee, shown first', 'Repay on your next payday'],
      look: productLook('payday', 'Payday Advance'),
      cost: fee > 0 ? 'Flat fee ${formatPercent(fee)}% + GST' : 'One flat fee',
      repay: 'Next payday',
      audience: _audience('payday', 'Payday Advance'),
      badge: 'Instant',
    ));
  }
  return out;
}

void openProduct(BuildContext context, ProductInfo p) {
  if (p.isPayday) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaydayScreen()));
    return;
  }
  SelectedProduct.choose(p.key, p.name);
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PanVerifyScreen()));
}
