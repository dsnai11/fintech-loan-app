import 'dart:async';
import 'package:flutter/widgets.dart';
import 'api_service.dart';

// While the customer has the app open, checks now and then for new notifications and tells the app, so a new offer or
// payment alert shows up as a banner straight away instead of waiting for them to open the bell. It stops when the app
// goes to the background (phone notifications cover that case once they are set up) and starts again on return.
class NotificationWatcher with WidgetsBindingObserver {
  static final NotificationWatcher instance = NotificationWatcher._();
  NotificationWatcher._();

  static const _every = Duration(seconds: 45);

  // How many unread notifications there are; the bell listens to this
  final ValueNotifier<int> unread = ValueNotifier<int>(0);

  ApiService? _api;
  void Function(Map<String, dynamic> newest, int count)? _onNew;
  Timer? _timer;
  String? _newestSeen; // the newest notification we have already known about
  bool _started = false;

  void start(ApiService api, void Function(Map<String, dynamic> newest, int count) onNew) {
    _api = api;
    _onNew = onNew;
    if (_started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    _poll(first: true);
    _timer = Timer.periodic(_every, (_) => _poll());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    if (_started) WidgetsBinding.instance.removeObserver(this);
    _started = false;
    _newestSeen = null;
    _onNew = null;
  }

  // Lets the bell and the list screen tell us they refreshed, so the number stays right
  void setUnread(int n) => unread.value = n;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_started) return;
    if (state == AppLifecycleState.resumed) {
      _poll();
      _timer ??= Timer.periodic(_every, (_) => _poll());
    } else if (state == AppLifecycleState.paused) {
      _timer?.cancel();
      _timer = null;
    }
  }

  Future<void> _poll({bool first = false}) async {
    final api = _api;
    if (api == null) return;
    try {
      final d = await api.getNotifications();
      unread.value = (d['unread'] as num?)?.toInt() ?? 0;
      final list = ((d['notifications'] as List?) ?? []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList(); // newest first
      if (list.isEmpty) return;
      final newest = '${list.first['_id']}';
      if (first || _newestSeen == null) {
        _newestSeen = newest; // what is already there is not "new"
        return;
      }
      final fresh = <Map<String, dynamic>>[];
      for (final n in list) {
        if ('${n['_id']}' == _newestSeen) break;
        if (n['read'] != true) fresh.add(n);
      }
      _newestSeen = newest;
      if (fresh.isNotEmpty) _onNew?.call(fresh.first, fresh.length);
    } catch (_) {} // offline or signed out: try again next time
  }
}
