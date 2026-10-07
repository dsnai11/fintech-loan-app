import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../services/api_service.dart';
import '../services/selected_product.dart';
import '../utils/error_utils.dart';
import '../utils/format.dart';
import 'loan_flow_scaffold.dart';
import 'loan_approved_screen.dart';

class LoanPlanScreen extends StatefulWidget {
  final LoanApplicationState? appState;
  // The offer from the credit check. Without one, the amount is looked up again.
  final Map<String, dynamic>? offer;
  const LoanPlanScreen({Key? key, this.appState, this.offer}) : super(key: key);

  @override
  State<LoanPlanScreen> createState() => _LoanPlanScreenState();
}

class _LoanPlanScreenState extends State<LoanPlanScreen> {
  List<Map<String, dynamic>> _quotes = [];
  Map<String, dynamic>? _offer;
  int _amount = 0;
  int _min = 1000;
  int _max = 1000;
  int _selected = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  // Every figure on this screen comes from the lender's current pricing, never from the app itself.
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiService>();
      final policy = await api.getPricing(product: SelectedProduct.key);
      Map<String, dynamic>? offer = widget.offer;
      if (offer == null) {
        try {
          final r = await api.getMyOffer();
          if (r['offer'] is Map) offer = Map<String, dynamic>.from(r['offer'] as Map);
        } catch (_) {}
      }
      final min = asNum(policy['minAmount']).toInt();
      final top = offer != null ? asNum(offer['amount']).toInt() : asNum(policy['offerAmount']).toInt();
      final max = top < min ? min : top;
      final amount = (_amount >= min && _amount <= max) ? _amount : max;
      final quotes = await api.getQuotes(amount);
      if (!mounted) return;
      setState(() {
        _offer = offer;
        _min = min;
        _max = max;
        _amount = amount;
        _quotes = quotes;
        _selected = quotes.length > 1 ? 1 : 0;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _loading = false;
      });
    }
  }

  // The amounts on the slider run from the smallest loan to the customer's offer, in steps.
  int get _step => (_max - _min) >= 20000 ? 1000 : 500;
  int get _steps => ((_max - _min) / _step).floor().clamp(1, 400);
  int _amountAt(int k) => k >= _steps ? _max : _min + k * _step;

  Future<void> _reloadQuotes() async {
    try {
      final quotes = await context.read<ApiService>().getQuotes(_amount);
      if (!mounted) return;
      setState(() {
        _quotes = quotes;
        if (_selected >= quotes.length) _selected = 0;
      });
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
  }

  Widget _amountPicker() {
    final k = (((_amount - _min) / _step).round()).clamp(0, _steps);
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
      decoration: BoxDecoration(color: const Color(0xFFF9FAFB), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_offer != null ? 'YOUR OFFER IS UP TO ${formatMoney(_max)}' : 'CHOOSE YOUR AMOUNT', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8, color: Color(0xFF6B7280))),
          const SizedBox(height: 6),
          Text(formatMoney(_amount), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
          if (_max > _min)
            Slider(
              value: k.toDouble(),
              min: 0,
              max: _steps.toDouble(),
              divisions: _steps,
              activeColor: kNavy,
              label: formatMoney(_amountAt(k)),
              onChanged: (v) => setState(() => _amount = _amountAt(v.round())),
              onChangeEnd: (_) => _reloadQuotes(),
            ),
          if (_max > _min)
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text(formatMoney(_min), style: const TextStyle(fontSize: 11.5, color: Color(0xFF9CA3AF))),
              Text(formatMoney(_max), style: const TextStyle(fontSize: 11.5, color: Color(0xFF9CA3AF))),
            ]),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  void _continue() {
    final q = _quotes[_selected];
    final base = widget.appState;
    final state = LoanApplicationState(
      loanAmount: asNum(q['amount']).toInt(),
      tenure: asNum(q['tenureMonths']).toInt(),
      planType: q['planType'].toString(),
      gender: base?.gender ?? '',
      pincode: base?.pincode ?? '',
      address: base?.address ?? '',
      email: base?.email ?? '',
    );
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => LoanApprovedScreen(quote: q, appState: state),
      ),
    );
  }

  String _blurb(Map<String, dynamic> q) {
    final months = asNum(q['tenureMonths']).toInt();
    if (months == 1) return 'Pay the full amount in one payment';
    return 'Repay in $months monthly instalments';
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 4,
      title: 'Choose Your Plan',
      buttonLabel: 'Continue →',
      onContinue: (_loading || _error != null || _quotes.isEmpty) ? null : _continue,
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: kNavy.withOpacity(0.05),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline_rounded, color: kNavy, size: 18),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'These are the exact charges you will see in your loan agreement. Final approval depends on verification of your details.',
                      style: TextStyle(
                          fontSize: 12,
                          color: kNavy,
                          fontWeight: FontWeight.w500,
                          height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (!_loading && _error == null) _amountPicker(),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator(color: kNavy)),
              )
            else if (_error != null)
              Column(
                children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ],
              )
            else
              ...List.generate(_quotes.length, (i) => _planCard(i)),
          ],
        ),
      ),
    );
  }

  Widget _planCard(int i) {
    final q = _quotes[i];
    final isSelected = _selected == i;
    final months = asNum(q['tenureMonths']).toInt();
    final key = q['planType'].toString();
    final noInterest = asNum(q['interestRatePercent']) == 0;
    final String? tag = noInterest ? 'No Interest' : (key == '3_emi' ? 'Popular' : null);
    final Color tagColor = noInterest ? kGreen : const Color(0xFF7C3AED);

    return GestureDetector(
      onTap: () => setState(() => _selected = i),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? kNavy : const Color(0xFFE5E7EB),
            width: isSelected ? 2 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: kNavy.withOpacity(0.1),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  )
                ]
              : [],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    q['label'].toString(),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: isSelected ? kNavy : const Color(0xFF111827),
                    ),
                  ),
                ),
                if (tag != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: tagColor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      tag,
                      style: TextStyle(color: tagColor, fontSize: 11, fontWeight: FontWeight.w700),
                    ),
                  ),
                const SizedBox(width: 8),
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isSelected ? kNavy : Colors.transparent,
                    border: Border.all(
                        color: isSelected ? kNavy : const Color(0xFFD1D5DB), width: 2),
                  ),
                  child: isSelected
                      ? const Icon(Icons.check_rounded, color: Colors.white, size: 12)
                      : null,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _blurb(q),
              style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.4),
            ),
            const SizedBox(height: 12),
            const Divider(color: Color(0xFFF3F4F6)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _stat('LOAN AMOUNT', formatMoney(asNum(q['amount'])))),
                Expanded(
                  child: months == 1
                      ? _stat('REPAY', formatMoney(asNum(q['totalRepayable'])))
                      : _stat('EMI', '${formatMoney(asNum(q['emi']))} × $months'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              'You receive ${formatMoney(asNum(q['netDisbursed']))}  •  APR ${formatPercent(asNum(q['aprPercent']))}%',
              style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(
                fontSize: 10,
                color: Color(0xFF9CA3AF),
                fontWeight: FontWeight.w600,
                letterSpacing: 0.8)),
        const SizedBox(height: 3),
        Text(value,
            style: const TextStyle(
                fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
      ],
    );
  }
}
