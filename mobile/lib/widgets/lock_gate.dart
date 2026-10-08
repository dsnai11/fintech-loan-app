import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/app_lock.dart';
import '../services/app_settings.dart';
import '../services/auth_service.dart';
import 'tr_text.dart';

/// Wraps the whole app. It locks the app behind the PIN when the app was left for a while, asks for a PIN when the company
/// requires one, and signs the customer out after a period of no use.
class LockGate extends StatefulWidget {
  final Widget child;
  const LockGate({Key? key, required this.child}) : super(key: key);

  @override
  State<LockGate> createState() => _LockGateState();
}

class _LockGateState extends State<LockGate> with WidgetsBindingObserver {
  Timer? _timer;
  DateTime _lastTouch = DateTime.now();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _checkIdle());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final lock = AppLock.instance;
    final settings = context.read<AppSettings>();
    final auth = context.read<AuthService>();
    if (state == AppLifecycleState.paused) {
      lock.left();
    } else if (state == AppLifecycleState.resumed) {
      final away = lock.awayFor();
      lock.clearAway();
      if (away == null || !auth.isAuthenticated) return;
      final idleMin = settings.idleLogoutMinutes;
      if (idleMin > 0 && away > Duration(minutes: idleMin)) {
        _signOut();
        return;
      }
      if (settings.appLockMode != 'off' && lock.pinSet && away.inSeconds >= settings.lockAfterSeconds) lock.lockNow();
      _lastTouch = DateTime.now();
    }
  }

  void _checkIdle() {
    final auth = context.read<AuthService>();
    final idleMin = context.read<AppSettings>().idleLogoutMinutes;
    if (!auth.isAuthenticated || idleMin <= 0) return;
    if (DateTime.now().difference(_lastTouch) > Duration(minutes: idleMin)) _signOut();
  }

  Future<void> _signOut() async {
    await context.read<AuthService>().logout();
    await AppLock.instance.removePin();
    navigatorKey.currentState?.pushNamedAndRemoveUntil('/login', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final lock = context.watch<AppLock>();
    final mode = context.watch<AppSettings>().appLockMode;
    Widget? overlay;
    if (auth.isAuthenticated && mode != 'off') {
      if (lock.pinSet && lock.locked) {
        overlay = _EnterPin(onForgot: _signOut);
      } else if (!lock.pinSet && mode == 'required') {
        overlay = const PinSetup(forced: true);
      }
    }
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _lastTouch = DateTime.now(),
      child: Stack(children: [widget.child, if (overlay != null) Positioned.fill(child: overlay)]),
    );
  }
}

// ── The keypad ─────────────────────────────────────────────────────────────────────────────────
class _PinPad extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const _PinPad({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    void tap(String d) {
      if (value.length < AppLock.pinLength) onChanged(value + d);
    }

    Widget key(String label, {VoidCallback? onTap, IconData? icon}) => Expanded(
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: InkWell(
              borderRadius: BorderRadius.circular(40),
              onTap: onTap,
              child: SizedBox(height: 62, child: Center(child: icon != null ? Icon(icon, size: 24) : Text(label, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w600)))),
            ),
          ),
        );

    return Column(mainAxisSize: MainAxisSize.min, children: [
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < AppLock.pinLength; i++)
          Container(margin: const EdgeInsets.all(8), width: 16, height: 16, decoration: BoxDecoration(shape: BoxShape.circle, color: i < value.length ? kNavy : const Color(0xFFE5E7EB))),
      ]),
      const SizedBox(height: 18),
      for (final row in [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']])
        Row(children: [for (final d in row) key(d, onTap: () => tap(d))]),
      Row(children: [
        key('', onTap: null),
        key('0', onTap: () => tap('0')),
        key('', icon: Icons.backspace_outlined, onTap: () { if (value.isNotEmpty) onChanged(value.substring(0, value.length - 1)); }),
      ]),
    ]);
  }
}

// ── Asking for the PIN ─────────────────────────────────────────────────────────────────────────
class _EnterPin extends StatefulWidget {
  final Future<void> Function() onForgot;
  const _EnterPin({required this.onForgot});

  @override
  State<_EnterPin> createState() => _EnterPinState();
}

class _EnterPinState extends State<_EnterPin> {
  String _pin = '';
  String? _error;

  void _changed(String v) {
    setState(() { _pin = v; _error = null; });
    if (v.length == AppLock.pinLength) {
      final lock = AppLock.instance;
      if (lock.verify(v)) return;
      if (lock.triesLeft <= 0) {
        widget.onForgot();
        return;
      }
      setState(() { _pin = ''; _error = 'Wrong PIN. ${lock.triesLeft} ${lock.triesLeft == 1 ? 'try' : 'tries'} left.'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.lock_rounded, size: 40, color: kNavy),
              const SizedBox(height: 12),
              const Text('Enter your PIN', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              SizedBox(height: 20, child: _error == null ? null : Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13))),
              const SizedBox(height: 10),
              SizedBox(width: 300, child: _PinPad(value: _pin, onChanged: _changed)),
              TextButton(onPressed: widget.onForgot, child: const Text('Forgot PIN? Sign in again')),
            ]),
          ),
        ),
      ),
    );
  }
}

// ── Choosing a PIN ─────────────────────────────────────────────────────────────────────────────
class PinSetup extends StatefulWidget {
  final bool forced; // the company requires a PIN, so it cannot be skipped
  const PinSetup({Key? key, this.forced = false}) : super(key: key);

  @override
  State<PinSetup> createState() => _PinSetupState();
}

class _PinSetupState extends State<PinSetup> {
  String _pin = '';
  String? _first;
  String? _error;

  Future<void> _changed(String v) async {
    setState(() { _pin = v; _error = null; });
    if (v.length != AppLock.pinLength) return;
    if (_first == null) {
      setState(() { _first = v; _pin = ''; });
      return;
    }
    if (v != _first) {
      setState(() { _first = null; _pin = ''; _error = 'The two PINs did not match. Start again.'; });
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    await AppLock.instance.setPin(v);
    if (!widget.forced && mounted) {
      nav.pop(true);
      messenger.showSnackBar(const SnackBar(content: Text('PIN set. The app will ask for it when you come back to it.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.lock_outline_rounded, size: 40, color: kNavy),
            const SizedBox(height: 12),
            Text(_first == null ? 'Choose a ${AppLock.pinLength}-digit PIN' : 'Enter it again to confirm', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            const Text('It protects your loans if someone else picks up your phone. We never see it.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
            SizedBox(height: 24, child: _error == null ? null : Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13))),
            const SizedBox(height: 10),
            SizedBox(width: 300, child: _PinPad(value: _pin, onChanged: _changed)),
          ]),
        ),
      ),
    );
    if (widget.forced) return Material(color: Colors.white, child: body);
    return Scaffold(appBar: AppBar(backgroundColor: kNavy, foregroundColor: Colors.white, title: const Text('App PIN')), backgroundColor: Colors.white, body: body);
  }
}

// A row for the profile screen: set, change or remove the PIN
class AppLockRow extends StatelessWidget {
  const AppLockRow({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final mode = context.watch<AppSettings>().appLockMode;
    final lock = context.watch<AppLock>();
    if (mode == 'off') return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
      child: Row(children: [
        const Icon(Icons.pin_outlined, color: kNavy),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('App PIN', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
          Text(lock.pinSet ? 'On. Asked when you come back to the app.' : 'Off. Set one to protect your loans.', style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7280))),
        ])),
        if (lock.pinSet) ...[
          TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PinSetup())), child: const Text('Change')),
          if (mode != 'required') TextButton(onPressed: () => AppLock.instance.removePin(), child: const Text('Remove')),
        ] else
          ElevatedButton(
            style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10), textStyle: const TextStyle(fontSize: 14)),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PinSetup())),
            child: const Text('Set PIN'),
          ),
      ]),
    );
  }
}
