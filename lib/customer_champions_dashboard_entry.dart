import 'package:flutter/material.dart';

import 'customer_leaderboard_screen.dart';
import 'customer_leaderboard_report_panel.dart';
import 'services/customer_leaderboard_api.dart';

class CustomerChampionsDashboardEntry extends StatefulWidget {
  const CustomerChampionsDashboardEntry({
    super.key,
    this.refreshVersion = 0,
    this.api,
  });

  final int refreshVersion;
  final CustomerLeaderboardApi? api;

  @override
  State<CustomerChampionsDashboardEntry> createState() =>
      _CustomerChampionsDashboardEntryState();
}

class _CustomerChampionsDashboardEntryState
    extends State<CustomerChampionsDashboardEntry> with WidgetsBindingObserver {
  late final CustomerLeaderboardApi _api;
  bool _loading = true;
  bool _enabled = false;
  bool _hasError = false;
  CustomerLeaderboardReport? _report;
  int _requestVersion = 0;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? CustomerLeaderboardApi();
    WidgetsBinding.instance.addObserver(this);
    _check();
  }

  @override
  void didUpdateWidget(covariant CustomerChampionsDashboardEntry oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshVersion != widget.refreshVersion) _check();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  String _monthKey() {
    final now = DateTime.now().toUtc().add(const Duration(hours: 1));
    return '${now.year}-${now.month.toString().padLeft(2, '0')}';
  }

  Future<void> _check() async {
    final requestVersion = ++_requestVersion;
    final month = _monthKey();
    if (mounted) {
      setState(() {
        _loading = true;
        _hasError = false;
      });
    }
    try {
      final report = await _api.load(month);
      if (mounted && requestVersion == _requestVersion) {
        setState(() {
          _enabled = report.enabled;
          _report = report;
          _loading = false;
          _hasError = false;
        });
      }
    } catch (_) {
      if (mounted && requestVersion == _requestVersion) {
        setState(() {
          _loading = false;
          _hasError = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Semantics(
          label: 'Checking monthly Champions availability',
          child: LinearProgressIndicator(
            semanticsLabel: 'Checking monthly Champions availability',
            color: const Color(0xFF08783E),
          ),
        ),
      );
    }
    if (!_enabled && !_hasError) return const SizedBox.shrink();
    if (_hasError) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Semantics(
          liveRegion: true,
          label: 'Champions report could not be loaded. Retry.',
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFFF5EDE2),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Expanded(
                  child: Text(
                    'Champions is temporarily unavailable.',
                    style: TextStyle(color: Color(0xFF634F38), fontSize: 12),
                  ),
                ),
                TextButton(
                  onPressed: _check,
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final report = _report;
    if (report == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF4EC),
          borderRadius: BorderRadius.circular(19),
          border: Border.all(color: const Color(0xFFD5E7D9)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: const Color(0xFF18382F),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: const Icon(Icons.emoji_events_rounded,
                      color: Color(0xFFF0C76A)),
                ),
                const SizedBox(width: 11),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('SERVICEPAY CHAMPIONS',
                          style: TextStyle(
                              color: Color(0xFF18382F),
                              fontWeight: FontWeight.w900,
                              fontSize: 12,
                              letterSpacing: .6)),
                      SizedBox(height: 3),
                      Text('Monthly activity, recognised privately.',
                          style: TextStyle(
                              color: Color(0xFF5D7065), fontSize: 11)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 7),
            const Text(
              'A clear record of everyday service use. No rewards; customer names stay masked.',
              style: TextStyle(
                  color: Color(0xFF526A5D), fontSize: 11, height: 1.4),
            ),
            const SizedBox(height: 13),
            CustomerLeaderboardReportPanel(
              report: report,
              compact: true,
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const CustomerLeaderboardScreen(),
                  ),
                ),
                icon: const Icon(Icons.open_in_new_rounded, size: 17),
                label: const Text('Open full monthly report'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
