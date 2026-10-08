import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'dart:async';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

class AgreementScreen extends StatefulWidget {
  final Map<String, dynamic> loan;
  const AgreementScreen({Key? key, required this.loan}) : super(key: key);

  @override
  State<AgreementScreen> createState() => _AgreementScreenState();
}

class _AgreementScreenState extends State<AgreementScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  bool _saving = false;
  bool _agree = false;
  String? _error;
  final _codeCtrl = TextEditingController();
  bool _codeSent = false;
  String? _sandboxCode;
  String? _esignSession;
  Timer? _poll;

  String get _loanId => widget.loan['_id'].toString();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _codeCtrl.dispose();
    super.dispose();
  }

  String get _method => (_data?['signing']?['method'] ?? 'click').toString();

  Future<void> _openPdf() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final url = await context.read<ApiService>().getAgreementPdfUrl(_loanId);
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Could not open the PDF')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<void> _sendCode() async {
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await context.read<ApiService>().sendAgreementCode(_loanId);
      if (!mounted) return;
      setState(() { _codeSent = true; _sandboxCode = r['sandboxOtp']?.toString(); });
      messenger.showSnackBar(SnackBar(content: Text('We sent a code to ${r['phone']}')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _esign() async {
    final hash = _data?['hash']?.toString();
    if (hash == null) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await context.read<ApiService>().startEsign(_loanId, hash);
      _esignSession = r['sessionId'].toString();
      final ok = await launchUrl(Uri.parse(r['url'].toString()), mode: LaunchMode.externalApplication);
      if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Could not open the signing page')));
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 3), (_) => _checkEsign());
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _checkEsign() async {
    final id = _esignSession;
    if (id == null) return;
    try {
      final r = await context.read<ApiService>().esignStatus(id);
      final st = r['status'];
      if (st == 'completed') {
        _poll?.cancel();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Agreement signed. Your loan will be disbursed soon.')));
        Navigator.of(context).pop(true);
      } else if (st == 'failed' || st == 'expired') {
        _poll?.cancel();
        _esignSession = null;
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Signing was not completed. You can try again.')));
      }
    } catch (_) {}
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final d = await context.read<ApiService>().getAgreement(_loanId);
      setState(() { _data = d; _loading = false; });
    } catch (e) {
      setState(() { _error = friendlyError(e); _loading = false; });
    }
  }

  Future<void> _accept() async {
    final hash = _data?['hash']?.toString();
    if (hash == null) return;
    setState(() => _saving = true);
    try {
      await context.read<ApiService>().acceptAgreement(_loanId, hash, code: _method == 'otp' ? _codeCtrl.text.trim() : null);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Agreement accepted. Your loan will be disbursed soon.')),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
      setState(() { _saving = false; _agree = false; });
      _fetch();
    }
  }

  String _fmtDate(dynamic iso) {
    try {
      final d = DateTime.parse(iso.toString()).toLocal();
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${d.day} ${months[d.month - 1]} ${d.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final accepted = _data?['accepted'];
    final canAccept = _data != null && accepted == null && _data!['loanStatus'] == 'approved';

    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('Loan Agreement'),
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
                      ElevatedButton(onPressed: _fetch, child: const Text('Retry')),
                    ]),
                  ),
                )
              : Column(
                  children: [
                    if (accepted != null)
                      Container(
                        width: double.infinity,
                        color: const Color(0xFFD1FAE5),
                        padding: const EdgeInsets.all(12),
                        child: Row(children: [
                          Expanded(
                            child: Text('You signed this agreement on ${_fmtDate(accepted['at'])}.',
                                style: const TextStyle(color: Color(0xFF065F46), fontWeight: FontWeight.w600)),
                          ),
                          TextButton(onPressed: _openPdf, child: const Text('PDF')),
                        ]),
                      ),
                    if (accepted == null)
                      Align(alignment: Alignment.centerRight, child: TextButton.icon(onPressed: _openPdf, icon: const Icon(Icons.picture_as_pdf_outlined, size: 18), label: const Text('Download PDF'))),
                    Expanded(
                      child: Container(
                        margin: const EdgeInsets.all(16),
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                        child: SingleChildScrollView(
                          child: Text(
                            _data!['text'].toString(),
                            style: const TextStyle(fontSize: 13, height: 1.5, color: Color(0xFF111827)),
                          ),
                        ),
                      ),
                    ),
                    if (canAccept)
                      SafeArea(
                        top: false,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              CheckboxListTile(
                                value: _agree,
                                onChanged: _saving ? null : (v) => setState(() => _agree = v ?? false),
                                controlAffinity: ListTileControlAffinity.leading,
                                contentPadding: EdgeInsets.zero,
                                title: const Text('I have read and agree to this loan agreement',
                                    style: TextStyle(fontSize: 13)),
                              ),
                              if (_method == 'otp') ...[
                                if (!_codeSent)
                                  SizedBox(
                                    width: double.infinity,
                                    child: ElevatedButton(
                                      onPressed: (_agree && !_saving) ? _sendCode : null,
                                      style: ElevatedButton.styleFrom(backgroundColor: kNavy, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 14)),
                                      child: const Text('Send me a code to sign'),
                                    ),
                                  )
                                else ...[
                                  TextField(
                                    controller: _codeCtrl,
                                    keyboardType: TextInputType.number,
                                    maxLength: 6,
                                    onChanged: (_) => setState(() {}),
                                    decoration: InputDecoration(labelText: 'Code from the SMS', helperText: _sandboxCode != null ? 'Test mode: the code is $_sandboxCode' : null, counterText: ''),
                                  ),
                                  Row(children: [
                                    Expanded(
                                      child: ElevatedButton(
                                        onPressed: (_agree && !_saving && _codeCtrl.text.trim().length == 6) ? _accept : null,
                                        style: ElevatedButton.styleFrom(backgroundColor: kNavy, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 14)),
                                        child: _saving ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Sign agreement'),
                                      ),
                                    ),
                                    TextButton(onPressed: _saving ? null : _sendCode, child: const Text('Resend')),
                                  ]),
                                ],
                              ] else if (_method == 'aadhaar')
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: (_agree && !_saving && _data?['signing']?['available'] != false) ? _esign : null,
                                    style: ElevatedButton.styleFrom(backgroundColor: kNavy, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 14)),
                                    child: Text(_data?['signing']?['available'] == false ? 'Aadhaar eSign is not available right now' : _esignSession != null ? 'Waiting for you to finish signing...' : 'Sign with Aadhaar eSign'),
                                  ),
                                )
                              else
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: (_agree && !_saving) ? _accept : null,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: kNavy,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(vertical: 14),
                                    ),
                                    child: _saving
                                        ? const SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                          )
                                        : const Text('Accept agreement'),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
    );
  }
}
