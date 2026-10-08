import 'package:flutter/material.dart' hide Text;
import 'tr_text.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

/// A settlement offer from the company for one loan: pay less than the full amount to close it. Shows nothing when there is no offer.
class SettlementOfferCard extends StatefulWidget {
  final String loanId;
  final VoidCallback? onChanged;
  const SettlementOfferCard({Key? key, required this.loanId, this.onChanged}) : super(key: key);

  @override
  State<SettlementOfferCard> createState() => _SettlementOfferCardState();
}

class _SettlementOfferCardState extends State<SettlementOfferCard> {
  Map<String, dynamic>? _offer;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getMySettlements();
      Map<String, dynamic>? mine;
      for (final o in List<Map<String, dynamic>>.from(d['offers'] ?? [])) {
        if (o['loanId'] == widget.loanId) mine = o;
      }
      if (mounted) setState(() => _offer = mine);
    } catch (_) {}
  }

  Future<void> _respond(bool accept) async {
    final o = _offer;
    if (o == null) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiService>().respondSettlement(o['id'].toString(), accept);
      await _load();
      widget.onChanged?.call();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  String _money(dynamic v) {
    final n = (v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0).round();
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (x) => '${x[1]},')}';
  }

  String _date(dynamic iso) {
    try {
      final d = DateTime.parse(iso.toString()).toLocal();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return '${d.day} ${months[d.month - 1]} ${d.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _offer;
    if (o == null) return const SizedBox.shrink();
    final accepted = o['status'] == 'accepted';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFFFFFBEB), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFFCD34D))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('A settlement offer for your loan', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 8),
        Text('Close this loan by paying ${_money(o['amount'])} instead of ${_money(o['originalDue'])}.', style: const TextStyle(fontSize: 14, height: 1.4)),
        const SizedBox(height: 4),
        Text('Open until ${_date(o['validUntil'])}.', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
        const SizedBox(height: 4),
        const Text('Settling may be recorded as "settled" on your credit report.', style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
        const SizedBox(height: 10),
        if (accepted)
          const Text('You accepted. Our team will contact you with the payment details. The loan closes once we receive the money.', style: TextStyle(fontSize: 13, color: Color(0xFF166534), fontWeight: FontWeight.w600))
        else
          Wrap(spacing: 8, children: [
            ElevatedButton(onPressed: _busy ? null : () => _respond(true), child: const Text('Accept offer')),
            TextButton(onPressed: _busy ? null : () => _respond(false), child: const Text('No thanks')),
          ]),
      ]),
    );
  }
}
