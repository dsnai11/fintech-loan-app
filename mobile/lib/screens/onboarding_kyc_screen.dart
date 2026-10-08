import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'setup_scaffold.dart';

// Identity check through DigiLocker. The customer opens DigiLocker in the browser, signs in with the mobile
// number linked to their Aadhaar and agrees to share their details. The app waits and picks up the result.
class OnboardingKycScreen extends StatefulWidget {
  const OnboardingKycScreen({Key? key}) : super(key: key);

  @override
  State<OnboardingKycScreen> createState() => _OnboardingKycScreenState();
}

enum _Kyc { intro, starting, waiting, done, failed }

class _OnboardingKycScreenState extends State<OnboardingKycScreen> with WidgetsBindingObserver {
  _Kyc _stage = _Kyc.intro;
  String? _sessionId;
  String? _error;
  String? _mode;
  Map<String, dynamic>? _result;
  Timer? _poll;
  int _polls = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  // Coming back from the browser: look straight away instead of waiting for the next check.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _stage == _Kyc.waiting) _check();
  }

  Future<void> _start() async {
    setState(() {
      _stage = _Kyc.starting;
      _error = null;
    });
    try {
      final r = await context.read<ApiService>().startDigilocker();
      _sessionId = r['sessionId'].toString();
      _mode = r['mode']?.toString();
      final ok = await launchUrl(Uri.parse(r['url'].toString()), mode: LaunchMode.externalApplication);
      if (!ok) throw Exception('Could not open DigiLocker. Check that you have a web browser.');
      if (!mounted) return;
      setState(() => _stage = _Kyc.waiting);
      _polls = 0;
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 3), (_) => _check());
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(e);
        _stage = _Kyc.failed;
      });
    }
  }

  Future<void> _check() async {
    if (_sessionId == null || !mounted) return;
    if (++_polls > 300) { // about 15 minutes, the life of a session
      _poll?.cancel();
      setState(() {
        _error = 'This took too long. Please try again.';
        _stage = _Kyc.failed;
      });
      return;
    }
    try {
      final s = await context.read<ApiService>().getDigilockerStatus(_sessionId!);
      if (!mounted) return;
      final status = s['status']?.toString();
      if (status == 'completed') {
        _poll?.cancel();
        setState(() {
          _result = s['result'] is Map ? Map<String, dynamic>.from(s['result'] as Map) : {};
          _stage = _Kyc.done;
        });
      } else if (status == 'failed' || status == 'expired') {
        _poll?.cancel();
        setState(() {
          _error = status == 'expired' ? 'That took too long and timed out.' : 'DigiLocker did not finish. You may have chosen not to share your details.';
          _stage = _Kyc.failed;
        });
      }
    } catch (_) {}
  }

  static const _reasons = {
    'name_differs': 'The name on your Aadhaar is different from the name on your account.',
    'date_of_birth_differs': 'The date of birth on your Aadhaar is different from the one on your account.',
    'pan_differs': 'The PAN in DigiLocker is different from the one on your account.',
  };

  @override
  Widget build(BuildContext context) {
    return SetupScaffold(
      step: 1,
      title: 'Verify your identity',
      subtitle: 'We use DigiLocker, the government\'s document locker, so you do not have to upload anything.',
      canSkip: _stage != _Kyc.starting,
      body: switch (_stage) {
        _Kyc.intro || _Kyc.starting => _intro(),
        _Kyc.waiting => _waiting(),
        _Kyc.done => _done(),
        _Kyc.failed => _failed(),
      },
      bottom: switch (_stage) {
        _Kyc.intro => ElevatedButton(onPressed: _start, child: const Text('Continue with DigiLocker')),
        _Kyc.starting => const ElevatedButton(onPressed: null, child: Text('Opening DigiLocker...')),
        _Kyc.waiting => OutlinedButton(onPressed: _start, child: const Text('Open DigiLocker again')),
        _Kyc.done => ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Continue')),
        _Kyc.failed => ElevatedButton(onPressed: _start, child: const Text('Try again')),
      },
    );
  }

  Widget _point(IconData icon, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 22, color: kNavy),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 14, height: 1.45, color: Color(0xFF374151)))),
        ]),
      );

  Widget _intro() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _point(Icons.open_in_browser_rounded, 'DigiLocker opens in your browser. Sign in with the mobile number linked to your Aadhaar.'),
        _point(Icons.verified_user_outlined, 'Agree to share your Aadhaar and PAN details with us.'),
        _point(Icons.lock_outline_rounded, 'We keep only the last four digits of your Aadhaar number.'),
        _point(Icons.arrow_back_rounded, 'Then come back here. We pick it up on our own.'),
        if (_error != null) Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
      ],
    );
  }

  Widget _waiting() {
    return Column(
      children: [
        const SizedBox(height: 24),
        const SizedBox(width: 54, height: 54, child: CircularProgressIndicator(color: kNavy, strokeWidth: 4)),
        const SizedBox(height: 22),
        const Text('Waiting for DigiLocker', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
        const SizedBox(height: 8),
        const Text('Finish in your browser, then come back to this app.', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Color(0xFF6B7280), height: 1.5)),
        if (_mode == 'sandbox')
          Container(
            margin: const EdgeInsets.only(top: 18),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(10)),
            child: const Text('Test mode: the page in your browser stands in for DigiLocker. Nothing real is looked up.', style: TextStyle(fontSize: 12.5, color: Color(0xFF92400E), height: 1.4)),
          ),
      ],
    );
  }

  Widget _done() {
    final r = _result ?? const {};
    final verified = r['status'] == 'verified';
    final flags = (r['flags'] is List) ? (r['flags'] as List).map((e) => e.toString()).toList() : <String>[];
    final shown = flags.where(_reasons.containsKey).map((f) => _reasons[f]!).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: (verified ? kGreen : const Color(0xFFD97706)).withOpacity(0.12), shape: BoxShape.circle),
          child: Icon(verified ? Icons.check_circle_rounded : Icons.hourglass_top_rounded, color: verified ? kGreen : const Color(0xFFD97706), size: 36),
        ),
        const SizedBox(height: 16),
        Text(verified ? 'Identity verified' : 'Thank you. Our team will check your details', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF111827))),
        const SizedBox(height: 8),
        if (verified)
          const Text('Your details matched your account.', style: TextStyle(fontSize: 14, color: Color(0xFF6B7280)))
        else ...[
          const Text('Something did not match exactly, so a person will look at it. You can carry on in the meantime.', style: TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF6B7280))),
          for (final s in shown) Padding(padding: const EdgeInsets.only(top: 8), child: Text('• $s', style: const TextStyle(fontSize: 13, color: Color(0xFF92400E), height: 1.4))),
        ],
      ],
    );
  }

  Widget _failed() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.error_outline_rounded, size: 44, color: Color(0xFFB91C1C)),
        const SizedBox(height: 14),
        Text(_error ?? 'Something went wrong', style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFF374151))),
      ],
    );
  }
}
