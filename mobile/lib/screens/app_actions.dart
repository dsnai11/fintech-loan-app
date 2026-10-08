import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/app_settings.dart';
import '../services/selected_product.dart';
import 'emi_calculator_screen.dart';
import 'help_screen.dart';
import 'loan_history_screen.dart';
import 'pan_verify_screen.dart';
import 'referral_screen.dart';
import 'support_screen.dart';

// What a banner or offer button does. The company chooses the action on the web portal. `onOpenTab` switches the
// bottom tabs (0 home, 1 offers, 2 my loans, 3 messages, 4 profile) when the caller is inside the tabbed app;
// without it the screen is opened on top instead.
Future<void> runAppAction(BuildContext context, String action, String url, {void Function(int tab)? onOpenTab}) async {
  final nav = Navigator.of(context);
  switch (action) {
    case 'apply':
      SelectedProduct.choose('personal', 'Personal Loan');
      nav.push(MaterialPageRoute(builder: (_) => const PanVerifyScreen()));
      break;
    case 'calculator':
      nav.push(MaterialPageRoute(builder: (_) => const EmiCalculatorScreen()));
      break;
    case 'loans':
      if (onOpenTab != null) {
        onOpenTab(2);
      } else {
        nav.push(MaterialPageRoute(builder: (_) => const LoanHistoryScreen()));
      }
      break;
    case 'messages':
      if (!context.read<AppSettings>().support) {
        nav.push(MaterialPageRoute(builder: (_) => const HelpScreen()));
      } else if (onOpenTab != null) {
        onOpenTab(3);
      } else {
        nav.push(MaterialPageRoute(builder: (_) => const SupportScreen()));
      }
      break;
    case 'help':
      nav.push(MaterialPageRoute(builder: (_) => const HelpScreen()));
      break;
    case 'referral':
      nav.push(MaterialPageRoute(builder: (_) => const ReferralScreen()));
      break;
    case 'url':
      final uri = Uri.tryParse(url);
      if (uri != null && uri.scheme == 'https') {
        try {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } catch (_) {}
      }
      break;
  }
}
