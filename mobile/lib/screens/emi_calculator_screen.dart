import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../main.dart';
import 'pan_verify_screen.dart';

class _ScheduleRow {
  final int month;
  final int emi;
  final int principal;
  final int interest;
  final int balance;
  const _ScheduleRow(this.month, this.emi, this.principal, this.interest, this.balance);
}

class EmiCalculatorScreen extends StatefulWidget {
  const EmiCalculatorScreen({Key? key}) : super(key: key);

  @override
  State<EmiCalculatorScreen> createState() => _EmiCalculatorScreenState();
}

class _EmiCalculatorScreenState extends State<EmiCalculatorScreen> {
  static const double _minAmount = 1000;
  static const double _maxAmount = 500000;
  static const double _minRate = 1;
  static const double _maxRate = 36;
  static const int _minTenure = 1;
  static const int _maxTenure = 60;

  double _amount = 100000;
  double _rate = 15;
  int _tenure = 12;

  late final TextEditingController _amountCtl;
  late final TextEditingController _rateCtl;
  late final TextEditingController _tenureCtl;

  String? _amountErr;
  String? _rateErr;
  String? _tenureErr;

  List<_ScheduleRow> _rows = [];

  @override
  void initState() {
    super.initState();
    _amountCtl = TextEditingController(text: _amount.round().toString());
    _rateCtl = TextEditingController(text: _rate.toString());
    _tenureCtl = TextEditingController(text: _tenure.toString());
    _rows = _buildSchedule();
  }

  @override
  void dispose() {
    _amountCtl.dispose();
    _rateCtl.dispose();
    _tenureCtl.dispose();
    super.dispose();
  }

  List<_ScheduleRow> _buildSchedule() {
    final r = _rate / 12 / 100;
    final n = _tenure;
    final p = _amount;
    final int emi = r == 0
        ? (p / n).round()
        : ((p * r * pow(1 + r, n)) / (pow(1 + r, n) - 1)).round();

    int balance = p.round();
    final rows = <_ScheduleRow>[];
    for (int m = 1; m <= n; m++) {
      final int interest = (balance * r).round();
      int principal = emi - interest;
      int pay = emi;
      if (m == n || principal > balance) {
        principal = balance;
        pay = balance + interest;
      }
      balance -= principal;
      rows.add(_ScheduleRow(m, pay, principal, interest, balance));
    }
    return rows;
  }

  void _recalc() {
    setState(() => _rows = _buildSchedule());
  }

  String _money(num value) {
    final n = value.round();
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (m) => '${m[1]},')}';
  }

  void _onAmountText(String text) {
    final v = double.tryParse(text);
    if (v == null || v < _minAmount || v > _maxAmount) {
      setState(() => _amountErr = 'Enter ${_money(_minAmount)} to ${_money(_maxAmount)}');
      return;
    }
    _amountErr = null;
    _amount = v;
    _recalc();
  }

  void _onRateText(String text) {
    final v = double.tryParse(text);
    if (v == null || v < _minRate || v > _maxRate) {
      setState(() => _rateErr = 'Enter ${_minRate.round()}% to ${_maxRate.round()}%');
      return;
    }
    _rateErr = null;
    _rate = v;
    _recalc();
  }

  void _onTenureText(String text) {
    final v = int.tryParse(text);
    if (v == null || v < _minTenure || v > _maxTenure) {
      setState(() => _tenureErr = 'Enter $_minTenure to $_maxTenure months');
      return;
    }
    _tenureErr = null;
    _tenure = v;
    _recalc();
  }

  Widget _inputCard({
    required String label,
    required TextEditingController controller,
    required String? error,
    required ValueChanged<String> onText,
    required List<TextInputFormatter> formatters,
    required double sliderValue,
    required double min,
    required double max,
    required int divisions,
    required ValueChanged<double> onSlider,
    String? prefix,
    String? suffix,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF6B7280))),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: formatters,
            onChanged: onText,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            decoration: InputDecoration(
              prefixText: prefix,
              suffixText: suffix,
              errorText: error,
              isDense: true,
              border: const UnderlineInputBorder(),
            ),
          ),
          Slider(
            value: sliderValue.clamp(min, max).toDouble(),
            min: min,
            max: max,
            divisions: divisions,
            activeColor: kNavy,
            onChanged: onSlider,
          ),
        ],
      ),
    );
  }

  Widget _kv(String label, String value, {Color? dot}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          if (dot != null)
            Container(
              width: 10,
              height: 10,
              margin: const EdgeInsets.only(right: 8),
              decoration: BoxDecoration(color: dot, borderRadius: BorderRadius.circular(2)),
            ),
          Expanded(child: Text(label, style: const TextStyle(color: Color(0xFF4B5563)))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final totalInterest = _rows.fold<int>(0, (a, r) => a + r.interest);
    final principal = _amount.round();
    final totalPayable = principal + totalInterest;
    final firstEmi = _rows.isNotEmpty ? _rows.first.emi : 0;
    final interestShare = totalPayable == 0 ? 0 : (totalInterest * 100 / totalPayable).round();
    const principalColor = Color(0xFF2A78D6);
    const interestColor = Color(0xFFEB6834);

    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('EMI Calculator'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _inputCard(
            label: 'LOAN AMOUNT',
            controller: _amountCtl,
            error: _amountErr,
            onText: _onAmountText,
            formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(7)],
            sliderValue: _amount,
            min: _minAmount,
            max: _maxAmount,
            divisions: 499,
            prefix: '₹ ',
            onSlider: (v) {
              _amountErr = null;
              _amount = v;
              _amountCtl.text = v.round().toString();
              _recalc();
            },
          ),
          _inputCard(
            label: 'INTEREST RATE (per year)',
            controller: _rateCtl,
            error: _rateErr,
            onText: _onRateText,
            formatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')), LengthLimitingTextInputFormatter(5)],
            sliderValue: _rate,
            min: _minRate,
            max: _maxRate,
            divisions: 70,
            suffix: '%',
            onSlider: (v) {
              _rateErr = null;
              _rate = v;
              _rateCtl.text = v.toString();
              _recalc();
            },
          ),
          _inputCard(
            label: 'TENURE',
            controller: _tenureCtl,
            error: _tenureErr,
            onText: _onTenureText,
            formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(2)],
            sliderValue: _tenure.toDouble(),
            min: _minTenure.toDouble(),
            max: _maxTenure.toDouble(),
            divisions: _maxTenure - _minTenure,
            suffix: 'months',
            onSlider: (v) {
              _tenureErr = null;
              _tenure = v.round();
              _tenureCtl.text = _tenure.toString();
              _recalc();
            },
          ),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: kNavy, borderRadius: BorderRadius.circular(16)),
            child: Column(
              children: [
                const Text('Monthly EMI', style: TextStyle(color: Colors.white70, fontSize: 13)),
                const SizedBox(height: 4),
                Text(_money(firstEmi),
                    style: const TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: SizedBox(
                    height: 14,
                    child: Row(
                      children: [
                        Expanded(flex: max(1, 100 - interestShare), child: Container(color: principalColor)),
                        const SizedBox(width: 2),
                        Expanded(flex: max(1, interestShare), child: Container(color: interestColor)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                _kv('Principal', _money(principal), dot: principalColor),
                _kv('Total interest', _money(totalInterest), dot: interestColor),
                const Divider(),
                _kv('Total payable', _money(totalPayable)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Container(
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
            child: Theme(
              data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                title: const Text('Repayment schedule', style: TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('$_tenure monthly payments'),
                childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                children: [
                  Row(
                    children: const [
                      Expanded(flex: 1, child: Text('#', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                      Expanded(flex: 3, child: Text('EMI', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                      Expanded(flex: 3, child: Text('Principal', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                      Expanded(flex: 3, child: Text('Interest', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                      Expanded(flex: 3, child: Text('Balance', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
                    ],
                  ),
                  const Divider(height: 12),
                  for (final r in _rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(flex: 1, child: Text('${r.month}', style: const TextStyle(fontSize: 12))),
                          Expanded(flex: 3, child: Text(_money(r.emi), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
                          Expanded(flex: 3, child: Text(_money(r.principal), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
                          Expanded(flex: 3, child: Text(_money(r.interest), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
                          Expanded(flex: 3, child: Text(_money(r.balance), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
                        ],
                      ),
                    ),
                  const SizedBox(height: 6),
                  const Text('The last EMI is adjusted slightly so the balance ends at zero.',
                      style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'This is an estimate. Your actual interest rate and EMI are confirmed when your loan is approved.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: kNavy,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const PanVerifyScreen()),
            ),
            child: const Text('Apply for a loan'),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}
