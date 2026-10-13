import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../utils/error_utils.dart';
import '../utils/format.dart';
import '../utils/product_catalog.dart';
import '../widgets/tr_text.dart';
import '../widgets/ui_kit.dart';

// "Talk to an expert", for a product a partner lender provides (home loan, loan against property). The customer says what they need and
// agrees to be contacted; staff pass the request to a partner. The screen says plainly that the company introduces the loan and the
// partner lends it.
class LeadScreen extends StatefulWidget {
  final ProductInfo product;
  const LeadScreen({Key? key, required this.product}) : super(key: key);

  @override
  State<LeadScreen> createState() => _LeadScreenState();
}

class _LeadScreenState extends State<LeadScreen> {
  final _amount = TextEditingController();
  final _property = TextEditingController();
  final _city = TextEditingController();
  final _note = TextEditingController();
  String _employment = 'Salaried';
  String _consentText = 'I agree that LIFC and its partners may call, SMS or WhatsApp me about this loan request.';
  bool _agreed = false;
  bool _busy = false;
  bool _done = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      try {
        final t = await context.read<ApiService>().getLeadConsent();
        if (mounted && t.isNotEmpty) setState(() => _consentText = t);
      } catch (_) {}
    });
  }

  @override
  void dispose() {
    for (final c in [_amount, _property, _city, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _int(TextEditingController c) => int.tryParse(c.text.replaceAll(',', '').trim());

  Future<void> _send() async {
    if (!_agreed) {
      setState(() => _error = 'Please tick that you agree to be contacted.');
      return;
    }
    final amount = _int(_amount);
    if (_amount.text.trim().isNotEmpty && (amount == null || amount < 1000)) {
      setState(() => _error = 'Enter the loan amount in rupees, at least 1,000.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<ApiService>().submitLead(
            kind: widget.product.key,
            amount: amount,
            propertyValue: _int(_property),
            city: _city.text.trim(),
            employment: _employment,
            note: _note.text.trim(),
          );
      if (mounted) setState(() => _done = true);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final phone = '${context.read<AuthService>().user?['phone'] ?? ''}';
    if (_done) {
      return Scaffold(
        backgroundColor: kBg,
        appBar: AppBar(title: Text(p.name)),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.check_circle_rounded, color: kGood, size: 64),
            const SizedBox(height: 14),
            const Text('We have your request', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: kInk)),
            const SizedBox(height: 8),
            Text('Our team will call you${phone.isEmpty ? '' : ' on $phone'} to understand what you need and pass it to our partner lenders.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, height: 1.5, color: kMuted)),
            const SizedBox(height: 22),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
          ]),
        ),
      );
    }
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(title: Text(p.name)),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(gradient: LinearGradient(colors: p.look.colors, begin: Alignment.topLeft, end: Alignment.bottomRight), borderRadius: BorderRadius.circular(20)),
          child: Row(children: [
            Container(padding: const EdgeInsets.all(11), decoration: BoxDecoration(color: Colors.white.withOpacity(0.18), borderRadius: BorderRadius.circular(14)), child: Icon(p.look.icon, color: Colors.white, size: 24)),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.name, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 3),
              Text(p.tagline, style: TextStyle(color: Colors.white.withOpacity(0.9), fontSize: 12.5, height: 1.4)),
            ])),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          color: const Color(0xFFFEF3C7),
          borderColor: Colors.transparent,
          shadow: false,
          child: const Text('How this works: LIFC introduces you to partner banks and finance companies. The partner decides whether to lend, and sets the interest rate, fees and terms. You are under no obligation to take any offer.', style: TextStyle(fontSize: 12.5, color: Color(0xFF92400E), height: 1.45)),
        ),
        const SizedBox(height: 16),
        AppCard(
          padding: const EdgeInsets.all(18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Tell us what you need', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: _amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Loan amount you need (₹)', helperText: p.maxAmount > 0 ? 'Up to ${formatMoney(p.maxAmount)}' : null)),
            const SizedBox(height: 12),
            TextField(controller: _property, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Value of the property (₹), if you have one in mind')),
            const SizedBox(height: 12),
            TextField(controller: _city, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'City')),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _employment,
              decoration: const InputDecoration(labelText: 'You are'),
              items: const [
                DropdownMenuItem(value: 'Salaried', child: Text('Salaried')),
                DropdownMenuItem(value: 'Self-Employed', child: Text('Self-employed')),
                DropdownMenuItem(value: 'Business', child: Text('Business owner')),
                DropdownMenuItem(value: 'Other', child: Text('Other')),
              ],
              onChanged: (v) => setState(() => _employment = v ?? 'Salaried'),
            ),
            const SizedBox(height: 12),
            TextField(controller: _note, maxLength: 300, maxLines: 2, decoration: const InputDecoration(labelText: 'Anything we should know (best time to call)')),
            const SizedBox(height: 4),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _agreed,
              onChanged: (v) => setState(() { _agreed = v ?? false; _error = null; }),
              title: Text(_consentText, style: const TextStyle(fontSize: 12.5, height: 1.4)),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 4, bottom: 4), child: Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12.5))),
            const SizedBox(height: 8),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending...' : 'Ask for a call'))),
            const SizedBox(height: 8),
            Text('We will call the number on your account${phone.isEmpty ? '' : ' ($phone)'}.', style: const TextStyle(fontSize: 11.5, color: kMuted)),
          ]),
        ),
      ]),
    );
  }
}
