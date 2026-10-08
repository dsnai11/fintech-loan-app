import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/language_service.dart';
import 'tr_text.dart';

// Lets the customer choose the language of the app. `goHome` reopens the signed-in screens so they redraw in the new language.
Future<void> showLanguagePicker(BuildContext context, {bool goHome = false}) async {
  final svc = LanguageService.instance;
  final nav = Navigator.of(context);
  final picked = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(22, 20, 22, 8),
            child: Align(alignment: Alignment.centerLeft, child: Text('Choose your language', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF111827)))),
          ),
          for (final l in svc.available)
            ListTile(
              title: Text(l['native'] ?? '', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              subtitle: l['native'] == l['name'] ? null : Text(l['name'] ?? ''),
              trailing: l['code'] == svc.code ? const Icon(Icons.check_circle_rounded, color: kNavy) : null,
              onTap: () => Navigator.pop(ctx, l['code']),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (picked == null || picked == svc.code) return;
  await svc.setLanguage(picked);
  if (goHome) nav.pushNamedAndRemoveUntil('/home', (_) => false);
}

// A small button for the sign-in and sign-up screens. It redraws the screen because it listens to the language.
class LanguageChip extends StatelessWidget {
  const LanguageChip({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final svc = context.watch<LanguageService>();
    if (svc.available.length < 2) return const SizedBox.shrink();
    return GestureDetector(
      onTap: () => showLanguagePicker(context),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(color: Colors.white.withOpacity(0.18), borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.translate_rounded, size: 16, color: Colors.white),
          const SizedBox(width: 6),
          Text(svc.currentNative, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
        ]),
      ),
    );
  }
}

// A row for the profile screen
class LanguageRow extends StatelessWidget {
  const LanguageRow({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final svc = context.watch<LanguageService>();
    if (svc.available.length < 2) return const SizedBox.shrink();
    return GestureDetector(
      onTap: () => showLanguagePicker(context, goHome: true),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5E7EB))),
        child: Row(children: [
          const Icon(Icons.translate_rounded, color: kNavy),
          const SizedBox(width: 14),
          const Expanded(child: Text('Language', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF111827)))),
          Text(svc.currentNative, style: const TextStyle(fontSize: 14, color: Color(0xFF6B7280))),
          const SizedBox(width: 4),
          const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF)),
        ]),
      ),
    );
  }
}
