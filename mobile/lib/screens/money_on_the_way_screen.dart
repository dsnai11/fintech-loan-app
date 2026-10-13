import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/format.dart';
import '../widgets/tr_text.dart';
import '../widgets/ui_kit.dart';

// Shown right after the agreement is signed. It follows the loan until the money is sent, so the customer is not left wondering.
// It never promises a time: a payout can be quick or can wait for a person, so when it takes longer it says so and promises a notification.
class MoneyOnTheWayScreen extends StatefulWidget {
  final String loanId;
  const MoneyOnTheWayScreen({Key? key, required this.loanId}) : super(key: key);

  @override
  State<MoneyOnTheWayScreen> createState() => _MoneyOnTheWayScreenState();
}

class _MoneyOnTheWayScreenState extends State<MoneyOnTheWayScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000))..repeat(reverse: true);
  Timer? _timer;
  Map<String, dynamic>? _loan;
  int _tries = 0;
  bool _gaveUp = false;
  static const _maxTries = 40; // about 2 minutes and a half

  @override
  void initState() {
    super.initState();
    _check();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  bool get _sent => _loan != null && _loan!['status'] == 'disbursed';

  Future<void> _check() async {
    if (_sent) return;
    try {
      final d = await context.read<ApiService>().getLoanDetails(widget.loanId);
      final loan = d['loan'] is Map ? Map<String, dynamic>.from(d['loan'] as Map) : d;
      if (!mounted) return;
      setState(() => _loan = loan);
      if (loan['status'] == 'disbursed') _timer?.cancel();
    } catch (_) {}
    _tries++;
    if (_tries >= _maxTries && !_sent && mounted) {
      _timer?.cancel();
      setState(() => _gaveUp = true);
    }
  }

  String _last4() {
    final d = _loan?['disbursalDetails'];
    final n = d is Map ? '${d['accountNumber'] ?? ''}' : '';
    return n.length >= 4 ? n.substring(n.length - 4) : '';
  }

  Widget _step(String label, String note, {required bool done, required bool active}) {
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(
        width: 30,
        child: done
            ? const Icon(Icons.check_circle_rounded, color: kGood, size: 26)
            : active
                ? FadeTransition(opacity: Tween<double>(begin: 0.35, end: 1).animate(_pulse), child: const Icon(Icons.radio_button_checked_rounded, color: kNavy, size: 26))
                : const Icon(Icons.radio_button_unchecked_rounded, color: Color(0xFFD1D5DB), size: 26),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: done || active ? kInk : kMuted)),
            if (note.isNotEmpty) Text(note, style: const TextStyle(fontSize: 12.5, color: kMuted, height: 1.4)),
          ]),
        ),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final amount = asNum(_loan?['disbursedAmount'] ?? (_loan?['disbursalDetails'] is Map ? (_loan!['disbursalDetails'] as Map)['disbursedAmount'] : null) ?? _loan?['loanAmount'] ?? 0);
    final last4 = _last4();
    final sent = _sent;
    return Scaffold(
      backgroundColor: kBg,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Center(
              child: Container(
                width: 92,
                height: 92,
                decoration: BoxDecoration(color: (sent ? kGood : kNavy).withOpacity(0.10), shape: BoxShape.circle),
                child: Icon(sent ? Icons.celebration_rounded : Icons.north_east_rounded, size: 46, color: sent ? kGood : kNavy),
              ),
            ),
            const SizedBox(height: 20),
            Center(child: Text(sent ? 'Your money has been sent' : 'Your money is on the way', textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: kInk))),
            const SizedBox(height: 6),
            Center(
              child: Text(
                sent
                    ? '${amount > 0 ? formatMoney(amount) : 'The amount'} was sent to your bank account${last4.isEmpty ? '' : ' ending $last4'}. Most banks show it within minutes.'
                    : _gaveUp
                        ? 'This is taking a little longer. You do not need to wait here. We will send you a notification the moment the money goes out.'
                        : 'You have signed the agreement. We are sending ${amount > 0 ? formatMoney(amount) : 'your loan'} to your bank account.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13.5, color: kMuted, height: 1.5),
              ),
            ),
            const SizedBox(height: 30),
            AppCard(
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 0),
              child: Column(children: [
                _step('Agreement signed', 'Your signed copy is saved in the app', done: true, active: false),
                _step('Payment started', sent ? 'Released from our account' : 'We are releasing it from our account', done: sent, active: !sent),
                _step('Money in your account', sent ? 'Check your bank app or SMS' : 'Your bank decides how fast it shows up', done: sent, active: false),
              ]),
            ),
            const Spacer(),
            if (!sent && !_gaveUp) const Center(child: Text('Checking again every few seconds...', style: TextStyle(fontSize: 12, color: kMuted))),
            const SizedBox(height: 10),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: Text(sent || _gaveUp ? 'Done' : 'Continue in the background'))),
          ]),
        ),
      ),
    );
  }
}
