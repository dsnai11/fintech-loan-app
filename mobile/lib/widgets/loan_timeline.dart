import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import 'tr_text.dart';

/// Where this loan application stands: what is done, what is happening now and what comes next.
class LoanTimeline extends StatefulWidget {
  final String loanId;
  const LoanTimeline({Key? key, required this.loanId}) : super(key: key);

  @override
  State<LoanTimeline> createState() => _LoanTimelineState();
}

class _LoanTimelineState extends State<LoanTimeline> {
  Map<String, dynamic>? _d;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      try {
        final d = await context.read<ApiService>().getLoanTimeline(widget.loanId);
        if (mounted) setState(() => _d = d);
      } catch (_) {}
    });
  }

  String _date(dynamic iso) {
    try {
      final d = DateTime.parse(iso.toString()).toLocal();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return '${d.day} ${months[d.month - 1]}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return const SizedBox.shrink();
    final steps = List<Map<String, dynamic>>.from(d['steps'] ?? []);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Where your loan stands', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 10),
        for (var i = 0; i < steps.length; i++) _row(steps[i], i == steps.length - 1),
        if ((d['next'] ?? '').toString().isNotEmpty) ...[
          const SizedBox(height: 4),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: const Color(0xFFF3F4F6), borderRadius: BorderRadius.circular(10)),
            child: Text('Next: ${d['next']}', style: const TextStyle(fontSize: 13, height: 1.4)),
          ),
        ],
      ]),
    );
  }

  Widget _row(Map<String, dynamic> s, bool last) {
    final state = s['state'];
    final color = state == 'done' ? kGreen : state == 'current' ? const Color(0xFFF59E0B) : state == 'stopped' ? const Color(0xFFDC2626) : const Color(0xFFD1D5DB);
    final icon = state == 'done' ? Icons.check_circle_rounded : state == 'current' ? Icons.timelapse_rounded : state == 'stopped' ? Icons.cancel_rounded : Icons.radio_button_unchecked_rounded;
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 28,
          child: Column(children: [
            Icon(icon, size: 22, color: color),
            if (!last) Expanded(child: Container(width: 2, color: const Color(0xFFE5E7EB))),
          ]),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(s['label'].toString(), style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: state == 'todo' ? const Color(0xFF9CA3AF) : const Color(0xFF111827)))),
                if (s['at'] != null && state != 'todo') Text(_date(s['at']), style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
              ]),
              if ((s['detail'] ?? '').toString().isNotEmpty) Text(s['detail'].toString(), style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280), height: 1.35)),
            ]),
          ),
        ),
      ]),
    );
  }
}
