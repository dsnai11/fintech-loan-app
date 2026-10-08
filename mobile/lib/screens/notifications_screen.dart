import 'package:flutter/material.dart' hide Text;
import '../widgets/tr_text.dart';
import 'offers_screen.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';

class NotificationBell extends StatefulWidget {
  const NotificationBell({Key? key}) : super(key: key);

  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell> {
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final data = await context.read<ApiService>().getNotifications();
      if (mounted) setState(() => _unread = (data['unread'] as num?)?.toInt() ?? 0);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const NotificationsScreen()),
        );
        _refresh();
      },
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.notifications_rounded, color: Colors.white, size: 20),
          ),
          if (_unread > 0)
            Positioned(
              right: -4,
              top: -4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: const Color(0xFFF59E0B),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(_unread > 99 ? '99+' : '$_unread',
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
              ),
            ),
        ],
      ),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({Key? key}) : super(key: key);

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await context.read<ApiService>().getNotifications();
      setState(() {
        _items = List<Map<String, dynamic>>.from(data['notifications'] ?? []);
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = friendlyError(e); _loading = false; });
    }
  }

  Future<void> _markAllRead() async {
    try {
      await context.read<ApiService>().markAllNotificationsRead();
      await _fetch();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<void> _open(Map<String, dynamic> n) async {
    // An offer notification opens that offer
    if (n['type'] == 'OFFER') {
      final id = (n['data'] is Map) ? '${(n['data'] as Map)['offerId'] ?? ''}' : '';
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => OffersScreen(openOfferId: id)));
    }
    if (n['read'] == true) return;
    setState(() => n['read'] = true);
    try {
      await context.read<ApiService>().markNotificationRead(n['_id'].toString());
    } catch (_) {}
  }

  IconData _icon(String type) {
    switch (type) {
      case 'LOAN_APPROVED': return Icons.check_circle_rounded;
      case 'LOAN_REJECTED': return Icons.cancel_rounded;
      case 'LOAN_DISBURSED': return Icons.account_balance_wallet_rounded;
      case 'EMI_PAID': return Icons.receipt_long_rounded;
      case 'EMI_REMINDER': return Icons.alarm_rounded;
      case 'EMI_OVERDUE': return Icons.warning_amber_rounded;
      case 'LOAN_CLOSED': return Icons.verified_rounded;
      case 'OFFER': return Icons.local_offer_rounded;
      default: return Icons.notifications_rounded;
    }
  }

  Color _color(String type) {
    switch (type) {
      case 'LOAN_REJECTED':
      case 'EMI_OVERDUE':
        return const Color(0xFFEF4444);
      case 'EMI_REMINDER':
        return const Color(0xFFF59E0B);
      default:
        return kGreen;
    }
  }

  String _ago(dynamic iso) {
    try {
      final d = DateTime.now().difference(DateTime.parse(iso.toString()).toLocal());
      if (d.inMinutes < 1) return 'just now';
      if (d.inMinutes < 60) return '${d.inMinutes}m ago';
      if (d.inHours < 24) return '${d.inHours}h ago';
      return '${d.inDays}d ago';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: _items.any((n) => n['read'] != true) ? _markAllRead : null,
            child: const Text('Mark all read', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: kNavy))
          : _error != null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(_error!, textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    ElevatedButton(onPressed: _fetch, child: const Text('Retry')),
                  ]),
                )
              : _items.isEmpty
                  ? const Center(
                      child: Text('No notifications yet', style: TextStyle(color: Color(0xFF6B7280))),
                    )
                  : RefreshIndicator(
                      onRefresh: _fetch,
                      color: kNavy,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        itemBuilder: (_, i) {
                          final n = _items[i];
                          final unread = n['read'] != true;
                          final type = n['type']?.toString() ?? '';
                          return GestureDetector(
                            onTap: () => _open(n),
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 10),
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                border: unread ? Border.all(color: _color(type).withOpacity(0.5)) : null,
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(_icon(type), color: _color(type), size: 24),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(children: [
                                          Expanded(
                                            child: Text(n['title']?.toString() ?? '',
                                                style: TextStyle(
                                                    fontWeight: unread ? FontWeight.w800 : FontWeight.w600,
                                                    fontSize: 14)),
                                          ),
                                          Text(_ago(n['createdAt']),
                                              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                                        ]),
                                        const SizedBox(height: 4),
                                        Text(n['message']?.toString() ?? '',
                                            style: const TextStyle(fontSize: 13, color: Color(0xFF4B5563))),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
