import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({Key? key}) : super(key: key);

  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  List<Map<String, dynamic>> _requests = [];
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    try {
      final d = await context.read<ApiService>().getDataRequests();
      setState(() {
        _requests = List<Map<String, dynamic>>.from(d['requests'] ?? []);
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  void _snack(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _viewData() async {
    setState(() => _busy = true);
    try {
      final data = await context.read<ApiService>().getMyData();
      if (!mounted) return;
      final pretty = const JsonEncoder.withIndent('  ').convert(data);
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Your data'),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: SelectableText(pretty, style: const TextStyle(fontSize: 11)),
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
        ),
      );
    } catch (e) {
      _snack(friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestDeletion() async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete my data'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'We will review your request. Your personal details are removed once all your loans are settled. '
              'Loan and payment records we must keep by law are kept in a restricted form.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLength: 300,
              decoration: const InputDecoration(labelText: 'Reason (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send request')),
        ],
      ),
    );
    final reason = controller.text;
    controller.dispose();
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    try {
      await context.read<ApiService>().requestDeletion(reason);
      _snack('Request sent');
      await _fetch();
    } catch (e) {
      _snack(friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'COMPLETED': return 'Completed';
      case 'REJECTED': return 'Declined';
      default: return 'In review';
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasOpen = _requests.any((r) => r['status'] == 'OPEN');
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('Privacy & my data'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Your information',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                const Text(
                  'You can see everything we hold about you, and ask us to delete your personal details.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF4B5563)),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _viewData,
                    icon: const Icon(Icons.description_outlined, size: 18),
                    label: const Text('View my data'),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: (_busy || hasOpen) ? null : _requestDeletion,
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: Text(hasOpen ? 'Deletion request in review' : 'Request data deletion'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_loading)
            const Center(child: CircularProgressIndicator(color: kNavy))
          else if (_requests.isNotEmpty) ...[
            const Text('Your requests', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            for (final r in _requests)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Row(
                  children: [
                    const Expanded(child: Text('Data deletion', style: TextStyle(fontWeight: FontWeight.w600))),
                    Text(_statusLabel(r['status']?.toString() ?? 'OPEN'),
                        style: const TextStyle(fontWeight: FontWeight.w700, color: kNavy)),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}
