import 'package:flutter/material.dart';
import 'loan_flow_scaffold.dart';
import 'eligibility_check_screen.dart';

class PersonalDetailsScreen extends StatefulWidget {
  const PersonalDetailsScreen({Key? key}) : super(key: key);

  @override
  State<PersonalDetailsScreen> createState() => _PersonalDetailsScreenState();
}

class _PersonalDetailsScreenState extends State<PersonalDetailsScreen> {
  final _emailController = TextEditingController(text: 'suraj.ludhani@gmail.com');
  final _pincodeController = TextEditingController(text: '400001');
  final _addressController = TextEditingController(text: '102, Shanti Niwas, Andheri West');
  String _gender = 'Male';

  @override
  void dispose() {
    _emailController.dispose();
    _pincodeController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LoanFlowScaffold(
      step: 2,
      title: 'Personal Details',
      buttonLabel: 'Continue',
      onContinue: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const EligibilityCheckScreen()),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Tell us a bit about yourself. This helps us process your loan faster.',
              style: TextStyle(fontSize: 13, color: Color(0xFF6B7280), height: 1.5),
            ),

            loanFieldLabel('FULL NAME (AS PER PAN)'),
            _frozenField('Suraj Ludhani'),

            loanFieldLabel("FATHER'S NAME"),
            _frozenField('Ramesh Ludhani'),

            loanFieldLabel('EMAIL ADDRESS'),
            TextField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                hintText: 'you@example.com',
                prefixIcon: Icon(Icons.email_outlined, size: 18, color: Color(0xFF9CA3AF)),
              ),
            ),

            loanFieldLabel('DATE OF BIRTH'),
            _frozenField('15-06-2002'),

            loanFieldLabel('PINCODE'),
            TextField(
              controller: _pincodeController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: '400001'),
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
                          color: selected
                              ? const Color(0xFF1E1B4B)
                              : const Color(0xFFF9FAFB),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: selected
                                ? const Color(0xFF1E1B4B)
                                : const Color(0xFFE5E7EB),
                          ),
                        ),
                        child: Text(
                          g,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: selected ? Colors.white : const Color(0xFF374151),
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
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
              ),
            ),
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
                style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF374151))),
          ),
          const Text('Fetched from PAN',
              style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
        ],
      ),
    );
  }
}
