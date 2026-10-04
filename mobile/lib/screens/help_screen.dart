import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

// Who the lender is and how to reach them, including the grievance officer. The details are set by the
// lender in the admin portal, and anything left empty there is simply not shown.
class HelpScreen extends StatefulWidget {
  const HelpScreen({Key? key}) : super(key: key);

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  Map<String, dynamic>? _info;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await context.read<ApiService>().getPricing();
      if (!mounted) return;
      setState(() {
        _info = Map<String, dynamic>.from((p['institution'] as Map?) ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _loading = false;
      });
    }
  }

  String _v(String key) => (_info?[key] ?? '').toString().trim();

  Widget _line(String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF), fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          SelectableText(value, style: const TextStyle(fontSize: 14, color: Color(0xFF111827))),
        ],
      ),
    );
  }

  Widget _card(String title, List<Widget> children) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          ...children,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasGrievance = _v('grievanceOfficerName').isNotEmpty ||
        _v('grievanceOfficerEmail').isNotEmpty ||
        _v('grievanceOfficerPhone').isNotEmpty;

    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('Help & grievance'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: kNavy))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      ElevatedButton(onPressed: _load, child: const Text('Retry')),
                    ]),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _card('Your lender', [
                      _line('Name', _v('lenderName')),
                      _line('Registration number', _v('registrationNumber')),
                      _line('Registered address', _v('address')),
                      _line('Website', _v('website')),
                    ]),
                    _card('Contact support', [
                      _line('Email', _v('supportEmail')),
                      _line('Phone', _v('supportPhone')),
                      if (_v('supportEmail').isEmpty && _v('supportPhone').isEmpty)
                        const Text('Support details will appear here soon.',
                            style: TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
                    ]),
                    if (hasGrievance)
                      _card('Grievance officer', [
                        const Text(
                          'If you are not satisfied with the support you received, write to the grievance officer.',
                          style: TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.4),
                        ),
                        _line('Name', _v('grievanceOfficerName')),
                        _line('Email', _v('grievanceOfficerEmail')),
                        _line('Phone', _v('grievanceOfficerPhone')),
                      ]),
                  ],
                ),
    );
  }
}
