import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';

// A row on the profile screen: confirm the email address with a code sent to it.
class EmailVerifyRow extends StatefulWidget {
  const EmailVerifyRow({Key? key}) : super(key: key);

  @override
  State<EmailVerifyRow> createState() => _EmailVerifyRowState();
}

class _EmailVerifyRowState extends State<EmailVerifyRow> {
  bool? _verified;
  bool _available = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.read<ApiService>().emailVerifyStatus();
      if (mounted) setState(() { _verified = r['verified'] == true; _available = r['available'] != false; });
    } catch (_) {}
  }

  Future<void> _open() async {
    final api = context.read<ApiService>();
    final messenger = ScaffoldMessenger.of(context);
    String? hint;
    try {
      final r = await api.sendEmailCode();
      if (r['alreadyVerified'] == true) { await _load(); return; }
      hint = r['sandboxCode']?.toString();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
      return;
    }
    if (!mounted) return;
    final controller = TextEditingController();
    String? error;
    bool busy = false;
    final done = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setLocal) {
        return AlertDialog(
          title: const Text('Enter the code'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('We sent a 6-digit code to your email address. It is valid for 10 minutes.'),
            if (hint != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Test mode: your code is $hint', style: const TextStyle(fontSize: 12, color: Color(0xFF92400E)))),
            const SizedBox(height: 10),
            TextField(controller: controller, keyboardType: TextInputType.number, maxLength: 6, autofocus: true, decoration: InputDecoration(counterText: '', hintText: '123456', errorText: error)),
          ]),
          actions: [
            TextButton(onPressed: busy ? null : () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: busy
                  ? null
                  : () async {
                      setLocal(() { busy = true; error = null; });
                      try {
                        await api.verifyEmailCode(controller.text.trim());
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        setLocal(() { busy = false; error = friendlyError(e); });
                      }
                    },
              child: Text(busy ? 'Checking...' : 'Verify'),
            ),
          ],
        );
      }),
    );
    controller.dispose();
    if (done == true) {
      messenger.showSnackBar(const SnackBar(content: Text('Your email is verified')));
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final verified = _verified;
    if (verified == null || !_available) return const SizedBox.shrink();
    return GestureDetector(
      onTap: verified ? null : _open,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: [
          Icon(verified ? Icons.mark_email_read_rounded : Icons.mark_email_unread_outlined, color: verified ? kGreen : kNavy),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Email address', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
              Text(verified ? 'Verified' : 'Not verified. Tap to verify with a code.', style: TextStyle(fontSize: 12, color: verified ? kGreen : const Color(0xFF92400E), fontWeight: FontWeight.w600)),
            ]),
          ),
          if (!verified) const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
