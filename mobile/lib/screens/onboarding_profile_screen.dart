import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../data/indian_data.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'setup_scaffold.dart';

// Personal details: gender, date of birth, address and work. Used when setting up the account and again from the
// profile when something changes. The date of birth is checked against the Aadhaar record from DigiLocker.
class OnboardingProfileScreen extends StatefulWidget {
  final int step;
  final bool fromProfile;
  const OnboardingProfileScreen({Key? key, this.step = 2, this.fromProfile = false}) : super(key: key);

  @override
  State<OnboardingProfileScreen> createState() => _OnboardingProfileScreenState();
}

class _OnboardingProfileScreenState extends State<OnboardingProfileScreen> {
  static const _work = ['Employed', 'Self-Employed', 'Student', 'Unemployed'];
  final _street = TextEditingController();
  final _city = TextEditingController();
  final _pin = TextEditingController();
  final _company = TextEditingController();
  final _income = TextEditingController();
  String _gender = '';
  String _state = '';
  String _status = '';
  DateTime? _dob;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [_street, _city, _pin, _company, _income]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = await context.read<ApiService>().getUserProfile();
      if (!mounted) return;
      final a = (p['address'] as Map?) ?? const {};
      final e = (p['employment'] as Map?) ?? const {};
      setState(() {
        _gender = (p['gender'] ?? '').toString();
        _dob = DateTime.tryParse((p['dateOfBirth'] ?? '').toString())?.toLocal();
        _street.text = (a['street'] ?? '').toString();
        _city.text = (a['city'] ?? '').toString();
        _state = indianStates.contains(a['state']) ? a['state'].toString() : '';
        _pin.text = (a['zipCode'] ?? '').toString();
        _status = _work.contains(e['status']) ? e['status'].toString() : '';
        _company.text = (e['company'] ?? '').toString();
        final inc = e['monthlyIncome'];
        _income.text = (inc is num && inc > 0) ? inc.toInt().toString() : '';
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _earns => _status == 'Employed' || _status == 'Self-Employed';

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 30, 1, 1),
      firstDate: DateTime(now.year - 90),
      lastDate: DateTime(now.year - 18, now.month, now.day),
      helpText: 'Date of birth',
    );
    if (d != null) setState(() => _dob = d);
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await context.read<ApiService>().saveOnboardingProfile({
        'gender': _gender,
        'dateOfBirth': _dob == null ? '' : '${_dob!.year.toString().padLeft(4, '0')}-${_dob!.month.toString().padLeft(2, '0')}-${_dob!.day.toString().padLeft(2, '0')}',
        'address': {'street': _street.text.trim(), 'city': _city.text.trim(), 'state': _state, 'zipCode': _pin.text.trim()},
        'employment': {'status': _status, 'company': _company.text.trim(), 'monthlyIncome': _income.text.trim().isEmpty ? 0 : int.tryParse(_income.text.trim()) ?? 0},
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _saving = false;
      });
    }
  }

  Widget _label(String t) => Padding(padding: const EdgeInsets.only(bottom: 6, top: 14), child: Text(t, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF6B7280))));

  @override
  Widget build(BuildContext context) {
    return SetupScaffold(
      step: widget.step,
      canSkip: !widget.fromProfile,
      title: 'Your details',
      subtitle: 'We need these to offer you a loan that fits. They stay private.',
      bottom: Column(mainAxisSize: MainAxisSize.min, children: [
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13))),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: (_saving || _loading) ? null : _save, child: Text(_saving ? 'Saving...' : 'Save and continue'))),
      ]),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator(color: kNavy)))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _label('GENDER'),
                Wrap(spacing: 8, children: [
                  for (final g in const ['Male', 'Female', 'Other'])
                    ChoiceChip(label: Text(g), selected: _gender == g, selectedColor: kNavy.withOpacity(0.15), onSelected: (_) => setState(() => _gender = g)),
                ]),
                _label('DATE OF BIRTH'),
                OutlinedButton.icon(
                  onPressed: _pickDob,
                  icon: const Icon(Icons.cake_outlined, size: 18),
                  label: Text(_dob == null ? 'Choose your date of birth' : '${_dob!.day}/${_dob!.month}/${_dob!.year}'),
                  style: OutlinedButton.styleFrom(alignment: Alignment.centerLeft, minimumSize: const Size.fromHeight(52), foregroundColor: const Color(0xFF111827)),
                ),
                _label('ADDRESS'),
                TextField(controller: _street, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(hintText: 'House, street and area')),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: TextField(controller: _city, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(hintText: 'City'))),
                  const SizedBox(width: 10),
                  Expanded(child: TextField(controller: _pin, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(hintText: 'PIN code', counterText: ''))),
                ]),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: _state.isEmpty ? null : _state,
                  isExpanded: true,
                  hint: const Text('State'),
                  items: [for (final s in indianStates) DropdownMenuItem(value: s, child: Text(s))],
                  onChanged: (v) => setState(() => _state = v ?? ''),
                ),
                _label('WHAT YOU DO'),
                DropdownButtonFormField<String>(
                  value: _status.isEmpty ? null : _status,
                  isExpanded: true,
                  hint: const Text('Choose one'),
                  items: [for (final s in _work) DropdownMenuItem(value: s, child: Text(s))],
                  onChanged: (v) => setState(() => _status = v ?? ''),
                ),
                if (_earns) ...[
                  const SizedBox(height: 10),
                  TextField(controller: _company, textCapitalization: TextCapitalization.words, decoration: InputDecoration(hintText: _status == 'Employed' ? 'Employer' : 'Business name')),
                  const SizedBox(height: 10),
                  TextField(controller: _income, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Monthly income (₹)')),
                ],
              ],
            ),
    );
  }
}
