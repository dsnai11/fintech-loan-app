import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/format.dart';
import '../widgets/tr_text.dart';

// Refer and earn: the customer's code, how it works, and who they have invited. The amounts, rules and wording all
// come from the company's web portal.
class ReferralScreen extends StatefulWidget {
  const ReferralScreen({Key? key}) : super(key: key);

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  Map<String, dynamic>? _d;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getReferral();
      if (mounted) setState(() { _d = d; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not load. Pull down to try again.');
    }
  }

  void _copy(String code) {
    Clipboard.setData(ClipboardData(text: code));
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code copied')));
  }

  Future<void> _whatsapp(String text) async {
    final uri = Uri.parse('https://wa.me/?text=${Uri.encodeComponent(text)}');
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {}
    Clipboard.setData(ClipboardData(text: text));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Message copied. Paste it into any chat.')));
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return Scaffold(
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Refer & earn')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            if (d == null && _error == null) const Padding(padding: EdgeInsets.only(top: 80), child: Center(child: CircularProgressIndicator())),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 60), child: Center(child: Text(_error!, textAlign: TextAlign.center))),
            if (d != null && d['enabled'] != true)
              const Padding(padding: EdgeInsets.only(top: 60), child: Center(child: Text('Referral rewards are not available right now. Please check back soon.', textAlign: TextAlign.center))),
            if (d != null && d['enabled'] == true) ..._content(d),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(Map<String, dynamic> d) {
    final code = (d['code'] ?? '').toString();
    final stats = (d['stats'] is Map) ? Map<String, dynamic>.from(d['stats'] as Map) : <String, dynamic>{};
    final refs = (d['referrals'] is List) ? (d['referrals'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
    final mine = asNum(d['referrerReward'] ?? 0), theirs = asNum(d['refereeReward'] ?? 0);
    return [
      Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [kNavy, Color(0xFF9B1B30)], begin: Alignment.topLeft, end: Alignment.bottomRight),
          borderRadius: BorderRadius.circular(22),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('YOUR REFERRAL CODE', style: TextStyle(color: Colors.white70, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1)),
          const SizedBox(height: 8),
          SelectableText(code, style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w900, letterSpacing: 2)),
          const SizedBox(height: 10),
          Text('${mine > 0 ? 'You earn ${formatMoney(mine)}' : 'Invite friends'}${theirs > 0 ? ' and your friend earns ${formatMoney(theirs)}' : ''}.', style: const TextStyle(color: Colors.white70, fontSize: 13.5, height: 1.4)),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: code.isEmpty ? null : () => _copy(code),
                icon: const Icon(Icons.copy_rounded, size: 18),
                label: const Text('Copy code'),
                style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54), padding: const EdgeInsets.symmetric(vertical: 13), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: code.isEmpty ? null : () => _whatsapp((d['shareText'] ?? '').toString()),
                icon: const Icon(Icons.share_rounded, size: 18),
                label: const Text('Share on WhatsApp'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: kNavy, padding: const EdgeInsets.symmetric(vertical: 13), textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
              ),
            ),
          ]),
        ]),
      ),
      const SizedBox(height: 18),
      _card('How it works', [
        _step(1, 'Share your code with a friend'),
        _step(2, 'Your friend signs up with it and takes a loan'),
        _step(3, 'After the first month of on-time repayment, you both earn a reward'),
      ]),
      const SizedBox(height: 14),
      Row(children: [
        Expanded(child: _stat('Friends invited', '${stats['invited'] ?? 0}')),
        const SizedBox(width: 10),
        Expanded(child: _stat('Rewards earned', formatMoney(asNum(stats['earned'] ?? 0)))),
        const SizedBox(width: 10),
        Expanded(child: _stat('To be paid', formatMoney(asNum(stats['toBePaid'] ?? 0)))),
      ]),
      const SizedBox(height: 14),
      if (refs.isNotEmpty)
        _card('Friends you invited', [
          for (final r in refs)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(children: [
                Expanded(child: Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF111827)))),
                Text((r['label'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280))),
              ]),
            ),
        ]),
      const SizedBox(height: 14),
      ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: const Text('Terms', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        children: [Padding(padding: const EdgeInsets.only(bottom: 12), child: Text((d['terms'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280), height: 1.5)))],
      ),
    ];
  }

  Widget _card(String title, List<Widget> children) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
          const SizedBox(height: 10),
          ...children,
        ]),
      );

  Widget _step(int n, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 24, height: 24, alignment: Alignment.center, decoration: BoxDecoration(color: kNavy.withOpacity(0.10), shape: BoxShape.circle), child: Text('$n', style: const TextStyle(color: kNavy, fontWeight: FontWeight.w800, fontSize: 12.5))),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13.5, color: Color(0xFF374151), height: 1.4))),
        ]),
      );

  Widget _stat(String label, String value) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF6B7280), fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
        ]),
      );
}

// A row for the profile screen. It hides itself when the programme is off.
class ReferEarnRow extends StatefulWidget {
  const ReferEarnRow({Key? key}) : super(key: key);

  @override
  State<ReferEarnRow> createState() => _ReferEarnRowState();
}

class _ReferEarnRowState extends State<ReferEarnRow> {
  bool _on = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      try {
        final d = await context.read<ApiService>().getReferral();
        if (mounted) setState(() => _on = d['enabled'] == true);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_on) return const SizedBox.shrink();
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReferralScreen())),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: const [
          Icon(Icons.card_giftcard_rounded, color: kNavy),
          SizedBox(width: 14),
          Expanded(child: Text('Refer & earn', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
