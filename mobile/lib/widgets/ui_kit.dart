import 'dart:math' as math;
import 'package:flutter/material.dart' hide Text;
import '../main.dart';
import 'tr_text.dart';

// The app's small set of building blocks, so every screen looks like one product: soft cards, section titles, pills,
// a progress ring, quick-action tiles, product cards, trust tiles and loading skeletons.

class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color color;
  final Color? borderColor;
  final double radius;
  final bool shadow;
  const AppCard({Key? key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap, this.color = Colors.white, this.borderColor, this.radius = 20, this.shadow = true}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor ?? kLine),
        boxShadow: shadow ? [BoxShadow(color: kNavy.withOpacity(0.06), blurRadius: 18, offset: const Offset(0, 6))] : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(radius),
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? action;
  final VoidCallback? onAction;
  const SectionTitle(this.title, {Key? key, this.subtitle, this.action, this.onAction}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: kInk, height: 1.25)),
          if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 12.5, color: kMuted, height: 1.35)),
        ]),
      ),
      if (action != null && onAction != null)
        GestureDetector(
          onTap: onAction,
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.only(left: 12, top: 6, bottom: 2),
            child: Text(action!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: kNavy)),
          ),
        ),
    ]);
  }
}

class Pill extends StatelessWidget {
  final String text;
  final Color color;
  final bool solid;
  const Pill(this.text, {Key? key, this.color = kNavy, this.solid = false}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: solid ? color : color.withOpacity(0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(text, style: TextStyle(color: solid ? Colors.white : color, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.2)),
    );
  }
}

// A ring that fills from the top: how much of a loan has been repaid, for instance
class ProgressRing extends StatelessWidget {
  final double value; // 0 to 1
  final double size;
  final double stroke;
  final Color color;
  final Widget? child;
  const ProgressRing({Key? key, required this.value, this.size = 74, this.stroke = 8, this.color = kGood, this.child}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(value.clamp(0.0, 1.0).toDouble(), stroke, color),
        child: Center(child: child),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final double value;
  final double stroke;
  final Color color;
  _RingPainter(this.value, this.stroke, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(stroke / 2, stroke / 2, size.width - stroke, size.height - stroke);
    final track = Paint()..style = PaintingStyle.stroke..strokeWidth = stroke..color = color.withOpacity(0.14);
    final arc = Paint()..style = PaintingStyle.stroke..strokeWidth = stroke..strokeCap = StrokeCap.round..color = color;
    canvas.drawArc(rect, 0, math.pi * 2, false, track);
    if (value > 0) canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * value, false, arc);
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) => old.value != value || old.color != color || old.stroke != stroke;
}

class QuickAction {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  final String? badge;
  const QuickAction(this.icon, this.label, this.color, this.onTap, {this.badge});
}

// Four tiles to a row
class QuickActionGrid extends StatelessWidget {
  final List<QuickAction> items;
  const QuickActionGrid({Key? key, required this.items}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      const gap = 8.0;
      final w = (c.maxWidth - gap * 3) / 4;
      return Wrap(
        spacing: gap,
        runSpacing: 14,
        children: [
          for (final i in items)
            SizedBox(
              width: w,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: i.onTap,
                child: Column(children: [
                  Stack(clipBehavior: Clip.none, children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(color: i.color.withOpacity(0.11), borderRadius: BorderRadius.circular(18)),
                      child: Icon(i.icon, color: i.color, size: 26),
                    ),
                    if (i.badge != null) Positioned(right: -6, top: -6, child: Pill(i.badge!, color: kNavy, solid: true)),
                  ]),
                  const SizedBox(height: 7),
                  Text(i.label, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: kInk, height: 1.25)),
                ]),
              ),
            ),
        ],
      );
    });
  }
}

class ProductCard extends StatelessWidget {
  final String name;
  final String tagline;
  final String upTo; // e.g. "Up to ₹5,00,000"
  final List<String> facts; // short lines under the amount
  final IconData icon;
  final List<Color> colors;
  final String? badge;
  final VoidCallback onTap;
  final double width;
  final String cta;
  const ProductCard({Key? key, required this.name, required this.tagline, required this.upTo, required this.facts, required this.icon, required this.colors, required this.onTap, this.badge, this.width = 268, this.cta = 'Apply now'}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight),
            borderRadius: BorderRadius.circular(22),
            boxShadow: [BoxShadow(color: colors.first.withOpacity(0.28), blurRadius: 18, offset: const Offset(0, 8))],
          ),
          child: Stack(children: [
            Positioned(right: -34, top: -34, child: Container(width: 120, height: 120, decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withOpacity(0.08)))),
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Row(children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.18), borderRadius: BorderRadius.circular(13)),
                  child: Icon(icon, color: Colors.white, size: 20),
                ),
                const Spacer(),
                if (badge != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(20)),
                    child: Text(badge!, style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w700)),
                  ),
              ]),
              const SizedBox(height: 14),
              Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(tagline, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: Colors.white.withOpacity(0.82), fontSize: 12, height: 1.35)),
              const SizedBox(height: 12),
              Text(upTo, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800, height: 1.1)),
              const SizedBox(height: 8),
              for (final f in facts.take(3))
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(children: [
                    Icon(Icons.check_circle_rounded, size: 13, color: Colors.white.withOpacity(0.85)),
                    const SizedBox(width: 6),
                    Expanded(child: Text(f, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: Colors.white.withOpacity(0.9), fontSize: 11.5))),
                  ]),
                ),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(cta, style: TextStyle(color: colors.first, fontSize: 12.5, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 4),
                  Icon(Icons.arrow_forward_rounded, size: 15, color: colors.first),
                ]),
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}

class TrustTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  const TrustTile({Key? key, required this.icon, required this.title, required this.subtitle, this.color = kNavy}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(14),
      radius: 18,
      shadow: false,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(color: color.withOpacity(0.11), borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, color: color, size: 20),
        ),
        const SizedBox(height: 10),
        Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: kInk, height: 1.25)),
        const SizedBox(height: 3),
        Text(subtitle, style: const TextStyle(fontSize: 11.5, color: kMuted, height: 1.35)),
      ]),
    );
  }
}

// A grey block that pulses while the real content loads
class Skeleton extends StatefulWidget {
  final double height;
  final double? width;
  final double radius;
  const Skeleton({Key? key, this.height = 16, this.width, this.radius = 10}) : super(key: key);

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) => Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(color: Color.lerp(const Color(0xFFF0E7E8), const Color(0xFFE3D6D8), _c.value), borderRadius: BorderRadius.circular(widget.radius)),
      ),
    );
  }
}

// What a product's icon and colours are, chosen from its name so new products look right without any change to the app
class ProductLook {
  final IconData icon;
  final List<Color> colors;
  const ProductLook(this.icon, this.colors);
}

ProductLook productLook(String key, String name) {
  final k = '$key $name'.toLowerCase();
  if (k.contains('payday') || k.contains('advance')) return const ProductLook(Icons.bolt_rounded, [Color(0xFFB45309), Color(0xFFD97706)]);
  if (k.contains('salar')) return const ProductLook(Icons.work_rounded, [Color(0xFF0F5B56), Color(0xFF14877F)]);
  if (k.contains('business') || k.contains('msme')) return const ProductLook(Icons.storefront_rounded, [Color(0xFF1E3A8A), Color(0xFF2563EB)]);
  if (k.contains('gold')) return const ProductLook(Icons.workspace_premium_rounded, [Color(0xFF8A5A00), Color(0xFFC98A12)]);
  if (k.contains('bike') || k.contains('vehicle') || k.contains('wheeler') || k.contains('auto')) return const ProductLook(Icons.two_wheeler_rounded, [Color(0xFF334155), Color(0xFF475569)]);
  if (k.contains('home') || k.contains('housing')) return const ProductLook(Icons.home_work_rounded, [Color(0xFF14532D), Color(0xFF15803D)]);
  if (k.contains('property') || k.contains('lap')) return const ProductLook(Icons.apartment_rounded, [Color(0xFF3F3F46), Color(0xFF52525B)]);
  if (k.contains('educat')) return const ProductLook(Icons.school_rounded, [Color(0xFF5B21B6), Color(0xFF7C3AED)]);
  return const ProductLook(Icons.account_balance_wallet_rounded, [Color(0xFF7B0000), Color(0xFFB3202F)]);
}
