import 'income_check_screen.dart';
import 'credit_score_screen.dart';
import 'rewards_screen.dart';
import 'account_setup_card.dart';
import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import '../widgets/language_picker.dart';
import 'referral_screen.dart';
import 'notification_settings_screen.dart';
import '../services/push_service.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../utils/error_utils.dart';
import 'privacy_screen.dart';
import 'help_screen.dart';

class ProfileScreen extends StatefulWidget {
  // `embedded` when shown as a tab: there is nowhere to go back to.
  final bool embedded;
  const ProfileScreen({Key? key, this.embedded = false}) : super(key: key);

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _profile;
  bool _loading = true;
  bool _editing = false;
  bool _saving = false;
  String? _error;

  final _firstNameCtrl = TextEditingController();
  final _lastNameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _streetCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _stateCtrl = TextEditingController();
  String _gender = 'Male';
  String _empStatus = 'Employed';

  @override
  void initState() {
    super.initState();
    _fetchProfile();
  }

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _phoneCtrl.dispose();
    _streetCtrl.dispose();
    _cityCtrl.dispose();
    _stateCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchProfile() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      final p = await api.getUserProfile();
      setState(() {
        _profile = p;
        _loading = false;
        _firstNameCtrl.text = p['firstName'] ?? '';
        _lastNameCtrl.text = p['lastName'] ?? '';
        _phoneCtrl.text = p['phone'] ?? '';
        _gender = p['gender'] ?? 'Male';
        _empStatus = p['employment']?['status'] ?? 'Employed';
        final addr = p['address'] as Map? ?? {};
        _streetCtrl.text = addr['street'] ?? '';
        _cityCtrl.text = addr['city'] ?? '';
        _stateCtrl.text = addr['state'] ?? '';
      });
    } catch (e) {
      setState(() { _error = friendlyError(e); _loading = false; });
    }
  }

  Future<void> _saveProfile() async {
    setState(() { _saving = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      await api.updateUserProfile({
        'firstName': _firstNameCtrl.text.trim(),
        'lastName': _lastNameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        'gender': _gender,
        'address': {
          'street': _streetCtrl.text.trim(),
          'city': _cityCtrl.text.trim(),
          'state': _stateCtrl.text.trim(),
        },
        'employment': {'status': _empStatus},
      });
      await _fetchProfile();
      setState(() { _editing = false; _saving = false; });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Profile updated successfully'),
            backgroundColor: Color(0xFF22C55E),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      setState(() { _error = friendlyError(e); _saving = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      body: Column(
        children: [
          // Header
          Container(
            color: kNavy,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
                child: Row(
                  children: [
                    if (!widget.embedded) ...[
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
                    const SizedBox(width: 14),
                    ],
                    const Expanded(
                      child: Text('My Profile',
                          style: TextStyle(color: Colors.white, fontSize: 20,
                              fontWeight: FontWeight.w700)),
                    ),
                    if (!_loading && !_editing)
                      GestureDetector(
                        onTap: () => setState(() => _editing = true),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(
                            color: kGreen,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text('Edit',
                              style: TextStyle(color: Colors.white, fontSize: 13,
                                  fontWeight: FontWeight.w700)),
                        ),
                      ),
                    if (_editing) ...[
                      GestureDetector(
                        onTap: () => setState(() => _editing = false),
                        child: const Text('Cancel',
                            style: TextStyle(color: Colors.white60, fontSize: 13)),
                      ),
                      const SizedBox(width: 12),
                      GestureDetector(
                        onTap: _saving ? null : _saveProfile,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(
                            color: kGreen,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: _saving
                              ? const SizedBox(
                                  width: 14, height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Text('Save',
                                  style: TextStyle(color: Colors.white, fontSize: 13,
                                      fontWeight: FontWeight.w700)),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),

          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: kNavy))
                : _error != null && _profile == null
                    ? _buildError()
                    : _buildContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    final email = _profile?['email'] ?? '';
    final kycStatus = _profile?['kycStatus'] ?? 'pending';
    final creditScore = _profile?['creditScore'];
    final bank = _profile?['bankAccount'] as Map? ?? {};
    final loanCount = (_profile?['loanHistory'] as List?)?.length ?? 0;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          // Avatar card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04),
                  blurRadius: 8, offset: const Offset(0, 2))],
            ),
            child: Row(
              children: [
                Container(
                  width: 60, height: 60,
                  decoration: BoxDecoration(
                    color: kNavy,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      '${_firstNameCtrl.text.isNotEmpty ? _firstNameCtrl.text[0] : '?'}${_lastNameCtrl.text.isNotEmpty ? _lastNameCtrl.text[0] : ''}',
                      style: const TextStyle(color: Colors.white, fontSize: 22,
                          fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${_firstNameCtrl.text} ${_lastNameCtrl.text}',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17,
                              color: Color(0xFF111827))),
                      Text(email,
                          style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          _badge('KYC: ${kycStatus[0].toUpperCase()}${kycStatus.substring(1)}',
                              kycStatus == 'approved' ? kGreen : const Color(0xFFF59E0B)),
                          const SizedBox(width: 6),
                          _badge('$loanCount Loan${loanCount != 1 ? 's' : ''}', kNavy),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Stats row
          Row(
            children: [
              Expanded(child: _statCard('Credit Score',
                  creditScore != null ? '$creditScore' : 'N/A',
                  Icons.star_rounded, const Color(0xFFF59E0B))),
              const SizedBox(width: 10),
              Expanded(child: _statCard('Active Loans',
                  '$loanCount', Icons.description_rounded, kNavy)),
              const SizedBox(width: 10),
              Expanded(child: _statCard('KYC',
                  kycStatus == 'approved' ? 'Done' : 'Pending',
                  Icons.verified_user_rounded,
                  kycStatus == 'approved' ? kGreen : const Color(0xFFF59E0B))),
            ],
          ),
          const SizedBox(height: 12),

          // Identity, details, selfie and bank, with a way to do or redo each
          AccountSetupCard(profile: _profile ?? const {}, onChanged: _fetchProfile),
          const SizedBox(height: 12),

          const RewardsRow(),
          const CreditScoreRow(),
          const IncomeCheckRow(),
          const ReferEarnRow(),
          const NotificationSettingsRow(),
          const LanguageRow(),

          // Personal info
          _section('Personal Information', [
            _field('First Name', _firstNameCtrl, editing: _editing),
            _field('Last Name', _lastNameCtrl, editing: _editing),
            _field('Phone', _phoneCtrl, editing: _editing,
                keyboard: TextInputType.phone),
            if (_editing)
              _genderPicker()
            else
              _infoRow('Gender', _gender),
            _infoRow('Email', email),
          ]),
          const SizedBox(height: 12),

          // Address
          _section('Address', [
            _field('Street', _streetCtrl, editing: _editing),
            _field('City', _cityCtrl, editing: _editing),
            _field('State', _stateCtrl, editing: _editing),
          ]),
          const SizedBox(height: 12),

          // Employment
          _section('Employment', [
            if (_editing)
              _empPicker()
            else
              _infoRow('Status', _empStatus),
          ]),
          const SizedBox(height: 12),

          // Bank account
          if (bank.isNotEmpty)
            _section('Bank Account (Linked)', [
              _infoRow('Holder', bank['accountHolder'] ?? '—'),
              _infoRow('Bank', bank['bankName'] ?? '—'),
              _infoRow('IFSC', bank['ifscCode'] ?? '—'),
              _infoRow('Account', '****${(bank['accountNumber'] ?? '').toString().length > 4
                  ? (bank['accountNumber'] ?? '').toString().substring(
                      (bank['accountNumber'] ?? '').toString().length - 4)
                  : (bank['accountNumber'] ?? '')}'),
            ]),

          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFCA5A5)),
                ),
                child: Text(_error!,
                    style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
              ),
            ),

          const SizedBox(height: 12),

          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PrivacyScreen()),
              ),
              icon: const Icon(Icons.privacy_tip_outlined, size: 18),
              label: const Text('Privacy & my data'),
              style: OutlinedButton.styleFrom(
                foregroundColor: kNavy,
                side: const BorderSide(color: kNavy),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const HelpScreen()),
              ),
              icon: const Icon(Icons.support_agent_rounded, size: 18),
              label: const Text('Help & grievance'),
              style: OutlinedButton.styleFrom(
                foregroundColor: kNavy,
                side: const BorderSide(color: kNavy),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Logout
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () async {
                final auth = context.read<AuthService>();
                final nav = Navigator.of(context);
                // Stop alerts for this account reaching this phone, before the sign-in is cleared
                await PushService.instance.unregister().timeout(const Duration(seconds: 3), onTimeout: () {});
                auth.logout();
                nav.pushReplacementNamed('/login');
              },
              icon: const Icon(Icons.logout_rounded, size: 18),
              label: const Text('Sign Out'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFEF4444),
                side: const BorderSide(color: Color(0xFFEF4444)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04),
            blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Text(title,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14,
                    color: Color(0xFF111827))),
          ),
          const Divider(height: 1, color: Color(0xFFF3F4F6)),
          ...children,
        ],
      ),
    );
  }

  Widget _field(String label, TextEditingController ctrl,
      {bool editing = false, TextInputType keyboard = TextInputType.text}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF),
                  fontWeight: FontWeight.w600, letterSpacing: 0.5)),
          const SizedBox(height: 4),
          if (editing)
            TextField(
              controller: ctrl,
              keyboardType: keyboard,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600,
                  color: Color(0xFF111827)),
              decoration: InputDecoration(
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                fillColor: const Color(0xFFF9FAFB),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: Color(0xFFE5E7EB))),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(ctrl.text.isEmpty ? '—' : ctrl.text,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600,
                      color: Color(0xFF111827))),
            ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF),
                  fontWeight: FontWeight.w600, letterSpacing: 0.5)),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(value.isEmpty ? '—' : value,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600,
                    color: Color(0xFF111827))),
          ),
        ],
      ),
    );
  }

  Widget _genderPicker() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Gender',
              style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF),
                  fontWeight: FontWeight.w600, letterSpacing: 0.5)),
          const SizedBox(height: 6),
          Row(
            children: ['Male', 'Female', 'Other'].map((g) {
              final sel = _gender == g;
              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: GestureDetector(
                    onTap: () => setState(() => _gender = g),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: sel ? kNavy : const Color(0xFFF9FAFB),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                            color: sel ? kNavy : const Color(0xFFE5E7EB)),
                      ),
                      child: Text(g,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: sel ? Colors.white : const Color(0xFF374151),
                              fontWeight: FontWeight.w600, fontSize: 13)),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _empPicker() {
    final opts = ['Employed', 'Self-Employed', 'Student', 'Unemployed'];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Employment Status',
              style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF),
                  fontWeight: FontWeight.w600, letterSpacing: 0.5)),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            value: _empStatus,
            decoration: const InputDecoration(isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
            items: opts.map((o) => DropdownMenuItem(value: o, child: Text(o))).toList(),
            onChanged: (v) => setState(() => _empStatus = v ?? _empStatus),
          ),
        ],
      ),
    );
  }

  Widget _badge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04),
            blurRadius: 6, offset: const Offset(0, 2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 8),
          Text(value,
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color)),
          Text(label,
              style: const TextStyle(fontSize: 10, color: Color(0xFF9CA3AF),
                  fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.wifi_off_rounded, color: Color(0xFF9CA3AF), size: 48),
          const SizedBox(height: 12),
          Text('Could not load profile\n${_error ?? ''}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _fetchProfile, child: const Text('Retry')),
        ],
      ),
    );
  }
}
