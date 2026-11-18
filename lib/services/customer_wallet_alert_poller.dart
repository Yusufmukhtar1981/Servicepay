import 'dart:async';

import 'package:flutter/widgets.dart';

import 'customer_notification_settings.dart';

typedef WalletAlertHandler = Future<void> Function(
  WalletCreditAlert alert,
  CustomerNotificationSettings settings,
);

class CustomerWalletAlertPoller with WidgetsBindingObserver {
  CustomerWalletAlertPoller({
    required this.api,
    required this.onAlert,
    this.isSessionValid,
    this.isRouteVisible,
    this.onRouteVisible,
    this.minimumInterval = const Duration(seconds: 20),
  });

  final CustomerNotificationSettingsApi api;
  final WalletAlertHandler onAlert;
  final Future<bool> Function()? isSessionValid;
  final bool Function()? isRouteVisible;
  final Future<void> Function()? onRouteVisible;
  final Duration minimumInterval;
  Timer? _timer;
  bool _running = false;
  bool _disposed = false;
  bool _foreground = false;
  bool _inFlight = false;
  bool _resumePending = false;
  int _generation = 0;
  int _failures = 0;

  bool get isRunning => _running;

  void start() {
    if (_disposed || _running) return;
    _running = true;
    _generation++;
    WidgetsBinding.instance.addObserver(this);
    _foreground =
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    if (_foreground) _schedule(Duration.zero, _generation);
  }

  void stop() {
    if (!_running) return;
    _running = false;
    _foreground = false;
    _resumePending = false;
    _generation++;
    _timer?.cancel();
    _timer = null;
    WidgetsBinding.instance.removeObserver(this);
  }

  void _schedule(Duration delay, int generation) {
    _timer?.cancel();
    if (!_running || _disposed || !_foreground) return;
    if (_inFlight) {
      _resumePending = true;
      return;
    }
    _timer = Timer(delay, () => _poll(generation));
  }

  Future<void> _poll(int generation) async {
    if (!_running ||
        _disposed ||
        !_foreground ||
        _inFlight ||
        generation != _generation) {
      return;
    }
    _inFlight = true;
    var routeHidden = false;
    try {
      if (isRouteVisible != null && !isRouteVisible!()) {
        routeHidden = true;
        return;
      }
      if (onRouteVisible != null) await onRouteVisible!();
      if (!_running || _disposed || generation != _generation) return;
      if (isRouteVisible != null && !isRouteVisible!()) {
        routeHidden = true;
        return;
      }
      if (isSessionValid != null && !await isSessionValid!()) {
        stop();
        return;
      }
      final handoff = await api.claimNextHandoff();
      if (!_running || _disposed || generation != _generation) return;
      if (isSessionValid != null && !await isSessionValid!()) {
        stop();
        return;
      }
      _failures = 0;
      if (handoff.alert != null) {
        await onAlert(handoff.alert!, handoff.settings);
      }
    } catch (_) {
      if (!_running || _disposed || generation != _generation) return;
      _failures = (_failures + 1).clamp(1, 6).toInt();
    } finally {
      _inFlight = false;
      if (_running && !_disposed && _foreground) {
        if (_resumePending || generation != _generation) {
          _resumePending = false;
          _schedule(Duration.zero, _generation);
        } else if (routeHidden) {
          _schedule(minimumInterval, generation);
        } else {
          final multiplier = 1 << _failures;
          final backoff = minimumInterval * multiplier;
          _schedule(
              backoff > const Duration(minutes: 3)
                  ? const Duration(minutes: 3)
                  : backoff,
              generation);
        }
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (!_running || _disposed) return;
      _foreground = true;
      if (_inFlight) {
        _resumePending = true;
      } else {
        _generation++;
        _schedule(Duration.zero, _generation);
      }
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      _foreground = false;
      _timer?.cancel();
      _timer = null;
      _generation++;
    }
  }

  void dispose() {
    stop();
    _disposed = true;
  }
}
