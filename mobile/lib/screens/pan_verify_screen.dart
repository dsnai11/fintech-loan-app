import 'package:flutter/material.dart';
import '../main.dart';
import 'loan_flow_scaffold.dart';
import 'personal_details_screen.dart';

class PanVerifyScreen extends StatefulWidget {
  const PanVerifyScreen({Key? key}) : super(key: key);

  @override
  State<PanVerifyScreen> createState() => _PanVerifyScreenState();
}

class _PanVerifyScreenState extends State<PanVerifyScreen> {
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _isLoading = false);
    });
  }

  void _continue() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const PersonalDetailsScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 1,
      title: 'Loan Application',
      onContinue: _isLoading ? null : _continue,
      body: _isLoading ? _buildLoading() : _buildContent(),
    );
  }

  Widget _buildLoading() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: kNavy.withOpacity(0.05),
              shape: BoxShape.circle,
            ),
            child: const CircularProgressIndicator(
                color: kNavy, strokeWidth: 3),
          ),
          const SizedBox(height: 24),
          const Text(
            'Fetching your details',
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF111827)),
          ),
          const SizedBox(height: 8),
          const Text(
            'Securely retrieving your profile\nlinked to your mobile number',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: Color(0xFF6B7280), height: 1.5),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: kNavy.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.verified_user_rounded, color: kNavy, size: 24),
              ),
              const SizedBox(width: 14),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Confirm your details',
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF111827))),
                  SizedBox(height: 2),
                  Text('We found these details linked to\nyour mobile number',
                      style: TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: kGreen.withOpacity(0.1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: const [
                Icon(Icons.check_circle_rounded, color: kGreen, size: 14),
                SizedBox(width: 6),
                Text('Auto fetched',
                    style: TextStyle(
                        color: kGreen, fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const SizedBox(height: 20),

          _detailCard('FULL NAME', 'Suraj Ludhani', Icons.person_outline_rounded),
          const SizedBox(height: 12),
          _detailCard('DATE OF BIRTH', '15-06-2002', Icons.cake_outlined),
          const SizedBox(height: 12),
          _detailCard('PAN NUMBER', 'ABCDE1234F', Icons.credit_card_rounded),
          const SizedBox(height: 20),

          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _continue,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: kNavy,
                    side: const BorderSide(color: kNavy),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: const Text('Change it',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: _continue,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: kGreen,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: const Text('Correct ✓',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _detailCard(String label, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Row(
        children: [
          Icon(icon, color: kNavy, size: 20),
          const SizedBox(width: 14),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF9CA3AF),
                      letterSpacing: 0.8)),
              const SizedBox(height: 3),
              Text(value,
                  style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF111827))),
            ],
          ),
        ],
      ),
    );
  }
}
