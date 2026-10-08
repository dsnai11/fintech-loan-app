import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../utils/error_utils.dart';

// Dark, one-thing-per-screen look shared by the sign-in steps (terms, phone check).
const kDarkBg = Color(0xFF0B0B0F);
const kDarkCard = Color(0xFF16161C);
const kDarkLine = Color(0xFF2A2A33);
const kDarkMuted = Color(0xFF9A9AA8);

// The terms and conditions. With `mustAccept` the customer has to agree before going on (after sign-in when a
// new version was published); without it the screen is just for reading.
class TermsScreen extends StatefulWidget {
  final bool mustAccept;
  const TermsScreen({Key? key, this.mustAccept = false}) : super(key: key);

  @override
  State<TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends State<TermsScreen> {
  Map<String, dynamic>? _terms;
  bool _loading = true;
  bool _accepting = false;
  bool _showFull = false;
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
      final t = await context.read<ApiService>().getTerms();
      if (!mounted) return;
      setState(() {
        _terms = t;
        _loading = false;
        _showFull = !widget.mustAccept;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _loading = false;
      });
    }
  }

  Future<void> _accept() async {
    final version = (_terms?['version'] as num?)?.toInt();
    if (version == null) return;
    setState(() {
      _accepting = true;
      _error = null;
    });
    try {
      await context.read<ApiService>().acceptTerms(version);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _accepting = false;
      });
      await _load(); // the terms may have just changed
    }
  }

  Future<void> _signOut() async {
    final nav = Navigator.of(context);
    await context.read<AuthService>().logout();
    nav.pushNamedAndRemoveUntil('/login', (_) => false);
  }

  static const _points = [
    [Icons.visibility_outlined, 'You see every charge first', 'Interest, fees, GST and the yearly cost are shown before you take any loan.'],
    [Icons.lock_outline_rounded, 'Your data stays protected', 'We use it only to run your account, check eligibility and meet legal duties.'],
    [Icons.manage_accounts_outlined, 'You stay in control', 'See your data, export it or ask us to delete it from the Privacy screen.'],
  ];

  @override
  Widget build(BuildContext context) {
    final version = _terms?['version'];
    return PopScope(
      canPop: !widget.mustAccept,
      child: Scaffold(
        backgroundColor: kDarkBg,
        appBar: widget.mustAccept
            ? null
            : AppBar(backgroundColor: kDarkBg, foregroundColor: Colors.white, elevation: 0, title: const Text('Terms and conditions', style: TextStyle(fontSize: 16))),
        body: SafeArea(
          child: _loading
              ? const Center(child: CircularProgressIndicator(color: kGreen))
              : _terms == null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          Text(_error ?? 'Could not load the terms', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
                          const SizedBox(height: 12),
                          ElevatedButton(onPressed: _load, child: const Text('Try again')),
                        ]),
                      ),
                    )
                  : Column(
                      children: [
                        Expanded(
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(24, 28, 24, 16),
                            children: [
                              if (widget.mustAccept) ...[
                                const Text('Before we begin', style: TextStyle(color: kDarkMuted, fontSize: 13, letterSpacing: 1.2, fontWeight: FontWeight.w600)),
                                const SizedBox(height: 10),
                                const Text('A few things worth knowing', style: TextStyle(color: Colors.white, fontSize: 28, height: 1.15, fontWeight: FontWeight.w800)),
                                const SizedBox(height: 24),
                                for (final p in _points) _point(p[0] as IconData, p[1] as String, p[2] as String),
                                const SizedBox(height: 8),
                                GestureDetector(
                                  onTap: () => setState(() => _showFull = !_showFull),
                                  child: Row(children: [
                                    Text(_showFull ? 'Hide the full terms' : 'Read the full terms', style: const TextStyle(color: kGreen, fontWeight: FontWeight.w700, fontSize: 14)),
                                    Icon(_showFull ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded, color: kGreen),
                                  ]),
                                ),
                                const SizedBox(height: 12),
                              ],
                              if (_showFull) _fullText(),
                            ],
                          ),
                        ),
                        if (widget.mustAccept) _footer(version),
                      ],
                    ),
        ),
      ),
    );
  }

  Widget _point(IconData icon, String title, String body) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: kDarkCard, borderRadius: BorderRadius.circular(16), border: Border.all(color: kDarkLine)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: kGreen.withOpacity(0.15), borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, color: kGreen, size: 22),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(body, style: const TextStyle(color: kDarkMuted, fontSize: 13, height: 1.4)),
          ]),
        ),
      ]),
    );
  }

  // The text as the company wrote it: "# " lines are headings, blank lines split paragraphs.
  Widget _fullText() {
    final text = (_terms?['text'] ?? '').toString();
    final blocks = text.split(RegExp(r'\n\s*\n')).map((b) => b.trim()).where((b) => b.isNotEmpty).toList();
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: kDarkCard, borderRadius: BorderRadius.circular(16), border: Border.all(color: kDarkLine)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text((_terms?['title'] ?? 'Terms and conditions').toString(), style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
          Text('Version ${_terms?['version']}', style: const TextStyle(color: kDarkMuted, fontSize: 12)),
          const SizedBox(height: 14),
          for (final b in blocks)
            ...b.split('\n').map((line) {
              final heading = line.startsWith('# ');
              return Padding(
                padding: EdgeInsets.only(top: heading ? 10 : 0, bottom: heading ? 4 : 6),
                child: Text(
                  heading ? line.substring(2) : line,
                  style: TextStyle(color: heading ? Colors.white : const Color(0xFFD1D1DA), fontSize: heading ? 15 : 13.5, height: 1.5, fontWeight: heading ? FontWeight.w700 : FontWeight.w400),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _footer(dynamic version) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
      decoration: const BoxDecoration(color: kDarkBg, border: Border(top: BorderSide(color: kDarkLine))),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: Color(0xFFFF8A8A), fontSize: 13), textAlign: TextAlign.center)),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _accepting ? null : _accept,
            style: ElevatedButton.styleFrom(backgroundColor: kGreen, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 18), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
            child: _accepting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('I agree and continue'),
          ),
        ),
        const SizedBox(height: 10),
        Text('By tapping you accept version $version of the Terms and Conditions.', textAlign: TextAlign.center, style: const TextStyle(color: kDarkMuted, fontSize: 12)),
        TextButton(onPressed: _signOut, child: const Text('Not now, sign out', style: TextStyle(color: kDarkMuted))),
      ]),
    );
  }
}
