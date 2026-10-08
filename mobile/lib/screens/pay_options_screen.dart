import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';

// Paying early and planning: several instalments at once, closing the loan, a settlement the customer accepted, and moving the due day.
class PayOptionsScreen extends StatefulWidget {
  final String loanId;
  const PayOptionsScreen({Key? key, required this.loanId}) : super(key: key);

  @override
  State<PayOptionsScreen> createState() => _PayOptionsScreenState();
}

class _PayOptionsScreenState extends State<PayOptionsScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _d;
  String? _error;
  String? _paymentId;
  bool _busy = false;
  bool _changed = false;
  int? _day;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _paymentId != null) _check();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<ApiService>().getPayOptions(widget.loanId);
      if (mounted) setState(() { _d = d; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
  }

  Future<void> _pay(String purpose, {int? count}) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final p = await context.read<ApiService>().startOnlinePayment(widget.loanId, purpose, count: count);
      _paymentId = p['id'].toString();
      final ok = await launchUrl(Uri.parse(p['url'].toString()), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Could not open the payment page')));
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 4), (_) => _check());
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _check() async {
    final id = _paymentId;
    if (id == null) return;
    try {
      final p = await context.read<ApiService>().onlinePaymentStatus(id);
      final st = p['status'];
      if (st == 'paid' || st == 'review') {
        _poll?.cancel();
        _paymentId = null;
        _changed = true;
        await _load();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(st == 'paid' ? 'Payment received. Thank you.' : 'Payment received. Our team will apply it shortly.')));
      } else if (st == 'cancelled' || st == 'expired') {
        _poll?.cancel();
        _paymentId = null;
        if (mounted) { setState(() {}); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('The payment was not completed.'))); }
      }
    } catch (_) {}
  }

  Future<void> _changeDay() async {
    final day = _day;
    if (day == null) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiService>().changeDueDate(widget.loanId, day);
      _changed = true;
      await _load();
      messenger.showSnackBar(SnackBar(content: Text('Done. Your EMIs are now due on day $day of each month.')));
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

  Widget _card(String title, List<Widget> children) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          ...children,
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return WillPopScope(
      onWillPop: () async { Navigator.of(context).pop(_changed); return false; },
      child: Scaffold(
        backgroundColor: kBg,
        appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('Pay early and plan')),
        body: d == null
            ? Center(child: _error != null ? Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)) : const CircularProgressIndicator(color: kNavy))
            : ListView(padding: const EdgeInsets.all(16), children: [
                if (d['mode'] == 'test')
                  const Padding(padding: EdgeInsets.only(bottom: 8), child: Text('Test mode: payments are simulated.', style: TextStyle(fontSize: 12, color: Color(0xFF92400E)))),
                if (_paymentId != null)
                  const Padding(padding: EdgeInsets.only(bottom: 8), child: Text('Waiting for your payment... come back here once it is done.', style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)))),
                if (d['available'] != true)
                  _card('Paying online', const [Text('Paying online is not available right now. You can still pay your EMI from the loan screen.')]),
                if (d['available'] == true && (d['payAhead'] as List).isNotEmpty)
                  _card('Pay more than one EMI at once', [
                    const Text('Pay your next instalments together. Each one is marked paid and the amounts do not change.', style: TextStyle(fontSize: 13, color: Color(0xFF4B5563))),
                    const SizedBox(height: 8),
                    for (final o in List<Map<String, dynamic>>.from(d['payAhead']))
                      if ((o['count'] as num) > 1)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: OutlinedButton(
                            onPressed: _busy ? null : () => _pay('pay_ahead', count: (o['count'] as num).toInt()),
                            child: Text('Pay next ${o['count']} EMIs · ${_money(o['amount'])}'),
                          ),
                        ),
                  ]),
                if (d['available'] == true && d['closeNow'] != null)
                  _card('Close the loan now', [
                    Text('Pay ${_money(d['closeNow']['total'])} today and the loan is closed.', style: const TextStyle(fontSize: 14)),
                    const SizedBox(height: 4),
                    Text(
                      (d['closeNow']['saves'] as num) > 0
                          ? 'Paying your EMIs as planned would cost ${_money(d['closeNow']['ifPaidNormally'])}, so you save ${_money(d['closeNow']['saves'])}.'
                          : 'Paying your EMIs as planned would cost ${_money(d['closeNow']['ifPaidNormally'])}. Closing now costs ${_money(d['closeNow']['costsExtra'])} more because of the ${d['closeNow']['feePercent']}% closing fee, so it only makes sense if you want to be done with this loan.',
                      style: const TextStyle(fontSize: 13, color: Color(0xFF4B5563), height: 1.4),
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(onPressed: _busy ? null : () => _pay('foreclosure'), child: const Text('Close my loan')),
                  ]),
                if (d['available'] == true && d['settlement'] != null)
                  _card('Pay your settlement', [
                    Text('You accepted a settlement of ${_money(d['settlement']['amount'])}. Pay it by ${_date(d['settlement']['validUntil'])} to close your loan.', style: const TextStyle(fontSize: 14)),
                    const SizedBox(height: 8),
                    ElevatedButton(onPressed: _busy ? null : () => _pay('settlement'), child: const Text('Pay settlement')),
                  ]),
                if (d['dueDate'] != null)
                  _card('Change your due date', [
                    if (d['dueDate']['allowed'] == true) ...[
                      Text('Your EMIs are due on day ${d['dueDate']['currentDay']} of the month. Choose a day that suits your salary. The next EMI can move by up to ${d['dueDate']['maxShiftDays']} days, and the amounts do not change.', style: const TextStyle(fontSize: 13, color: Color(0xFF4B5563), height: 1.4)),
                      const SizedBox(height: 8),
                      DropdownButton<int>(
                        value: _day,
                        hint: const Text('Choose a day'),
                        isExpanded: true,
                        items: [for (int i = 1; i <= 28; i++) DropdownMenuItem(value: i, child: Text('Day $i'))],
                        onChanged: _busy ? null : (v) => setState(() => _day = v),
                      ),
                      const SizedBox(height: 4),
                      ElevatedButton(onPressed: (_busy || _day == null) ? null : _changeDay, child: const Text('Change due date')),
                    ] else
                      Text(d['dueDate']['reason']?.toString() ?? '', style: const TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
                  ]),
              ]),
      ),
    );
  }
}
