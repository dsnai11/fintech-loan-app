import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import 'loan_flow_scaffold.dart';
import 'personal_details_screen.dart';
import '../utils/error_utils.dart';

class PanVerifyScreen extends StatefulWidget {
  const PanVerifyScreen({Key? key}) : super(key: key);

  @override
  State<PanVerifyScreen> createState() => _PanVerifyScreenState();
}

class _PanVerifyScreenState extends State<PanVerifyScreen> {
  bool _isLoading = true;
  bool _isSaving = false;
  Map<String, dynamic>? _profile;
  final _panController = TextEditingController();
  final _dobController = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _panController.dispose();
    _dobController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    try {
      final api = context.read<ApiService>();
      final profile = await api.getUserProfile();
      setState(() {
        _profile = profile;
        _isLoading = false;
        if (profile['panNumber'] != null) {
          _panController.text = profile['panNumber'];
        }
        if (profile['dateOfBirth'] != null) {
          final dob = DateTime.tryParse(profile['dateOfBirth']);
          if (dob != null) {
            _dobController.text =
                '${dob.day.toString().padLeft(2, '0')}-${dob.month.toString().padLeft(2, '0')}-${dob.year}';
          }
        }
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _confirmAndContinue() async {
    final pan = _panController.text.trim().toUpperCase();
    if (pan.isEmpty) {
      setState(() => _error = 'Please enter your PAN number');
      return;
    }
    if (!RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$').hasMatch(pan)) {
      setState(() => _error = 'Invalid PAN format (e.g. ABCDE1234F)');
      return;
    }

    setState(() { _isSaving = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      await api.updateUserProfile({
        'panNumber': pan,
        'dateOfBirth': _dobController.text.isNotEmpty ? _parseDob(_dobController.text) : null,
      });
      if (mounted) {
        Navigator.push(context,
            MaterialPageRoute(builder: (_) => const PersonalDetailsScreen()));
      }
    } catch (e) {
      setState(() { _error = friendlyError(e); _isSaving = false; });
    }
  }

  String? _parseDob(String dob) {
    try {
      final parts = dob.split('-');
      if (parts.length == 3) {
        return DateTime(int.parse(parts[2]), int.parse(parts[1]), int.parse(parts[0])).toIso8601String();
      }
    } catch (_) {}
    return null;
  }

  String _fullName() {
    if (_profile == null) return '';
    final first = _profile!['firstName'] ?? '';
    final last = _profile!['lastName'] ?? '';
    return '$first $last'.trim();
  }

  bool get _hasPan => (_profile?['panNumber'] ?? '').toString().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 1,
      title: 'Loan Application',
      onContinue: _isLoading || _isSaving ? null : _confirmAndContinue,
      isLoading: _isSaving,
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
            child: const CircularProgressIndicator(color: kNavy, strokeWidth: 3),
          ),
          const SizedBox(height: 24),
          const Text('Fetching your details',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
          const SizedBox(height: 8),
          const Text('Securely retrieving your profile',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: Color(0xFF6B7280))),
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
                  Text('Verify your identity',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
                  SizedBox(height: 2),
                  Text('Enter your PAN to proceed',
                      style: TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
                ],
              ),
            ],
          ),
          const SizedBox(height: 20),

          _detailCard('FULL NAME', _fullName().isNotEmpty ? _fullName() : 'Your Name', Icons.person_outline_rounded),
          const SizedBox(height: 12),

          loanFieldLabel('DATE OF BIRTH (DD-MM-YYYY)'),
          TextField(
            controller: _dobController,
            keyboardType: TextInputType.datetime,
            decoration: const InputDecoration(
              hintText: 'e.g. 15-06-2000',
              prefixIcon: Icon(Icons.cake_outlined, size: 18, color: Color(0xFF9CA3AF)),
            ),
          ),
          const SizedBox(height: 12),

          loanFieldLabel('PAN NUMBER'),
          TextField(
            controller: _panController,
            textCapitalization: TextCapitalization.characters,
            maxLength: 10,
            decoration: InputDecoration(
              hintText: 'e.g. ABCDE1234F',
              counterText: '',
              prefixIcon: const Icon(Icons.credit_card_rounded, size: 18, color: Color(0xFF9CA3AF)),
              suffixIcon: _hasPan
                  ? const Icon(Icons.check_circle_rounded, color: kGreen, size: 20)
                  : null,
            ),
          ),

          if (_hasPan) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: kGreen.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check_circle_rounded, color: kGreen, size: 14),
                  SizedBox(width: 6),
                  Text('PAN already verified',
                      style: TextStyle(color: kGreen, fontSize: 12, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          ],

          if (_error != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFFCA5A5)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_error!,
                        style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: kNavy.withOpacity(0.04),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              children: [
                Icon(Icons.lock_rounded, color: kNavy, size: 16),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Your PAN is encrypted and used only for KYC verification.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF374151), height: 1.4),
                  ),
                ),
              ],
            ),
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
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600,
                      color: Color(0xFF9CA3AF), letterSpacing: 0.8)),
              const SizedBox(height: 3),
              Text(value,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
                      color: Color(0xFF111827))),
            ],
          ),
        ],
      ),
    );
  }
}
