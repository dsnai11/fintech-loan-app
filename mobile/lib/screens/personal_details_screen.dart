import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/loan_application_state.dart';
import '../services/api_service.dart';
import 'loan_flow_scaffold.dart';
import 'eligibility_check_screen.dart';
import 'loan_plan_screen.dart';
import '../services/app_settings.dart';
import '../utils/error_utils.dart';
import '../widgets/form_inputs.dart';
import '../data/indian_data.dart';

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
  String _state = '';
  DateTime? _dob;
  String _fullName = '';
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
        _state = profile['address']?['state'] ?? '';
        _pincodeController.text = profile['address']?['zipCode'] ?? '';
        _addressController.text = profile['address']?['street'] ?? '';
        if (profile['dateOfBirth'] != null) {
          _dob = DateTime.tryParse(profile['dateOfBirth']);
        }
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _continue() async {
    if (_state.isEmpty) {
      setState(() => _error = 'Please select your state');
      return;
    }
    if (_pincodeController.text.isEmpty) {
      setState(() => _error = 'Please enter your pincode');
      return;
    }
    if (_addressController.text.isEmpty) {
      setState(() => _error = 'Please enter your address');
      return;
    }

    setState(() { _isSaving = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      await api.updateUserProfile({
        'gender': _gender,
        'address': {
          'street': _addressController.text.trim(),
          'city': '',
          'state': _state,
          'zipCode': _pincodeController.text.trim(),
          'country': 'India',
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
        final skip = !context.read<AppSettings>().eligibilityCheck;
        Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => skip ? LoanPlanScreen(appState: appState) : EligibilityCheckScreen(appState: appState)));
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

                  DatePickerField(
                    label: 'DATE OF BIRTH',
                    initialDate: _dob,
                    firstDate: DateTime(1950),
                    lastDate: DateTime.now(),
                    onChanged: (date) => setState(() => _dob = date),
                    validator: (date) {
                      if (date == null) return 'Date of birth is required';
                      final age = DateTime.now().year - date.year;
                      if (age < 18) return 'You must be at least 18 years old';
                      return null;
                    },
                  ),

                  loanFieldLabel('EMAIL ADDRESS'),
                  TextField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      hintText: 'you@example.com',
                      prefixIcon: Icon(Icons.email_outlined, size: 18, color: Color(0xFF9CA3AF)),
                    ),
                  ),

                  DropdownField<String>(
                    label: 'STATE',
                    displayText: (value) => value ?? 'Select your state',
                    value: _state.isEmpty ? null : _state,
                    items: indianStates
                        .map((state) => DropdownItem(value: state, label: state))
                        .toList(),
                    onChanged: (value) => setState(() => _state = value ?? ''),
                    hint: 'Select your state',
                  ),

                  loanFieldLabel('PINCODE'),
                  TextField(
                    controller: _pincodeController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      hintText: '400001',
                      counterText: '',
                      prefixIcon: Icon(Icons.location_on_outlined, size: 18, color: Color(0xFF9CA3AF)),
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
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    g == 'Male'
                                        ? Icons.male_rounded
                                        : g == 'Female'
                                            ? Icons.female_rounded
                                            : Icons.people_rounded,
                                    size: 18,
                                    color: selected ? Colors.white : const Color(0xFF6B7280),
                                  ),
                                  const SizedBox(width: 4),
                                  Text(g,
                                      style: TextStyle(
                                        color: selected ? Colors.white : const Color(0xFF374151),
                                        fontWeight: FontWeight.w600,
                                        fontSize: 13,
                                      )),
                                ],
                              ),
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
                      prefixIcon: Padding(
                        padding: EdgeInsets.only(top: 12),
                        child: Icon(Icons.location_on_outlined, size: 18, color: Color(0xFF9CA3AF)),
                      ),
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
