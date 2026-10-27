import 'package:flutter/material.dart';
import 'customer_leaderboard_report_panel.dart';
import 'services/customer_leaderboard_api.dart';

class CustomerLeaderboardScreen extends StatefulWidget {
  const CustomerLeaderboardScreen({super.key, this.api});
  final CustomerLeaderboardApi? api;

  @override
  State<CustomerLeaderboardScreen> createState() =>
      _CustomerLeaderboardScreenState();
}

class _CustomerLeaderboardScreenState extends State<CustomerLeaderboardScreen> {
  late final CustomerLeaderboardApi _api;
  CustomerLeaderboardReport? _report;
  bool _loading = true;
  String? _error;
  DateTime _month = DateTime.now().toUtc().add(const Duration(hours: 1));
  static const ink = Color(0xFF18382F);
  static const green = Color(0xFF08783E);

  String get _monthKey =>
      '${_month.year}-${_month.month.toString().padLeft(2, '0')}';
  @override
  void initState() {
    super.initState();
    _api = widget.api ?? CustomerLeaderboardApi();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final value = await _api.load(_monthKey);
      if (mounted) {
        setState(() {
          _report = value;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('FormatException: ', '');
          _loading = false;
        });
      }
    }
  }

  Future<void> _stepMonth(int step) async {
    final lagosNow = DateTime.now().toUtc().add(const Duration(hours: 1));
    final next = DateTime(_month.year, _month.month + step);
    if (next.year < 2010 ||
        next.isAfter(DateTime(lagosNow.year, lagosNow.month))) {
      return;
    }
    setState(() => _month = next);
    await _load();
  }

  String _monthTitle(DateTime value) {
    const months = <String>[
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return '${months[value.month - 1]} ${value.year}';
  }

  @override
  Widget build(BuildContext context) {
    final report = _report;
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F3),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF4F7F3),
        foregroundColor: ink,
        elevation: 0,
        title: const Text('SERVICEPAY CHAMPIONS',
            style: TextStyle(
                fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: .8)),
        actions: [
          IconButton(
              tooltip: 'Refresh report',
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded))
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 30),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: ink,
                borderRadius: BorderRadius.circular(22),
                gradient: const LinearGradient(
                    colors: [Color(0xFF18382F), Color(0xFF235A43)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight),
              ),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.emoji_events_rounded,
                        color: Color(0xFFF0C76A), size: 30),
                    const SizedBox(height: 12),
                    const Text('Everyday activity, recognised.',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    Text(
                        'A private, monthly view of real completed services. No rewards. No identities.',
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: .78),
                            height: 1.45)),
                    const SizedBox(height: 18),
                    Row(children: [
                      IconButton(
                          onPressed: () => _stepMonth(-1),
                          color: Colors.white,
                          tooltip: 'Previous month',
                          icon: const Icon(Icons.chevron_left)),
                      Expanded(
                          child: Center(
                              child: Text(_monthTitle(_month),
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700)))),
                      IconButton(
                          onPressed: _month.year ==
                                      DateTime.now()
                                          .toUtc()
                                          .add(const Duration(hours: 1))
                                          .year &&
                                  _month.month ==
                                      DateTime.now()
                                          .toUtc()
                                          .add(const Duration(hours: 1))
                                          .month
                              ? null
                              : () => _stepMonth(1),
                          color: Colors.white,
                          tooltip: 'Next month',
                          icon: const Icon(Icons.chevron_right)),
                    ]),
                    const Text('MONTHLY PERIOD · LAGOS',
                        style: TextStyle(
                            color: Color(0xFFB9D5C2),
                            fontSize: 10,
                            letterSpacing: 1.3,
                            fontWeight: FontWeight.w800)),
                  ]),
            ),
            const SizedBox(height: 16),
            if (_loading) ...[
              const LinearProgressIndicator(
                color: green,
                semanticsLabel: 'Loading monthly Champions report',
              ),
              const SizedBox(height: 12),
              for (var i = 0; i < 4; i++)
                Container(
                    height: 66,
                    margin: const EdgeInsets.only(bottom: 9),
                    decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(15))),
            ] else if (_error != null)
              _message(Icons.cloud_off_outlined, 'Could not load this month',
                  _error!,
                  onRetry: _load)
            else if (report == null || !report.enabled)
              _message(
                  Icons.hourglass_empty_rounded,
                  'Champions is taking a pause',
                  'The monthly report is not available right now.')
            else ...[
              CustomerLeaderboardReportPanel(
                report: report,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _message(IconData icon, String title, String body,
          {Future<void> Function()? onRetry}) =>
      Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(18)),
        child: Column(children: [
          Icon(icon, color: green, size: 30),
          const SizedBox(height: 10),
          Text(title,
              style: const TextStyle(color: ink, fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          Text(body,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF718178))),
          if (onRetry != null)
            TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'))
        ]),
      );
}
