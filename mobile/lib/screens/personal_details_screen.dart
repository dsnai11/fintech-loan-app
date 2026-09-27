import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../services/api_service.dart';
import 'loan_flow_scaffold.dart';
import 'eligibility_check_screen.dart';
import '../utils/error_utils.dart';

class PersonalDetailsScreen extends StatefulWidget {
  const PersonalDetailsScreen({Key? key}) : super(key: key);

  @override
  State<PersonalDetailsScreen> createState() => _PersonalDetailsScreenState();
}

class _PersonalDetailsScreenState extends State<PersonalDetailsScreen> {
  final _emailController = TextEditingController();
  final _pincodeController = TextEditingController();
  final _addressController = TextEditingController();
  String _gender = 'Male';
  String _fullName = '';
  String _dob = '';
  bool _isLoading = true;
  bool _isSaving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _emailController.dispose();
    _pincodeController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    try {
      final api = context.read<ApiService>();
      final profile = await api.getUserProfile();
      setState(() {
        _fullName = '${profile['firstName'] ?? ''} ${profile['lastName'] ?? ''}'.trim();
        _emailController.text = profile['email'] ?? '';
        _gender = profile['gender'] ?? 'Male';
        _pincodeController.text = profile['address']?['zipCode'] ?? '';
        _addressController.text = profile['address']?['street'] ?? '';
        if (profile['dateOfBirth'] != null) {
          final d = DateTime.tryParse(profile['dateOfBirth']);
          if (d != null) {
            _dob = '${d.day.toString().padLeft(2, '0')}-${d.month.toString().padLeft(2, '0')}-${d.year}';
          }
        }
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _continue() async {
    setState(() { _isSaving = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      await api.updateUserProfile({
        'gender': _gender,
        'address': {
          'street': _addressController.text.trim(),
          'zipCode': _pincodeController.text.trim(),
        },
      });

      final appState = LoanApplicationState(
        loanAmount: 30000,
        tenure: 1,
        planType: 'one_time',
        gender: _gender,
        pincode: _pincodeController.text.trim(),
        address: _addressController.text.trim(),
        email: _emailController.text.trim(),
      );

      if (mounted) {
        Navigator.push(context,
            MaterialPageRoute(builder: (_) => EligibilityCheckScreen(appState: appState)));
      }
    } catch (e) {
      setState(() { _error = friendlyError(e); _isSaving = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 2,
      title: 'Personal Details',
      buttonLabel: 'Continue',
      onContinue: _isLoading || _isSaving ? null : _continue,
      isLoading: _isSaving,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: kNavy))
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Tell us a bit about yourself. This helps us process your loan faster.',
                    style: TextStyle(fontSize: 13, color: Color(0xFF6B7280), height: 1.5),
                  ),

                  loanFieldLabel('FULL NAME (AS PER PAN)'),
                  _frozenField(_fullName.isNotEmpty ? _fullName : 'Your Name'),

                  if (_dob.isNotEmpty) ...[
                    loanFieldLabel('DATE OF BIRTH'),
                    _frozenField(_dob),
                  ],

                  loanFieldLabel('EMAIL ADDRESS'),
                  TextField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      hintText: 'you@example.com',
                      prefixIcon: Icon(Icons.email_outlined, size: 18, color: Color(0xFF9CA3AF)),
                    ),
                  ),

                  loanFieldLabel('PINCODE'),
                  TextField(
                    controller: _pincodeController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      hintText: '400001',
                      counterText: '',
                    ),
                  ),

                  loanFieldLabel('GENDER'),
                  const SizedBox(height: 4),
                  Row(
                    children: ['Male', 'Female', 'Other'].map((g) {
                      final selected = _gender == g;
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: GestureDetector(
                            onTap: () => setState(() => _gender = g),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              decoration: BoxDecoration(
                                color: selected ? kNavy : const Color(0xFFF9FAFB),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: selected ? kNavy : const Color(0xFFE5E7EB),
                                ),
                              ),
                              child: Text(g,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: selected ? Colors.white : const Color(0xFF374151),
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13,
                                  )),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),

                  loanFieldLabel('CURRENT ADDRESS'),
                  TextField(
                    controller: _addressController,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      hintText: 'Enter your full address',
                      alignLabelWithHint: true,
                    ),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFFCA5A5)),
                      ),
                      child: Text(_error!,
                          style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _frozenField(String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(value,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600,
                    color: Color(0xFF374151))),
          ),
          const Text('From profile', style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
        ],
      ),
    );
  }
}
