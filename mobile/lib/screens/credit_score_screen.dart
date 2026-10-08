import 'dart:math' as math;
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';

// The customer's free credit score, what affects it, and tips to improve it.
class CreditScoreScreen extends StatefulWidget {
  const CreditScoreScreen({Key? key}) : super(key: key);

  @override
  State<CreditScoreScreen> createState() => _CreditScoreScreenState();
}

class _CreditScoreScreenState extends State<CreditScoreScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getCreditScore();
      if (mounted) setState(() { _d = d; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
  }

  Future<void> _refresh() async {
    final d = _d;
    if (d == null) return;
    bool consent = d['consented'] == true;
    if (!consent) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Check my credit score'),
          content: const Text('We will ask a credit bureau for your score. This is free and does not lower your score. Do you agree?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('I agree')),
          ],
        ),
      );
      if (ok != true) return;
      consent = true;
    }
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await context.read<ApiService>().refreshCreditScore(consent: consent);
      if (mounted) setState(() => _d = r);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  Color _bandColor(String? key) {
    switch (key) {
      case 'excellent': return const Color(0xFF15803D);
      case 'good': return const Color(0xFF65A30D);
      case 'fair': return const Color(0xFFF59E0B);
      default: return const Color(0xFFDC2626);
    }
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

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [Expanded(child: Text(label, style: const TextStyle(fontSize: 13, color: Color(0xFF4B5563)))), Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))]),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Your credit score')),
      body: d == null
          ? Center(child: _error != null ? Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)) : const CircularProgressIndicator(color: kNavy))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                  child: Column(children: [
                    SizedBox(
                      height: 150,
                      width: 260,
                      child: CustomPaint(
                        painter: _GaugePainter(score: d['score'] == null ? null : (d['score'] as num).toDouble(), min: (d['min'] as num).toDouble(), max: (d['max'] as num).toDouble(), color: _bandColor(d['band']?['key']?.toString())),
                        child: Align(
                          alignment: const Alignment(0, 0.35),
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            Text(d['score'] == null ? '—' : d['score'].toString(), style: TextStyle(fontSize: 44, fontWeight: FontWeight.w900, color: _bandColor(d['band']?['key']?.toString()))),
                            Text(d['band']?['label']?.toString() ?? 'No score yet', style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF4B5563))),
                          ]),
                        ),
                      ),
                    ),
                    if (d['at'] != null) Text('Checked on ${_date(d['at'])}${d['test'] == true ? ' · test score' : ''}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                    const SizedBox(height: 12),
                    if (d['canRefresh'] == true)
                      ElevatedButton(onPressed: _busy ? null : _refresh, child: Text(d['score'] == null ? 'Check my score (free)' : 'Check again (free)'))
                    else if (d['nextRefreshAt'] != null)
                      Text('You can check again after ${_date(d['nextRefreshAt'])}.', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                  ]),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('What affects it', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 6),
                    _row('EMIs paid on time with us', d['factors']['onTimePercent'] == null ? 'No EMIs yet' : '${d['factors']['onTimePercent']}%'),
                    _row('EMIs overdue now', '${d['factors']['overdue']}'),
                    if (d['factors']['enquiries90'] != null) _row('Loan applications in 3 months', '${d['factors']['enquiries90']}'),
                    if (d['factors']['maxDpd'] != null) _row('Most days late in a year', '${d['factors']['maxDpd']}'),
                    if (d['factors']['activeLoans'] != null) _row('Running loans', '${d['factors']['activeLoans']}'),
                  ]),
                ),
                const SizedBox(height: 12),
                for (final t in List<Map<String, dynamic>>.from(d['tips'] ?? []))
                  Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE5E7EB))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(t['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                      const SizedBox(height: 4),
                      Text(t['text'].toString(), style: const TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF4B5563))),
                    ]),
                  ),
                Text(d['note'].toString(), style: const TextStyle(fontSize: 11.5, color: Color(0xFF9CA3AF), height: 1.4)),
              ]),
            ),
    );
  }
}

class _GaugePainter extends CustomPainter {
  final double? score;
  final double min, max;
  final Color color;
  _GaugePainter({required this.score, required this.min, required this.max, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromCircle(center: Offset(size.width / 2, size.height * 0.88), radius: size.width * 0.42);
    final base = Paint()..style = PaintingStyle.stroke..strokeWidth = 14..strokeCap = StrokeCap.round..color = const Color(0xFFE5E7EB);
    canvas.drawArc(rect, math.pi, math.pi, false, base);
    if (score != null) {
      final t = ((score! - min) / (max - min)).clamp(0.0, 1.0);
      final p = Paint()..style = PaintingStyle.stroke..strokeWidth = 14..strokeCap = StrokeCap.round..color = color;
      canvas.drawArc(rect, math.pi, math.pi * t, false, p);
    }
  }

  @override
  bool shouldRepaint(covariant _GaugePainter old) => old.score != score || old.color != color;
}

// A row for the profile screen
class CreditScoreRow extends StatelessWidget {
  const CreditScoreRow({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreditScoreScreen())),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: const [
          Icon(Icons.speed_rounded, color: kNavy),
          SizedBox(width: 14),
          Expanded(child: Text('Free credit score', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
