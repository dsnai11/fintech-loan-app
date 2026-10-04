import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../main.dart';
import '../utils/error_utils.dart';
import '../utils/format.dart';
import '../widgets/form_inputs.dart';

class LoanApplicationScreen extends StatefulWidget {
  const LoanApplicationScreen({Key? key}) : super(key: key);

  @override
  State<LoanApplicationScreen> createState() => _LoanApplicationScreenState();
}

class _LoanApplicationScreenState extends State<LoanApplicationScreen> {
  double _loanAmount = 100000;
  int _tenure = 12;
  String _selectedPurpose = 'Personal';
  String _selectedLoanType = 'Personal Loan';
  bool _isLoading = false;
  double _monthlyEMI = 0;
  double _rate = 15;
  double _minAmount = 1000;
  double _maxAmount = 500000;
  Map<String, dynamic>? _quote;
  Timer? _quoteTimer;

  final _purposes = ['Personal', 'Business', 'Education', 'Medical', 'Other'];
  final _loanTypes = ['Personal Loan', 'Micro Loan', 'Business Loan'];

  void _calculateEMI() {
    if (_loanAmount > 0 && _tenure > 0) {
      final monthlyRate = _rate / 12 / 100;
      final emi = (_loanAmount * monthlyRate * pow(1 + monthlyRate, _tenure)) /
          (pow(1 + monthlyRate, _tenure) - 1);
      setState(() => _monthlyEMI = emi);
    } else {
      setState(() => _monthlyEMI = 0);
    }
    _scheduleQuote();
  }

  // The figures a customer must be shown (fees, GST, what they receive, APR) come from the server, so they
  // are always the lender's current terms.
  void _scheduleQuote() {
    _quoteTimer?.cancel();
    _quote = null;
    _quoteTimer = Timer(const Duration(milliseconds: 350), () async {
      if (!mounted) return;
      try {
        final q = await context.read<ApiService>().getQuote(amount: _loanAmount.toInt(), tenure: _tenure);
        if (mounted) setState(() => _quote = q);
      } catch (_) {
        if (mounted) setState(() => _quote = null);
      }
    });
  }

  Future<void> _loadPricing() async {
    try {
      final p = await context.read<ApiService>().getPricing();
      if (!mounted) return;
      setState(() {
        _rate = asNum(p['annualRatePercent']).toDouble();
        _minAmount = asNum(p['minAmount']).toDouble();
        _maxAmount = asNum(p['maxAmount']).toDouble();
        if (_loanAmount > _maxAmount) _loanAmount = _maxAmount;
        if (_loanAmount < _minAmount) _loanAmount = _minAmount;
      });
      _calculateEMI();
    } catch (_) {}
  }

  @override
  void dispose() {
    _quoteTimer?.cancel();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _calculateEMI();
    Future.microtask(_loadPricing);
  }

  Future<void> _applyLoan() async {
    if (_loanAmount <= 0 || _tenure <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select loan amount and tenure')),
      );
      return;
    }
    setState(() => _isLoading = true);
    try {
      final apiService = context.read<ApiService>();
      final response = await apiService.applyLoan(
        loanAmount: _loanAmount.toInt(),
        tenure: _tenure,
        purpose: _selectedPurpose,
        loanType: _selectedLoanType,
      );
      if (mounted) {
        _showSuccess(response['message'] ?? 'Loan applied successfully!');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(friendlyError(e)),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showSuccess(String message) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: kGreen.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle_rounded, color: kGreen, size: 48),
            ),
            const SizedBox(height: 16),
            const Text('Application Submitted!',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
            const SizedBox(height: 8),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF6B7280), fontSize: 14)),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context);
                  Navigator.pop(context);
                },
                child: const Text('Back to Home'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Color(0xFF6B7280),
            letterSpacing: 0.8,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {

    return Scaffold(
      backgroundColor: kNavy,
      body: Column(
        children: [
          // ── Navy header ──────────────────────────────────────────
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.arrow_back_ios_new_rounded,
                          color: Colors.white, size: 18),
                    ),
                  ),
                  const SizedBox(width: 16),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Apply for Loan',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w700)),
                      Text('Quick & Easy Approval',
                          style: TextStyle(color: Colors.white60, fontSize: 13)),
                    ],
                  ),
                ],
              ),
            ),
          ),

          // ── White card ───────────────────────────────────────────
          Expanded(
            child: Container(
              decoration: const BoxDecoration(
                color: kBg,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Loan Amount Slider ──
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.04),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: LoanAmountSlider(
                        label: 'LOAN AMOUNT',
                        minAmount: _minAmount,
                        maxAmount: _maxAmount,
                        initialAmount: _loanAmount,
                        onChanged: (amount) {
                          setState(() => _loanAmount = amount);
                          _calculateEMI();
                        },
                      ),
                    ),
                    const SizedBox(height: 12),

                    // ── Tenure Slider ──
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.04),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _label('LOAN TENURE'),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF9FAFB),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: const Color(0xFFE5E7EB)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text(
                                      'Tenure',
                                      style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                                    ),
                                    Text(
                                      '$_tenure months',
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w700,
                                        color: kNavy,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 16),
                                Slider(
                                  value: _tenure.toDouble(),
                                  min: 6,
                                  max: 60,
                                  divisions: 54,
                                  activeColor: kNavy,
                                  inactiveColor: const Color(0xFFE5E7EB),
                                  onChanged: (value) {
                                    setState(() => _tenure = value.toInt());
                                    _calculateEMI();
                                  },
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: const [
                                    Text('6 months',
                                        style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                                    Text('60 months',
                                        style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    // ── Purpose & Type ──
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.04),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _label('PURPOSE OF LOAN'),
                          DropdownButtonFormField<String>(
                            value: _selectedPurpose,
                            decoration: const InputDecoration(
                                fillColor: Color(0xFFF9FAFB)),
                            items: _purposes
                                .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                                .toList(),
                            onChanged: (v) => setState(() => _selectedPurpose = v ?? _selectedPurpose),
                          ),
                          const SizedBox(height: 16),
                          _label('LOAN TYPE'),
                          DropdownButtonFormField<String>(
                            value: _selectedLoanType,
                            decoration: const InputDecoration(
                                fillColor: Color(0xFFF9FAFB)),
                            items: _loanTypes
                                .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                                .toList(),
                            onChanged: (v) => setState(() => _selectedLoanType = v ?? _selectedLoanType),
                          ),
                        ],
                      ),
                    ),

                    // ── EMI Summary ──
                    if (_monthlyEMI > 0) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [kNavy, Color(0xFF312E81)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.calculate_rounded, color: kGreen, size: 18),
                                SizedBox(width: 8),
                                Text('Loan Summary',
                                    style: TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 15)),
                              ],
                            ),
                            const SizedBox(height: 16),
                            _summaryRow('Loan Amount', '₹${_loanAmount.toStringAsFixed(0)}'),
                            _summaryRow('Tenure', '$_tenure months'),
                            _summaryRow('Interest Rate', '${formatPercent(_rate)}% p.a.'),
                            const Divider(color: Colors.white24, height: 20),
                            _summaryRow(
                              'Monthly EMI',
                              _quote != null ? formatMoney(asNum(_quote!['emi'])) : '₹${_monthlyEMI.toStringAsFixed(0)}',
                              highlight: true,
                            ),
                            _summaryRow(
                              'Total Payable',
                              _quote != null ? formatMoney(asNum(_quote!['totalRepayable'])) : '₹${(_monthlyEMI * _tenure).toStringAsFixed(0)}',
                            ),
                            _summaryRow(
                              'Total Interest',
                              _quote != null ? formatMoney(asNum(_quote!['totalInterest'])) : '₹${(_monthlyEMI * _tenure - _loanAmount).toStringAsFixed(0)}',
                            ),
                            if (_quote != null) ...[
                              const Divider(color: Colors.white24, height: 20),
                              _summaryRow('Processing fee (${formatPercent(asNum(_quote!['processingFeePercent']))}%)', '- ${formatMoney(asNum(_quote!['processingFee']))}'),
                              _summaryRow('GST (${formatPercent(asNum(_quote!['gstPercent']))}%)', '- ${formatMoney(asNum(_quote!['gst']))}'),
                              _summaryRow('You receive', formatMoney(asNum(_quote!['netDisbursed'])), highlight: true),
                              _summaryRow('APR (all costs)', '${formatPercent(asNum(_quote!['aprPercent']))}%'),
                            ],
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 24),

                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _applyLoan,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: kGreen,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                        child: _isLoading
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text('Apply Now',
                                      style: TextStyle(
                                          fontSize: 16, fontWeight: FontWeight.w700)),
                                  SizedBox(width: 8),
                                  Icon(Icons.arrow_forward_rounded, size: 20),
                                ],
                              ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: const [
                        Icon(Icons.shield_outlined, size: 14, color: kGreen),
                        SizedBox(width: 6),
                        Text('256-bit SSL encrypted & secure',
                            style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryRow(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(
                  color: highlight ? kGreen : Colors.white60,
                  fontSize: highlight ? 14 : 13,
                  fontWeight: highlight ? FontWeight.w600 : FontWeight.normal)),
          Text(value,
              style: TextStyle(
                  color: Colors.white,
                  fontSize: highlight ? 18 : 13,
                  fontWeight: highlight ? FontWeight.w800 : FontWeight.w500)),
        ],
      ),
    );
  }
}
