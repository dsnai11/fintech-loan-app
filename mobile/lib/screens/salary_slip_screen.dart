import 'dart:convert';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../utils/format.dart';
import '../widgets/employer_field.dart';
import '../widgets/tr_text.dart';
import '../widgets/ui_kit.dart';

// Proving your salary with a salary slip: photograph the latest slip (up to 3 photos), say the take-home amount, and our team checks it.
// The photos are used only for this check and are deleted a few weeks after we decide.
class SalarySlipScreen extends StatefulWidget {
  const SalarySlipScreen({Key? key}) : super(key: key);

  @override
  State<SalarySlipScreen> createState() => _SalarySlipScreenState();
}

class _SalarySlipScreenState extends State<SalarySlipScreen> {
  Map<String, dynamic>? _status;
  final List<String> _photos = []; // base64
  final _income = TextEditingController();
  final _employer = TextEditingController();
  String _month = '';
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _month = _months().first;
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _income.dispose();
    _employer.dispose();
    super.dispose();
  }

  // This month and the two before, as YYYY-MM
  List<String> _months() {
    final now = DateTime.now();
    return [for (var i = 0; i < 3; i++) _fmt(DateTime(now.year, now.month - i, 1))];
  }

  String _fmt(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';

  String _label(String ym) {
    const m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    final p = ym.split('-');
    return '${m[int.parse(p[1]) - 1]} ${p[0]}';
  }

  Future<void> _load() async {
    try {
      final s = await context.read<ApiService>().getSalaryProofStatus();
      if (mounted) setState(() => _status = s);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
  }

  Future<void> _add(ImageSource source) async {
    if (_photos.length >= 3) return;
    try {
      final f = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 70);
      if (f == null) return;
      final bytes = await f.readAsBytes();
      if (mounted) setState(() { _photos.add(base64Encode(bytes)); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = 'We could not open the camera or photos. Check that the app is allowed to use them.');
    }
  }

  Future<void> _send() async {
    final income = int.tryParse(_income.text.replaceAll(',', '').trim());
    if (_photos.isEmpty) return setState(() => _error = 'Add at least one photo of your salary slip.');
    if (income == null || income < 3000) return setState(() => _error = 'Enter your take-home salary, the amount that reaches your bank.');
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<ApiService>().submitSalarySlip(images: _photos, monthlyIncome: income, employer: _employer.text.trim(), slipMonth: _month);
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
    if (mounted) setState(() => _busy = false);
  }

  Widget _done(String icon, String title, String text, {Color color = kGood, IconData data = Icons.check_circle_rounded}) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(data, color: color, size: 64),
        const SizedBox(height: 14),
        Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: kInk)),
        const SizedBox(height: 8),
        Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, height: 1.5, color: kMuted)),
        const SizedBox(height: 22),
        ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    Widget body;
    if (s == null) {
      body = Center(child: _error != null ? Padding(padding: const EdgeInsets.all(24), child: Text(_error!)) : const CircularProgressIndicator(color: kNavy));
    } else if (_sent) {
      body = _done('', 'We have your salary slip', 'We will check it soon and send you a notification the moment it is done.');
    } else if (s['verified'] == true) {
      body = _done('', 'Your salary is confirmed', '${formatMoney(asNum(s['income']))} a month, counted until ${'${s['validUntil']}'.substring(0, 10)}.');
    } else if (s['latest'] is Map && (s['latest'] as Map)['status'] == 'pending') {
      body = _done('', 'We are checking your slip', 'You do not need to do anything. We will send you a notification when it is done.', color: kNavy, data: Icons.hourglass_top_rounded);
    } else {
      final rejected = s['latest'] is Map && (s['latest'] as Map)['status'] == 'rejected';
      body = ListView(padding: const EdgeInsets.all(20), children: [
        const Text('Prove your salary', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: kInk)),
        const SizedBox(height: 4),
        const Text('Take a clear photo of your latest salary slip. Our team checks it, usually soon.', style: TextStyle(fontSize: 13, color: kMuted, height: 1.45)),
        if (rejected) ...[
          const SizedBox(height: 12),
          AppCard(color: const Color(0xFFFEF2F2), borderColor: const Color(0xFFFECACA), shadow: false, child: Text('Last time: ${(s['latest'] as Map)['reason'] ?? 'we could not confirm it'}. Please upload it again.', style: const TextStyle(fontSize: 13, color: Color(0xFFB91C1C), height: 1.4))),
        ],
        const SizedBox(height: 16),
        AppCard(
          padding: const EdgeInsets.all(18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Photos of the slip', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            const Text('Up to 3 photos. Make sure your name, the employer, the month and the net pay can be read.', style: TextStyle(fontSize: 12.5, color: kMuted)),
            const SizedBox(height: 12),
            Wrap(spacing: 10, runSpacing: 10, children: [
              for (var i = 0; i < _photos.length; i++)
                Stack(clipBehavior: Clip.none, children: [
                  ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.memory(base64Decode(_photos[i]), width: 92, height: 120, fit: BoxFit.cover)),
                  Positioned(right: -6, top: -6, child: GestureDetector(onTap: () => setState(() => _photos.removeAt(i)), child: Container(padding: const EdgeInsets.all(3), decoration: const BoxDecoration(color: kInk, shape: BoxShape.circle), child: const Icon(Icons.close_rounded, size: 14, color: Colors.white)))),
                ]),
              if (_photos.length < 3) ...[
                _addTile(Icons.photo_camera_rounded, 'Camera', () => _add(ImageSource.camera)),
                _addTile(Icons.photo_library_rounded, 'Gallery', () => _add(ImageSource.gallery)),
              ],
            ]),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          padding: const EdgeInsets.all(18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('What the slip says', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: _income, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Take-home (net) salary for the month (₹)', helperText: 'The amount that reaches your bank account')),
            const SizedBox(height: 12),
            EmployerField(controller: _employer, hint: 'Employer name on the slip', asLabel: true, maxLength: 80),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _month,
              decoration: const InputDecoration(labelText: 'Month of the slip'),
              items: [for (final m in _months()) DropdownMenuItem(value: m, child: Text(_label(m)))],
              onChanged: (v) => setState(() => _month = v ?? _month),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12.5))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending...' : 'Send for checking'))),
          ]),
        ),
        const SizedBox(height: 12),
        const Text('We use these photos only to check your salary, and delete them a few weeks after we decide. Please send only your own, genuine slip.', style: TextStyle(fontSize: 11.5, color: kMuted, height: 1.45)),
      ]);
    }
    return Scaffold(backgroundColor: kBg, appBar: AppBar(title: const Text('Salary slip')), body: body);
  }

  Widget _addTile(IconData icon, String label, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 92,
          height: 120,
          decoration: BoxDecoration(color: kNavy.withOpacity(0.06), borderRadius: BorderRadius.circular(12), border: Border.all(color: kLine)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, color: kNavy, size: 26), const SizedBox(height: 6), Text(label, style: const TextStyle(fontSize: 12, color: kNavy, fontWeight: FontWeight.w600))]),
        ),
      );
}
