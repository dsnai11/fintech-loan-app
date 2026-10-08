import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/language_service.dart';
import '../widgets/home_banners.dart';
import '../widgets/tr_text.dart';
import 'app_actions.dart';

// Which offers the customer has already looked at, so the tab can show a dot for new ones.
class OffersSeen {
  static const _key = 'seen_offers';

  static Future<Set<String>> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      return (p.getStringList(_key) ?? <String>[]).toSet();
    } catch (_) {
      return <String>{};
    }
  }

  static Future<void> mark(Iterable<String> ids) async {
    try {
      final p = await SharedPreferences.getInstance();
      final s = (p.getStringList(_key) ?? <String>[]).toSet()..addAll(ids);
      await p.setStringList(_key, s.toList());
    } catch (_) {}
  }

  // How many of the current offers are new to this customer
  static Future<int> unseen(ApiService api) async {
    try {
      final r = await api.getOffers(lang: LanguageService.instance.code);
      final seen = await load();
      return ((r['offers'] as List?) ?? []).whereType<Map>().where((o) => !seen.contains('${o['id']}')).length;
    } catch (_) {
      return 0;
    }
  }
}

// The Offers tab. Everything on it is written and scheduled by the company on the web portal.
class OffersScreen extends StatefulWidget {
  final bool embedded; // shown as a tab (no back arrow)
  final String? openOfferId; // open this offer straight away, for a tapped notification
  final void Function(int tab)? onOpenTab;
  const OffersScreen({Key? key, this.embedded = false, this.openOfferId, this.onOpenTab}) : super(key: key);

  @override
  State<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends State<OffersScreen> {
  List<Map<String, dynamic>> _offers = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.read<ApiService>().getOffers(lang: LanguageService.instance.code);
      final list = ((r['offers'] as List?) ?? []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      if (!mounted) return;
      setState(() { _offers = list; _loading = false; _error = null; });
      OffersSeen.mark(list.map((o) => '${o['id']}'));
      final want = widget.openOfferId;
      if (want != null && want.isNotEmpty) {
        final hit = list.where((o) => '${o['id']}' == want);
        if (hit.isNotEmpty) _open(hit.first);
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = 'Could not load offers. Pull down to try again.'; });
    }
  }

  void _open(Map<String, dynamic> offer) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => OfferDetailScreen(offer: offer, onOpenTab: widget.onOpenTab)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        automaticallyImplyLeading: !widget.embedded,
        title: const Text('Offers'),
      ),
      body: RefreshIndicator(
        color: kNavy,
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading) const Padding(padding: EdgeInsets.only(top: 80), child: Center(child: CircularProgressIndicator())),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 60), child: Center(child: Text(_error!, textAlign: TextAlign.center))),
            if (!_loading && _error == null && _offers.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 80),
                child: Column(children: const [
                  Icon(Icons.local_offer_outlined, size: 54, color: Color(0xFFD1D5DB)),
                  SizedBox(height: 12),
                  Text('No offers right now', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
                  SizedBox(height: 4),
                  Text('Check back soon. We will tell you when there is something new.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
                ]),
              ),
            for (final o in _offers) Padding(padding: const EdgeInsets.only(bottom: 14), child: _OfferCard(offer: o, onTap: () => _open(o))),
          ],
        ),
      ),
    );
  }
}

// One offer as a card, with a live countdown when it has an end time
class _OfferCard extends StatefulWidget {
  final Map<String, dynamic> offer;
  final VoidCallback onTap;
  const _OfferCard({required this.offer, required this.onTap});

  @override
  State<_OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends State<_OfferCard> {
  Timer? _tick;
  Duration? _left;

  @override
  void initState() {
    super.initState();
    final end = DateTime.tryParse('${widget.offer['endsAt']}');
    if (end != null) {
      void update() {
        final d = end.difference(DateTime.now());
        if (mounted) setState(() => _left = d.isNegative ? Duration.zero : d);
      }

      update();
      _tick = Timer.periodic(const Duration(seconds: 1), (_) => update());
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  String _countdown() {
    final d = _left;
    if (d == null) return '';
    if (d == Duration.zero) return 'Ended';
    String two(int n) => n.toString().padLeft(2, '0');
    return 'Ends in ${d.inDays > 0 ? '${d.inDays}d ' : ''}${two(d.inHours % 24)}:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}';
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.offer;
    final cols = bannerGradient('${o['theme'] ?? 'brand'}', '${o['color1'] ?? ''}', '${o['color2'] ?? ''}');
    final cta = (o['cta'] is Map) ? Map<String, dynamic>.from(o['cta'] as Map) : <String, dynamic>{};
    final badge = '${o['badge'] ?? ''}', summary = '${o['summary'] ?? ''}', ctaText = '${cta['text'] ?? ''}';
    return GestureDetector(
      onTap: widget.onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(gradient: LinearGradient(colors: cols, begin: Alignment.topLeft, end: Alignment.bottomRight)),
          child: Stack(children: [
            Positioned(
              right: 0,
              top: 0,
              child: Container(width: 46, height: 46, decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(14)), child: Icon(bannerIcon('${o['icon'] ?? ''}'), color: Colors.white, size: 26)),
            ),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (badge.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.22), borderRadius: BorderRadius.circular(20)),
                  child: Text(badge, style: const TextStyle(color: Colors.white, fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                ),
              Padding(padding: const EdgeInsets.only(right: 56), child: Text('${o['title'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w900, height: 1.2))),
              if (summary.isNotEmpty) ...[
                const SizedBox(height: 4),
                Padding(padding: const EdgeInsets.only(right: 20), child: Text(summary, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.35))),
              ],
              const SizedBox(height: 14),
              Row(children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(11)),
                  child: Text(ctaText.isNotEmpty ? ctaText : 'View offer', style: const TextStyle(color: Color(0xFF111827), fontWeight: FontWeight.w800, fontSize: 12.5)),
                ),
                const Spacer(),
                if (_left != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.black.withOpacity(0.3), borderRadius: BorderRadius.circular(8)),
                    child: Text(_countdown(), style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                  ),
              ]),
            ]),
          ]),
        ),
      ),
    );
  }
}

// The full offer: details, a coupon code to copy, the terms, and the button
class OfferDetailScreen extends StatefulWidget {
  final Map<String, dynamic> offer;
  final void Function(int tab)? onOpenTab;
  const OfferDetailScreen({Key? key, required this.offer, this.onOpenTab}) : super(key: key);

  @override
  State<OfferDetailScreen> createState() => _OfferDetailScreenState();
}

class _OfferDetailScreenState extends State<OfferDetailScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<ApiService>().sendOfferEvent('${widget.offer['id']}', 'view'));
  }

  void _go(Map<String, dynamic> cta) {
    context.read<ApiService>().sendOfferEvent('${widget.offer['id']}', 'click');
    final nav = Navigator.of(context);
    // A tab switch has to close this screen first
    final open = widget.onOpenTab;
    runAppAction(context, '${cta['action']}', '${cta['url'] ?? ''}', onOpenTab: open == null ? null : (int t) { nav.popUntil((r) => r.isFirst); open(t); });
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.offer;
    final cols = bannerGradient('${o['theme'] ?? 'brand'}', '${o['color1'] ?? ''}', '${o['color2'] ?? ''}');
    final cta = (o['cta'] is Map) ? Map<String, dynamic>.from(o['cta'] as Map) : <String, dynamic>{};
    final canAct = '${cta['action'] ?? 'none'}' != 'none' && '${cta['text'] ?? ''}'.isNotEmpty;
    final details = '${o['details'] ?? ''}', terms = '${o['terms'] ?? ''}', code = '${o['couponCode'] ?? ''}', badge = '${o['badge'] ?? ''}';
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Offer')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(gradient: LinearGradient(colors: cols, begin: Alignment.topLeft, end: Alignment.bottomRight), borderRadius: BorderRadius.circular(20)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                if (badge.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(color: Colors.white.withOpacity(0.22), borderRadius: BorderRadius.circular(20)),
                    child: Text(badge, style: const TextStyle(color: Colors.white, fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                  ),
                const Spacer(),
                Icon(bannerIcon('${o['icon'] ?? ''}'), color: Colors.white, size: 28),
              ]),
              const SizedBox(height: 12),
              Text('${o['title'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900, height: 1.2)),
              if ('${o['summary'] ?? ''}'.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text('${o['summary']}', style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.4)),
              ],
            ]),
          ),
          if (details.isNotEmpty) _section('About this offer', Text(details, style: const TextStyle(fontSize: 14, color: Color(0xFF374151), height: 1.5))),
          if (code.isNotEmpty)
            _section(
              'Coupon code',
              Row(children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF9CA3AF), style: BorderStyle.solid)),
                  child: SelectableText(code, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, letterSpacing: 1.5)),
                ),
                const SizedBox(width: 10),
                TextButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: code));
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code copied')));
                  },
                  icon: const Icon(Icons.copy_rounded, size: 16),
                  label: const Text('Copy code'),
                ),
              ]),
            ),
          if (terms.isNotEmpty) _section('Terms', Text(terms, style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280), height: 1.5))),
          if (canAct) ...[
            const SizedBox(height: 18),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => _go(cta), child: Text('${cta['text']}'))),
          ],
        ],
      ),
    );
  }

  Widget _section(String title, Widget child) => Padding(
        padding: const EdgeInsets.only(top: 18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
          const SizedBox(height: 8),
          child,
        ]),
      );
}
