import 'dart:math';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';

class LoanApplicationScreen extends StatefulWidget {
  const LoanApplicationScreen({Key? key}) : super(key: key);

  @override
  State<LoanApplicationScreen> createState() => _LoanApplicationScreenState();
}

class _LoanApplicationScreenState extends State<LoanApplicationScreen> {
  late TextEditingController _loanAmountController;
  late TextEditingController _tenureController;
  String _selectedPurpose = 'Personal';
  String _selectedLoanType = 'Personal Loan';
  bool _isLoading = false;
  double _monthlyEMI = 0;

  final purposes = ['Personal', 'Business', 'Education', 'Medical', 'Other'];
  final loanTypes = ['Personal Loan', 'Micro Loan', 'Business Loan'];

  @override
  void initState() {
    super.initState();
    _loanAmountController = TextEditingController();
    _tenureController = TextEditingController();
  }

  @override
  void dispose() {
    _loanAmountController.dispose();
    _tenureController.dispose();
    super.dispose();
  }

  void _calculateEMI() {
    final amount = int.tryParse(_loanAmountController.text) ?? 0;
    final tenure = int.tryParse(_tenureController.text) ?? 1;

    if (amount > 0 && tenure > 0) {
      const double interestRate = 15;
      final monthlyRate = interestRate / 12 / 100;
      final emi = (amount *
              monthlyRate *
              pow(1 + monthlyRate, tenure)) /
          (pow(1 + monthlyRate, tenure) - 1);

      setState(() {
        _monthlyEMI = emi;
      });
    }
  }

  Future<void> _applyLoan() async {
    if (_loanAmountController.text.isEmpty || _tenureController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all fields')),
      );
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final apiService = context.read<ApiService>();
      final response = await apiService.applyLoan(
        loanAmount: int.parse(_loanAmountController.text),
        tenure: int.parse(_tenureController.text),
        purpose: _selectedPurpose,
        loanType: _selectedLoanType,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(response['message'])),
        );

        Future.delayed(const Duration(seconds: 1), () {
          if (mounted) {
            Navigator.pop(context);
          }
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${e.toString()}')),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Apply for Loan'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSection(
              title: 'Loan Amount',
              child: TextField(
                controller: _loanAmountController,
                onChanged: (_) => _calculateEMI(),
                decoration: InputDecoration(
                  hintText: 'Enter amount (₹1000 - ₹500000)',
                  prefixText: '₹ ',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                ),
                keyboardType: TextInputType.number,
              ),
            ),
            const SizedBox(height: 20),
            _buildSection(
              title: 'Loan Tenure (Months)',
              child: TextField(
                controller: _tenureController,
                onChanged: (_) => _calculateEMI(),
                decoration: InputDecoration(
                  hintText: 'Enter tenure (6 - 60 months)',
                  suffixText: 'months',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                ),
                keyboardType: TextInputType.number,
              ),
            ),
            const SizedBox(height: 20),
            _buildSection(
              title: 'Purpose of Loan',
              child: DropdownButtonFormField<String>(
                value: _selectedPurpose,
                items: purposes.map((purpose) {
                  return DropdownMenuItem(
                    value: purpose,
                    child: Text(purpose),
                  );
                }).toList(),
                onChanged: (value) {
                  setState(() {
                    _selectedPurpose = value ?? _selectedPurpose;
                  });
                },
                decoration: InputDecoration(
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),
            _buildSection(
              title: 'Loan Type',
              child: DropdownButtonFormField<String>(
                value: _selectedLoanType,
                items: loanTypes.map((type) {
                  return DropdownMenuItem(
                    value: type,
                    child: Text(type),
                  );
                }).toList(),
                onChanged: (value) {
                  setState(() {
                    _selectedLoanType = value ?? _selectedLoanType;
                  });
                },
                decoration: InputDecoration(
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 30),
            if (_monthlyEMI > 0)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.blue.shade200),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Loan Summary',
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 12),
                    _buildSummaryRow('Loan Amount:', '₹${_loanAmountController.text}'),
                    const SizedBox(height: 8),
                    _buildSummaryRow('Tenure:', '${_tenureController.text} months'),
                    const SizedBox(height: 8),
                    _buildSummaryRow(
                      'Monthly EMI:',
                      '₹${_monthlyEMI.toStringAsFixed(0)}',
                      isBold: true,
                    ),
                    const SizedBox(height: 8),
                    _buildSummaryRow(
                      'Total Amount:',
                      '₹${(_monthlyEMI * int.parse(_tenureController.text)).toStringAsFixed(0)}',
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 30),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _applyLoan,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  backgroundColor: Colors.blue.shade600,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                child: _isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      )
                    : Text(
                        'Apply Now',
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                            ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required Widget child,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w500,
              ),
        ),
        const SizedBox(height: 10),
        child,
      ],
    );
  }

  Widget _buildSummaryRow(String label, String value, {bool isBold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
              ),
        ),
        Text(
          value,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
                color: isBold ? Colors.blue.shade600 : null,
              ),
        ),
      ],
    );
  }
}
