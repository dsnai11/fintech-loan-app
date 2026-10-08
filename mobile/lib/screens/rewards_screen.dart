import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../widgets/tr_text.dart';

// Rewards for paying on time: the streak, the next badge and the badges earned.
class RewardsScreen extends StatefulWidget {
  const RewardsScreen({Key? key}) : super(key: key);

  @override
  State<RewardsScreen> createState() => _RewardsScreenState();
}

class _RewardsScreenState extends State<RewardsScreen> {
  Map<String, dynamic>? _d;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getRewards();
      if (mounted) setState(() { _d = d; _error = null; });
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load. Pull down to try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Pay on time, earn rewards')),
      body: d == null
          ? Center(child: _error != null ? Text(_error!) : const CircularProgressIndicator(color: kNavy))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
                if (d['enabled'] != true)
                  const Text('Rewards are not available right now.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF6B7280)))
                else ...[
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(gradient: const LinearGradient(colors: [kNavy, kGreen]), borderRadius: BorderRadius.circular(18)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('YOUR STREAK', style: TextStyle(color: Colors.white70, fontSize: 11.5, fontWeight: FontWeight.w800, letterSpacing: 1)),
                      const SizedBox(height: 4),
                      Text('${d['streak']} EMI${d['streak'] == 1 ? '' : 's'} on time in a row', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
                      const SizedBox(height: 6),
                      Text(d['next'] != null ? '${d['next']['toGo']} more for "${d['next']['title']}"${(d['next']['cashback'] as num) > 0 ? ' and a ₹${d['next']['cashback']} reward' : ''}.' : 'You have reached every badge. Great job!', style: const TextStyle(color: Colors.white, fontSize: 13.5)),
                      const SizedBox(height: 4),
                      Text('Best so far: ${d['best']}. Pay by the due date${(d['graceDays'] as num) > 0 ? ' (or within ${d['graceDays']} day${d['graceDays'] == 1 ? '' : 's'})' : ''} to keep it going.', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    ]),
                  ),
                  const SizedBox(height: 16),
                  const Text('Badges', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  const SizedBox(height: 8),
                  for (final m in List<Map<String, dynamic>>.from(d['milestones'] ?? []))
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: m['earned'] == true ? kGreen : const Color(0xFFE5E7EB))),
                      child: Row(children: [
                        Icon(m['earned'] == true ? Icons.emoji_events_rounded : Icons.lock_outline_rounded, color: m['earned'] == true ? kGreen : const Color(0xFF9CA3AF)),
                        const SizedBox(width: 12),
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
                          Text('${m['streak']} EMIs on time in a row${(m['cashback'] as num) > 0 ? ' · ₹${m['cashback']} reward' : ''}', style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280))),
                        ])),
                        if (m['earned'] == true) const Text('Earned', style: TextStyle(color: kGreen, fontWeight: FontWeight.w700)),
                      ]),
                    ),
                ],
              ]),
            ),
    );
  }
}

// A row for the profile screen. It hides itself when rewards are off.
class RewardsRow extends StatefulWidget {
  const RewardsRow({Key? key}) : super(key: key);

  @override
  State<RewardsRow> createState() => _RewardsRowState();
}

class _RewardsRowState extends State<RewardsRow> {
  Map<String, dynamic>? _d;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      try {
        final d = await context.read<ApiService>().getRewards();
        if (mounted) setState(() => _d = d);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null || d['enabled'] != true) return const SizedBox.shrink();
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RewardsScreen())),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: [
          const Icon(Icons.emoji_events_outlined, color: kNavy),
          const SizedBox(width: 14),
          Expanded(child: Text('Rewards · ${d['streak']} on time in a row', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
