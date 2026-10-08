import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show FontFeature;
import 'package:flutter/material.dart';
import 'tr_text.dart' show tr;

// The home screen's branded header and the animated offer banners. All of the words, colours, timing and
// targeting come from the company's web portal (Offers and branding); nothing here is fixed in the app.

Color _hex(dynamic v, Color fallback) {
  final s = (v ?? '').toString().replaceAll('#', '');
  if (s.length != 6) return fallback;
  final n = int.tryParse(s, radix: 16);
  return n == null ? fallback : Color(0xFF000000 | n);
}

const _themes = <String, List<Color>>{
  'sunrise': [Color(0xFFF97316), Color(0xFFDB2777)],
  'ocean': [Color(0xFF2563EB), Color(0xFF0891B2)],
  'emerald': [Color(0xFF059669), Color(0xFF0D9488)],
  'royal': [Color(0xFF7C3AED), Color(0xFF4338CA)],
  'gold': [Color(0xFFD97706), Color(0xFF92400E)],
  'midnight': [Color(0xFF1F2937), Color(0xFF0B1220)],
};

const _icons = <String, IconData>{
  'rupee': Icons.currency_rupee_rounded,
  'gift': Icons.card_giftcard_rounded,
  'bolt': Icons.bolt_rounded,
  'star': Icons.star_rounded,
  'shield': Icons.verified_user_rounded,
  'clock': Icons.schedule_rounded,
  'rocket': Icons.rocket_launch_rounded,
  'heart': Icons.favorite_rounded,
  'calendar': Icons.event_rounded,
  'party': Icons.celebration_rounded,
};

const _trustIcons = <String, IconData>{
  'receipt': Icons.receipt_long_rounded,
  'lock': Icons.lock_rounded,
  'check': Icons.check_circle_rounded,
  'shield': Icons.verified_user_rounded,
  'bolt': Icons.bolt_rounded,
  'heart': Icons.favorite_rounded,
  'star': Icons.star_rounded,
};

List<Color> brandColors(Map<String, dynamic>? brand, Color a, Color b) =>
    [_hex(brand?['primaryColor'], a), _hex(brand?['secondaryColor'], b)];

// ── Header: greeting, company name or tagline, slow moving shapes behind, trust points underneath ─────────
class BrandHeader extends StatefulWidget {
  final String first;
  final Map<String, dynamic>? brand;
  final Widget trailing;
  final Widget logo;
  const BrandHeader({Key? key, required this.first, required this.brand, required this.trailing, required this.logo}) : super(key: key);

  @override
  State<BrandHeader> createState() => _BrandHeaderState();
}

class _BrandHeaderState extends State<BrandHeader> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 8));

  @override
  void initState() {
    super.initState();
    if (widget.brand?['heroAnimation'] != false) _c.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(covariant BrandHeader old) {
    super.didUpdateWidget(old);
    final animate = widget.brand?['heroAnimation'] != false;
    if (animate && !_c.isAnimating) _c.repeat(reverse: true);
    if (!animate && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.brand;
    final cols = brandColors(b, const Color(0xFF7B0000), const Color(0xFFC41E3A));
    final tagline = (b?['tagline'] ?? '').toString().trim();
    final name = (b?['name'] ?? '').toString().trim();
    final reg = (b?['registration'] ?? '').toString().trim();
    final strip = (b?['trustStrip'] is List) ? (b!['trustStrip'] as List).whereType<Map>().toList() : <Map>[];
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: cols, begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(26)),
      ),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(26)),
        child: Stack(
          children: [
            Positioned.fill(
              child: AnimatedBuilder(
                animation: _c,
                builder: (_, __) => CustomPaint(painter: _OrbPainter(_c.value)),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 12, 20, 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      ClipRRect(borderRadius: BorderRadius.circular(10), child: SizedBox(height: 40, width: 40, child: widget.logo)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${tr('Hi')}, ${widget.first.isEmpty ? tr('there') : widget.first}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Colors.white)),
                          Text(tagline.isNotEmpty ? tagline : name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: Colors.white70)),
                        ]),
                      ),
                      widget.trailing,
                    ],
                  ),
                  if (reg.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text('${name.isEmpty ? '' : '$name · '}$reg', style: const TextStyle(fontSize: 10.5, color: Colors.white60)),
                  ],
                  if (strip.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        for (var i = 0; i < strip.length; i++) ...[
                          if (i > 0) const SizedBox(width: 8),
                          Expanded(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                              decoration: BoxDecoration(color: Colors.white.withOpacity(0.14), borderRadius: BorderRadius.circular(12)),
                              child: Column(children: [
                                Icon(_trustIcons[strip[i]['icon']] ?? Icons.check_circle_rounded, color: Colors.white, size: 16),
                                const SizedBox(height: 4),
                                Text((strip[i]['text'] ?? '').toString(), textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 10, height: 1.2, fontWeight: FontWeight.w600)),
                              ]),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OrbPainter extends CustomPainter {
  final double t;
  _OrbPainter(this.t);

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = Colors.white.withOpacity(0.07);
    canvas.drawCircle(Offset(size.width - 30 - 14 * t, 20 + 10 * t), 70, p);
    canvas.drawCircle(Offset(30 + 12 * t, 8 - 6 * t), 34, p);
  }

  @override
  bool shouldRepaint(covariant _OrbPainter old) => old.t != t;
}

// ── Offer banners ────────────────────────────────────────────────────────────────────────────────
// onAction receives the banner's action word (apply, loans, calculator, messages, help, url) and its link.
// onEvent is told when a banner is first shown and when it is tapped, for the counts in the portal.
class OfferBanners extends StatefulWidget {
  final List<Map<String, dynamic>> banners;
  final Map<String, dynamic>? brand;
  final int autoplaySeconds;
  final DateTime serverTime;
  final void Function(String action, String url) onAction;
  final void Function(String id, String type) onEvent;
  const OfferBanners({Key? key, required this.banners, required this.brand, required this.autoplaySeconds, required this.serverTime, required this.onAction, required this.onEvent}) : super(key: key);

  @override
  State<OfferBanners> createState() => _OfferBannersState();
}

class _OfferBannersState extends State<OfferBanners> {
  final PageController _page = PageController(viewportFraction: 0.94);
  Timer? _auto;
  int _index = 0;
  final Set<String> _seen = {};
  late final Duration _skew = widget.serverTime.difference(DateTime.now());

  @override
  void initState() {
    super.initState();
    _startAuto();
    WidgetsBinding.instance.addPostFrameCallback((_) => _seeing(0));
  }

  @override
  void didUpdateWidget(covariant OfferBanners old) {
    super.didUpdateWidget(old);
    if (old.autoplaySeconds != widget.autoplaySeconds) _startAuto();
    if (_index >= widget.banners.length) _index = 0;
  }

  void _startAuto() {
    _auto?.cancel();
    if (widget.autoplaySeconds <= 0 || widget.banners.length < 2) return;
    _auto = Timer.periodic(Duration(seconds: widget.autoplaySeconds), (_) {
      if (!mounted || !_page.hasClients || widget.banners.length < 2) return;
      final next = (_index + 1) % widget.banners.length;
      _page.animateToPage(next, duration: const Duration(milliseconds: 500), curve: Curves.easeInOut);
    });
  }

  void _seeing(int i) {
    if (i < 0 || i >= widget.banners.length) return;
    final id = (widget.banners[i]['id'] ?? '').toString();
    if (id.isNotEmpty && _seen.add(id)) widget.onEvent(id, 'view');
  }

  @override
  void dispose() {
    _auto?.cancel();
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final list = widget.banners;
    if (list.isEmpty) return const SizedBox.shrink();
    return Column(
      children: [
        SizedBox(
          height: 196,
          child: PageView.builder(
            controller: _page,
            itemCount: list.length,
            onPageChanged: (i) {
              setState(() => _index = i);
              _seeing(i);
            },
            itemBuilder: (_, i) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 5),
              child: _BannerCard(
                data: list[i],
                brand: widget.brand,
                skew: _skew,
                onTap: () {
                  final b = list[i];
                  final cta = (b['cta'] is Map) ? Map<String, dynamic>.from(b['cta'] as Map) : <String, dynamic>{};
                  final action = (cta['action'] ?? 'none').toString();
                  if (action == 'none') return;
                  widget.onEvent((b['id'] ?? '').toString(), 'click');
                  widget.onAction(action, (cta['url'] ?? '').toString());
                },
              ),
            ),
          ),
        ),
        if (list.length > 1) ...[
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < list.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _index ? 18 : 7,
                  height: 7,
                  decoration: BoxDecoration(color: i == _index ? const Color(0xFF111827) : const Color(0xFFD1D5DB), borderRadius: BorderRadius.circular(4)),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _BannerCard extends StatefulWidget {
  final Map<String, dynamic> data;
  final Map<String, dynamic>? brand;
  final Duration skew;
  final VoidCallback onTap;
  const _BannerCard({required this.data, required this.brand, required this.skew, required this.onTap});

  @override
  State<_BannerCard> createState() => _BannerCardState();
}

class _BannerCardState extends State<_BannerCard> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600));
  Timer? _tick;
  Duration? _left;

  String get _anim => (widget.data['animation'] ?? 'none').toString();

  @override
  void initState() {
    super.initState();
    if (_anim != 'none' && !_reduceMotion()) _c.repeat(reverse: _anim == 'float' || _anim == 'pulse');
    _startCountdown();
  }

  bool _reduceMotion() {
    final views = WidgetsBinding.instance.platformDispatcher.accessibilityFeatures;
    return views.disableAnimations;
  }

  void _startCountdown() {
    final end = DateTime.tryParse((widget.data['endsAt'] ?? '').toString());
    if (end == null) return;
    void update() {
      final left = end.difference(DateTime.now().add(widget.skew));
      if (mounted) setState(() => _left = left.isNegative ? Duration.zero : left);
    }

    update();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => update());
  }

  @override
  void dispose() {
    _tick?.cancel();
    _c.dispose();
    super.dispose();
  }

  List<Color> _gradient() {
    final theme = (widget.data['theme'] ?? 'brand').toString();
    if (theme == 'custom') return [_hex(widget.data['color1'], const Color(0xFF374151)), _hex(widget.data['color2'], const Color(0xFF111827))];
    if (theme == 'brand') return brandColors(widget.brand, const Color(0xFF7B0000), const Color(0xFFC41E3A));
    return _themes[theme] ?? _themes['sunrise']!;
  }

  String _countdown() {
    final d = _left;
    if (d == null) return '';
    if (d == Duration.zero) return 'Ended';
    String two(int n) => n.toString().padLeft(2, '0');
    final days = d.inDays;
    return 'Ends in ${days > 0 ? '${days}d ' : ''}${two(d.inHours % 24)}:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}';
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.data;
    final cols = _gradient();
    final cta = (b['cta'] is Map) ? Map<String, dynamic>.from(b['cta'] as Map) : <String, dynamic>{};
    final ctaText = (cta['text'] ?? '').toString();
    final action = (cta['action'] ?? 'none').toString();
    final badge = (b['badge'] ?? '').toString();
    final subtitle = (b['subtitle'] ?? '').toString();
    final image = (b['imageUrl'] ?? '').toString();
    final icon = _icons[b['icon']] ?? Icons.currency_rupee_rounded;
    final showCta = ctaText.isNotEmpty && action != 'none';

    return GestureDetector(
      onTap: widget.onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Container(
          decoration: BoxDecoration(gradient: LinearGradient(colors: cols, begin: Alignment.topLeft, end: Alignment.bottomRight)),
          child: Stack(
            children: [
              if (image.startsWith('https://'))
                Positioned.fill(
                  child: Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox.shrink(), color: Colors.black.withOpacity(0.35), colorBlendMode: BlendMode.darken),
                ),
              if (_anim == 'confetti') Positioned.fill(child: IgnorePointer(child: AnimatedBuilder(animation: _c, builder: (_, __) => CustomPaint(painter: _ConfettiPainter(_c.value))))),
              if (_anim == 'shimmer')
                Positioned.fill(
                  child: IgnorePointer(
                    child: AnimatedBuilder(
                      animation: _c,
                      builder: (_, __) => FractionallySizedBox(
                        alignment: Alignment(-1.6 + 3.2 * _c.value, 0),
                        widthFactor: 0.35,
                        child: Transform(
                          transform: Matrix4.skewX(-0.35),
                          child: Container(decoration: BoxDecoration(gradient: LinearGradient(colors: [Colors.white.withOpacity(0), Colors.white.withOpacity(0.26), Colors.white.withOpacity(0)]))),
                        ),
                      ),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (badge.isNotEmpty)
                      Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                        decoration: BoxDecoration(color: Colors.white.withOpacity(0.22), borderRadius: BorderRadius.circular(20)),
                        child: Text(badge, style: const TextStyle(color: Colors.white, fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(right: 56),
                      child: Text((b['title'] ?? '').toString(), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w900, height: 1.18)),
                    ),
                    if (subtitle.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Padding(
                        padding: const EdgeInsets.only(right: 40),
                        child: Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 12.5, height: 1.35)),
                      ),
                    ],
                    if (showCta) ...[
                      const SizedBox(height: 12),
                      _cta(ctaText),
                    ],
                  ],
                ),
              ),
              Positioned(
                right: 14,
                top: 14,
                child: _floating(Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(14)),
                  child: Icon(icon, color: Colors.white, size: 26),
                )),
              ),
              if (_left != null)
                Positioned(
                  right: 12,
                  bottom: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.black.withOpacity(0.3), borderRadius: BorderRadius.circular(8)),
                    child: Text(_countdown(), style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()])),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _floating(Widget child) {
    if (_anim != 'float') return child;
    return AnimatedBuilder(animation: _c, builder: (_, c) => Transform.translate(offset: Offset(0, -6 * Curves.easeInOut.transform(_c.value)), child: c), child: child);
  }

  Widget _cta(String text) {
    final button = Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(11)),
      child: Text(text, style: const TextStyle(color: Color(0xFF111827), fontWeight: FontWeight.w800, fontSize: 12.5)),
    );
    if (_anim != 'pulse') return button;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, c) {
        final t = Curves.easeInOut.transform(_c.value);
        return Transform.scale(
          scale: 1 + 0.06 * t,
          child: DecoratedBox(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(11), boxShadow: [BoxShadow(color: Colors.white.withOpacity(0.55 * (1 - t)), blurRadius: 14 * t + 2, spreadRadius: 6 * t)]),
            child: c,
          ),
        );
      },
      child: button,
    );
  }
}

class _ConfettiPainter extends CustomPainter {
  final double t;
  _ConfettiPainter(this.t);
  static const _colors = [Color(0xFFFBBF24), Color(0xFFF472B6), Color(0xFF34D399), Color(0xFF60A5FA), Colors.white, Color(0xFFF87171)];

  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < 18; i++) {
      final speed = 1 + (i % 3); // whole numbers, so the loop restarts without a jump
      final phase = (t * speed + i * 0.137) % 1.0;
      final x = (i * 53 % 100) / 100 * size.width + math.sin(phase * 6 + i) * 8;
      final y = -10 + phase * (size.height + 20);
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(phase * 8 + i);
      final paint = Paint()..color = _colors[i % _colors.length].withOpacity((1 - phase) * 0.9);
      canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-3, -5, 6, 10), const Radius.circular(2)), paint);
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) => old.t != t;
}
