import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import 'onboarding_bank_screen.dart';
import 'onboarding_kyc_screen.dart';
import 'onboarding_profile_screen.dart';
import 'selfie_liveness_screen.dart';

// The four parts of the account set-up as they stand, on the profile: identity, details, photo and bank, each
// with what is done and a way to do or redo it.
class AccountSetupCard extends StatefulWidget {
  final Map<String, dynamic> profile;
  final VoidCallback onChanged;
  const AccountSetupCard({Key? key, required this.profile, required this.onChanged}) : super(key: key);

  @override
  State<AccountSetupCard> createState() => _AccountSetupCardState();
}

class _AccountSetupCardState extends State<AccountSetupCard> {
  Uint8List? _photo;
  bool _photoTried = false;

  Map get _kyc => (widget.profile['kycDigilocker'] as Map?) ?? const {};
  Map get _selfie => (widget.profile['selfie'] as Map?) ?? const {};
  Map get _bank => (widget.profile['bankAccount'] as Map?) ?? const {};

  @override
  void initState() {
    super.initState();
    _loadPhoto();
  }

  Future<void> _loadPhoto() async {
    if (_selfie.isEmpty) return;
    final bytes = await context.read<ApiService>().getSelfieBytes();
    if (mounted) {
      setState(() {
        _photo = bytes == null ? null : Uint8List.fromList(bytes);
        _photoTried = true;
      });
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => screen));
    widget.onChanged();
    _loadPhoto();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.profile;
    final a = (p['address'] as Map?) ?? const {};
    final e = (p['employment'] as Map?) ?? const {};
    final detailsDone = p['dateOfBirth'] != null && (p['gender'] ?? '').toString().isNotEmpty && (a['street'] ?? '').toString().isNotEmpty && (a['zipCode'] ?? '').toString().isNotEmpty && (e['status'] ?? '').toString().isNotEmpty;
    final kycStatus = (_kyc['status'] ?? '').toString();
    final selfieStatus = (_selfie['status'] ?? '').toString();
    final acct = (_bank['accountNumber'] ?? '').toString();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Account set-up', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
          const SizedBox(height: 4),
          const Text('Everything we need before you can apply for a loan.', style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          const SizedBox(height: 10),
          _row(Icons.badge_outlined, 'Identity (DigiLocker)', kycStatus == 'verified' ? 'Verified' : kycStatus == 'review' ? 'Under review' : 'Not done', kycStatus == 'verified', kycStatus.isEmpty ? 'Verify' : null, () => _open(const OnboardingKycScreen())),
          _row(Icons.person_outline_rounded, 'Personal details', detailsDone ? 'Done' : 'Not done', detailsDone, detailsDone ? 'Edit' : 'Add', () => _open(const OnboardingProfileScreen(fromProfile: true))),
          _row(Icons.face_retouching_natural_rounded, 'Photo and blink check', selfieStatus == 'passed' ? 'Verified' : selfieStatus == 'review' ? 'Under review' : selfieStatus == 'rejected' ? 'Please retake' : 'Not done', selfieStatus == 'passed', selfieStatus.isEmpty ? 'Take' : 'Retake', () => _open(const SelfieLivenessScreen(fromProfile: true)), leading: _photo != null ? ClipOval(child: Image.memory(_photo!, width: 36, height: 36, fit: BoxFit.cover)) : null),
          _row(Icons.account_balance_outlined, 'Bank account', acct.isEmpty ? 'Not done' : '${(_bank['bankName'] ?? 'Bank')} ····${acct.length > 4 ? acct.substring(acct.length - 4) : acct}', acct.isNotEmpty, acct.isEmpty ? 'Add' : 'Change', () => _open(const OnboardingBankScreen(fromProfile: true))),
          if (_photoTried && _selfie.isNotEmpty && _photo == null) const SizedBox.shrink(),
        ],
      ),
    );
  }

  Widget _row(IconData icon, String title, String status, bool ok, String? action, VoidCallback onTap, {Widget? leading}) {
    final color = ok ? kGreen : const Color(0xFFD97706);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(children: [
        leading ?? Container(width: 36, height: 36, decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle), child: Icon(icon, size: 19, color: color)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
            Text(status, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600)),
          ]),
        ),
        if (action != null) TextButton(onPressed: onTap, child: Text(action)) else TextButton(onPressed: onTap, child: const Text('Redo')),
      ]),
    );
  }
}
