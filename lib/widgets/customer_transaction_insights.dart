import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../customer_transaction_insights.dart';
import '../services/customer_insights_service.dart';
import 'customer_dashboard_visibility.dart';
import 'customer_dashboard_visuals.dart';

part 'customer_transaction_insights_chart.dart';

typedef CustomerInsightsLoader = Future<CustomerTransactionInsights> Function(
    CustomerInsightsPeriod period);

const List<String> _weekdays = <String>[
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun'
];
const List<String> _months = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String insightMoney(double value) {
  final String fixed = value.abs().toStringAsFixed(2);
  final List<String> parts = fixed.split('.');
  final String whole = parts.first;
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < whole.length; i++) {
    final int remaining = whole.length - i;
    out.write(whole[i]);
    if (remaining > 1 && remaining % 3 == 1) out.write(',');
  }
  return '${value < 0 ? '-' : ''}₦$out.${parts.last}';
}

String _two(int v) => v.toString().padLeft(2, '0');
String _day(DateTime d) =>
    '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]} ${d.year}';
String _dayShort(DateTime d) => '${d.day} ${_months[d.month - 1]}';
String _time(DateTime d) => '${_two(d.hour)}:${_two(d.minute)}';
String _dateTime(DateTime d) => '${_day(d)}, ${_time(d)}';

String _count(int n, String noun) => '$n $noun${n == 1 ? '' : 's'}';

/// Read-only Customer insights. It never settles, requeries or changes any
/// transaction, and it never derives totals from the five recent-activity rows.
class CustomerTransactionInsightsSection extends StatefulWidget {
  const CustomerTransactionInsightsSection({
    super.key,
    this.client,
    this.loader,
    this.refreshVersion = 0,
    this.onOpenHistory,
  });

  final http.Client? client;
  final CustomerInsightsLoader? loader;
  final int refreshVersion;
  final VoidCallback? onOpenHistory;

  @override
  State<CustomerTransactionInsightsSection> createState() =>
      _CustomerTransactionInsightsSectionState();
}

class _CustomerTransactionInsightsSectionState
    extends State<CustomerTransactionInsightsSection>
    with WidgetsBindingObserver {
  CustomerInsightsPeriod _period = CustomerInsightsPeriod.weekly;
  bool _showValue = false;
  CustomerTransactionInsights? _data;
  String? _error;
  bool _loading = false;
  int _generation = 0;
  bool _tabVisible = false;
  bool _wasActive = false;
  int? _selected;
  static const int _declinedInitial = 3;
  static const int _declinedPage = 10;
  int _declinedShown = _declinedInitial;

  bool get _appResumed {
    final state = WidgetsBinding.instance.lifecycleState;
    return state == null || state == AppLifecycleState.resumed;
  }

  bool get _active => mounted && _tabVisible && _appResumed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool visible = CustomerDashboardVisibility.of(context) &&
        (ModalRoute.of(context)?.isCurrent ?? true);
    if (visible != _tabVisible) {
      _tabVisible = visible;
      _syncActivity();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _syncActivity();
  }

  @override
  void didUpdateWidget(covariant CustomerTransactionInsightsSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshVersion != widget.refreshVersion && _active) {
      scheduleMicrotask(() {
        if (_active) _load();
      });
    }
  }

  void _syncActivity() {
    if (_active && !_wasActive) {
      _wasActive = true;
      scheduleMicrotask(() {
        if (_active) _load();
      });
    } else if (!_active && _wasActive) {
      _wasActive = false;
      // Any in-flight response is now stale; a fresh load runs on return.
      _generation++;
    }
  }

  @override
  void dispose() {
    _generation++;
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _load() async {
    final int generation = ++_generation;
    final CustomerInsightsPeriod period = _period;
    setState(() {
      _loading = true;
      _data = null;
      _error = null;
      _selected = null;
      _declinedShown = _declinedInitial;
    });
    try {
      final loader =
          widget.loader ?? CustomerInsightsService(client: widget.client).load;
      final result = await loader(period);
      if (!mounted || generation != _generation) return;
      setState(() {
        _data = result;
        _loading = false;
        _selected = result.buckets.isEmpty ? null : result.buckets.length - 1;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _data = null;
        _loading = false;
        _error = error is StateError
            ? error.message
            : 'Transaction insights could not be loaded. No partial totals are shown. Please retry.';
      });
    }
  }

  void _setPeriod(CustomerInsightsPeriod period) {
    if (period == _period) return;
    _period = period;
    if (_active) {
      _load();
    } else {
      setState(() => _data = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('customer-transaction-insights'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      decoration: BoxDecoration(
        color: CustomerDashboardPalette.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerDashboardPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Semantics(
            header: true,
            child: const Text(
              'My Transaction Insights',
              style: TextStyle(
                color: CustomerDashboardPalette.text,
                fontSize: 19,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: 3),
          const Text(
            'Track your transaction performance and growth.',
            style: TextStyle(
                color: CustomerDashboardPalette.muted,
                fontSize: 14,
                height: 1.3),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              _Toggle(
                key: const Key('insights-period-weekly'),
                label: 'Weekly',
                selected: _period == CustomerInsightsPeriod.weekly,
                onTap: () => _setPeriod(CustomerInsightsPeriod.weekly),
              ),
              _Toggle(
                key: const Key('insights-period-monthly'),
                label: 'Monthly',
                selected: _period == CustomerInsightsPeriod.monthly,
                onTap: () => _setPeriod(CustomerInsightsPeriod.monthly),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (_loading || (_data == null && _error == null))
            const _InsightsSkeleton()
          else if (_error != null)
            _ErrorState(message: _error!, onRetry: _active ? _load : null)
          else
            _buildLoaded(_data!),
          if (widget.onOpenHistory != null) ...<Widget>[
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const Key('insights-open-history'),
                onPressed: widget.onOpenHistory,
                style: TextButton.styleFrom(
                  foregroundColor: CustomerDashboardPalette.royalBlue,
                  minimumSize: const Size(0, 44),
                ),
                icon: const Icon(Icons.receipt_long_rounded, size: 18),
                label: const Text('Open Transaction History',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildLoaded(CustomerTransactionInsights data) {
    final window = data.window;
    final bool weekly = window.period == CustomerInsightsPeriod.weekly;
    final current = data.current;
    final String periodName = weekly ? 'this week' : 'this month';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          '${weekly ? 'Week to date' : 'Month to date'}: ${_dateTime(window.start)} to ${_dateTime(window.end)}',
          key: const Key('insights-window'),
          style: const TextStyle(
              color: CustomerDashboardPalette.text,
              fontSize: 14,
              fontWeight: FontWeight.w600,
              height: 1.3),
        ),
        const SizedBox(height: 2),
        Text(
          'Updated ${_time(window.end)}. Pull down to refresh.',
          style: const TextStyle(
              color: CustomerDashboardPalette.muted, fontSize: 13),
        ),
        const SizedBox(height: 14),
        if (current.totalCount == 0)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _Note(
              key: const Key('insights-empty'),
              icon: Icons.inbox_outlined,
              text:
                  'No transactions recorded $periodName yet. Your figures will appear here after your first transaction.',
            ),
          ),
        _MetricsGrid(totals: current),
        const SizedBox(height: 8),
        Text(
          'Values are the recorded amounts of your incoming and outgoing transactions, not your net wallet change.'
          '${current.otherCount > 0 ? ' ${_count(current.otherCount, 'transaction')} with another status (for example reversed) ${current.otherCount == 1 ? 'is' : 'are'} included in the total only.' : ''}',
          style: const TextStyle(
              color: CustomerDashboardPalette.muted,
              fontSize: 13,
              height: 1.35),
        ),
        const SizedBox(height: 18),
        _SectionTitle('Daily activity'),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            _Toggle(
              key: const Key('insights-mode-count'),
              label: 'Count',
              selected: !_showValue,
              onTap: () => setState(() => _showValue = false),
            ),
            _Toggle(
              key: const Key('insights-mode-value'),
              label: 'Value',
              selected: _showValue,
              onTap: () => setState(() => _showValue = true),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _InsightsChart(
          buckets: data.buckets,
          showValue: _showValue,
          weekly: weekly,
          selected: _selected,
          onSelect: (index) => setState(() => _selected = index),
        ),
        if (_selected != null && _selected! < data.buckets.length) ...<Widget>[
          const SizedBox(height: 10),
          _SelectedDay(
            bucket: data.buckets[_selected!],
            canPrevious: _selected! > 0,
            canNext: _selected! < data.buckets.length - 1,
            onPrevious: () => setState(() => _selected = _selected! - 1),
            onNext: () => setState(() => _selected = _selected! + 1),
          ),
        ],
        const SizedBox(height: 18),
        _SectionTitle(
            weekly ? 'Compared with last week' : 'Compared with last month'),
        const SizedBox(height: 4),
        Text(
          'Same elapsed time: ${_dateTime(window.previousStart)} to '
          '${window.previousCapped ? 'the end of ${_day(window.previousEnd.subtract(const Duration(days: 1)))}' : _dateTime(window.previousEnd)}.'
          '${window.previousCapped ? ' Last month was shorter, so the comparison stops at its last day.' : ''}',
          key: const Key('insights-previous-window'),
          style: const TextStyle(
              color: CustomerDashboardPalette.muted,
              fontSize: 13,
              height: 1.35),
        ),
        const SizedBox(height: 10),
        _GrowthRow(
            label: 'Transaction count', growth: data.countGrowth, money: false),
        _GrowthRow(
            label: 'Transaction value', growth: data.valueGrowth, money: true),
        _GrowthRow(
            label: 'Successful transactions',
            growth: data.successfulGrowth,
            money: false),
        _GrowthRow(
            label: 'Declined transactions',
            growth: data.declinedGrowth,
            money: false),
        const SizedBox(height: 18),
        _SectionTitle('Declined transactions'),
        const SizedBox(height: 4),
        Text(
          '${_count(current.declinedCount, 'declined transaction')} totalling ${insightMoney(current.declinedValue)} $periodName.',
          style: const TextStyle(
              color: CustomerDashboardPalette.muted,
              fontSize: 13,
              height: 1.35),
        ),
        const SizedBox(height: 8),
        if (data.declined.isEmpty)
          const _Note(
            key: Key('insights-no-declined'),
            icon: Icons.check_circle_outline_rounded,
            text: 'No declined transactions in this period.',
          )
        else ...<Widget>[
          for (final item in data.declined.take(_declinedShown))
            _DeclinedTile(item: item, onTap: () => _openDeclined(item)),
          Wrap(
            spacing: 8,
            children: <Widget>[
              if (data.declined.length > _declinedShown)
                TextButton(
                  key: const Key('insights-declined-more'),
                  onPressed: () =>
                      setState(() => _declinedShown += _declinedPage),
                  style: TextButton.styleFrom(
                    foregroundColor: CustomerDashboardPalette.royalBlue,
                    minimumSize: const Size(0, 44),
                  ),
                  child: Text(
                    'Show ${math.min(_declinedPage, data.declined.length - _declinedShown)} more '
                    '(${math.min(_declinedShown, data.declined.length)} of ${data.declined.length} shown)',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              if (_declinedShown > _declinedInitial)
                TextButton(
                  key: const Key('insights-declined-fewer'),
                  onPressed: () =>
                      setState(() => _declinedShown = _declinedInitial),
                  style: TextButton.styleFrom(
                    foregroundColor: CustomerDashboardPalette.royalBlue,
                    minimumSize: const Size(0, 44),
                  ),
                  child: const Text('Show fewer',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                ),
            ],
          ),
        ],
      ],
    );
  }

  void _openDeclined(InsightTransaction item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: CustomerDashboardPalette.card,
      builder: (context) => DeclinedTransactionDetailSheet(item: item),
    );
  }
}

/// Read-only projection of safe fields only. No provider maps, no requery.
class DeclinedTransactionDetailSheet extends StatelessWidget {
  const DeclinedTransactionDetailSheet({super.key, required this.item});

  final InsightTransaction item;

  @override
  Widget build(BuildContext context) {
    Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(label,
                  style: const TextStyle(
                      color: CustomerDashboardPalette.muted,
                      fontSize: 13,
                      fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              SelectableText(value,
                  style: const TextStyle(
                      color: CustomerDashboardPalette.text,
                      fontSize: 15,
                      height: 1.35)),
            ],
          ),
        );
    return SafeArea(
      child: SingleChildScrollView(
        key: const Key('insights-declined-detail'),
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Declined transaction',
                style: TextStyle(
                    color: CustomerDashboardPalette.text,
                    fontSize: 20,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const Text('Read-only details. No money moves from this view.',
                style: TextStyle(
                    color: CustomerDashboardPalette.muted, fontSize: 13)),
            const SizedBox(height: 16),
            row('Transaction', item.type),
            row('Amount', insightMoney(item.amount)),
            row('Status', 'Declined'),
            row('Date and time', _dateTime(item.date)),
            row('Reference',
                item.reference.isEmpty ? 'Not supplied' : item.reference),
            row('Reason', item.declineReason),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => Navigator.of(context).pop(),
                style: TextButton.styleFrom(
                  foregroundColor: CustomerDashboardPalette.royalBlue,
                  minimumSize: const Size(0, 44),
                ),
                child: const Text('Close',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Semantics(
        header: true,
        child: Text(text,
            style: const TextStyle(
                color: CustomerDashboardPalette.text,
                fontSize: 16,
                fontWeight: FontWeight.w700)),
      );
}

class _Toggle extends StatelessWidget {
  const _Toggle(
      {super.key,
      required this.label,
      required this.selected,
      required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Container(
          constraints: const BoxConstraints(minHeight: 44, minWidth: 64),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected
                ? CustomerDashboardPalette.royalBlue
                : CustomerDashboardPalette.paleBlue,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
                color: selected
                    ? CustomerDashboardPalette.royalBlue
                    : CustomerDashboardPalette.border),
          ),
          child: Text(label,
              style: TextStyle(
                color: selected
                    ? CustomerDashboardPalette.navy
                    : CustomerDashboardPalette.text,
                fontWeight: FontWeight.w700,
                fontSize: 14,
              )),
        ),
      ),
    );
  }
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({required this.totals});
  final InsightTotals totals;

  @override
  Widget build(BuildContext context) {
    final metrics = <(String, String, Color, Key)>[
      (
        'Total transactions',
        '${totals.totalCount}',
        CustomerDashboardPalette.text,
        const Key('metric-total')
      ),
      (
        'Successful',
        '${totals.successfulCount}',
        CustomerDashboardPalette.success,
        const Key('metric-successful')
      ),
      (
        'Declined',
        '${totals.declinedCount}',
        CustomerDashboardPalette.error,
        const Key('metric-declined')
      ),
      (
        'Pending or processing',
        '${totals.pendingCount}',
        CustomerDashboardPalette.warning,
        const Key('metric-pending')
      ),
      (
        'Total value',
        insightMoney(totals.totalValue),
        CustomerDashboardPalette.text,
        const Key('metric-total-value')
      ),
      (
        'Successful value',
        insightMoney(totals.successfulValue),
        CustomerDashboardPalette.success,
        const Key('metric-successful-value')
      ),
      (
        'Declined value',
        insightMoney(totals.declinedValue),
        CustomerDashboardPalette.error,
        const Key('metric-declined-value')
      ),
    ];
    return LayoutBuilder(builder: (context, constraints) {
      final double scale = MediaQuery.textScalerOf(context).scale(1);
      final int columns = constraints.maxWidth >= 560
          ? 4
          : (scale > 1.5 && constraints.maxWidth < 420 ? 1 : 2);
      const double gap = 8;
      final double width =
          (constraints.maxWidth - gap * (columns - 1)) / columns;
      return Wrap(
        spacing: gap,
        runSpacing: gap,
        children: <Widget>[
          for (final m in metrics)
            Semantics(
              container: true,
              label: '${m.$1}: ${m.$2}',
              excludeSemantics: true,
              child: Container(
                key: m.$4,
                width: width,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: CustomerDashboardPalette.paleBlue,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(m.$1,
                        style: const TextStyle(
                            color: CustomerDashboardPalette.muted,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(m.$2,
                        style: TextStyle(
                            color: m.$3,
                            fontSize: 17,
                            fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ),
        ],
      );
    });
  }
}

class _GrowthRow extends StatelessWidget {
  const _GrowthRow(
      {required this.label, required this.growth, required this.money});
  final String label;
  final InsightGrowth growth;
  final bool money;

  String _v(double v) => money ? insightMoney(v) : v.round().toString();

  @override
  Widget build(BuildContext context) {
    final double? percent = growth.percent;
    final String change;
    IconData icon = Icons.horizontal_rule_rounded;
    if (percent == null) {
      change = growth.current == 0
          ? 'No activity in either period'
          : 'No previous-period activity to compare';
    } else if (percent.abs() < 0.05) {
      change = 'No change';
    } else {
      icon = percent > 0
          ? Icons.arrow_upward_rounded
          : Icons.arrow_downward_rounded;
      change =
          '${percent > 0 ? 'Up' : 'Down'} ${percent.abs().toStringAsFixed(1)}%';
    }
    return Semantics(
      container: true,
      label:
          '$label: $change. Now ${_v(growth.current)}, previously ${_v(growth.previous)}.',
      excludeSemantics: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: CustomerDashboardPalette.border),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, color: CustomerDashboardPalette.royalBlue, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(label,
                      style: const TextStyle(
                          color: CustomerDashboardPalette.muted,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(change,
                      style: const TextStyle(
                          color: CustomerDashboardPalette.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  Text(
                      'Now ${_v(growth.current)}, previously ${_v(growth.previous)}',
                      style: const TextStyle(
                          color: CustomerDashboardPalette.muted, fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeclinedTile extends StatelessWidget {
  const _DeclinedTile({required this.item, required this.onTap});
  final InsightTransaction item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        button: true,
        label:
            'Declined ${item.type}, ${insightMoney(item.amount)}, ${_dateTime(item.date)}. Open details.',
        excludeSemantics: true,
        child: InkWell(
          key: Key('insights-declined-${item.id}'),
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Ink(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: CustomerDashboardPalette.paleBlue,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: <Widget>[
                const Icon(Icons.cancel_outlined,
                    color: CustomerDashboardPalette.error, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(item.type,
                          style: const TextStyle(
                              color: CustomerDashboardPalette.text,
                              fontWeight: FontWeight.w700,
                              fontSize: 14)),
                      Text('${_dayShort(item.date)}, ${_time(item.date)}',
                          style: const TextStyle(
                              color: CustomerDashboardPalette.muted,
                              fontSize: 12.5)),
                      if (item.reference.isNotEmpty)
                        Text('Ref ${item.reference}',
                            style: const TextStyle(
                                color: CustomerDashboardPalette.muted,
                                fontSize: 12.5)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(insightMoney(item.amount),
                      textAlign: TextAlign.end,
                      style: const TextStyle(
                          color: CustomerDashboardPalette.error,
                          fontWeight: FontWeight.w700,
                          fontSize: 14)),
                ),
                const Icon(Icons.chevron_right_rounded,
                    color: CustomerDashboardPalette.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({super.key, required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: CustomerDashboardPalette.paleBlue,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, color: CustomerDashboardPalette.royalBlue, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    color: CustomerDashboardPalette.text,
                    fontSize: 13.5,
                    height: 1.35)),
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const Key('insights-error'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _Note(icon: Icons.error_outline_rounded, text: message),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            key: const Key('insights-retry'),
            onPressed: onRetry,
            style: FilledButton.styleFrom(
              backgroundColor: CustomerDashboardPalette.royalBlue,
              foregroundColor: CustomerDashboardPalette.navy,
              minimumSize: const Size(0, 44),
              shape: const StadiumBorder(),
            ),
            child: const Text('Retry',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ),
      ],
    );
  }
}

class _InsightsSkeleton extends StatelessWidget {
  const _InsightsSkeleton();

  @override
  Widget build(BuildContext context) {
    Widget block(double h, {double? w}) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(
            color: CustomerDashboardPalette.paleBlue,
            borderRadius: BorderRadius.circular(12),
          ),
        );
    return Semantics(
      key: const Key('insights-loading'),
      label: 'Loading your transaction insights',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          block(14, w: 220),
          const SizedBox(height: 12),
          Row(children: <Widget>[
            Expanded(child: block(58)),
            const SizedBox(width: 8),
            Expanded(child: block(58)),
          ]),
          const SizedBox(height: 8),
          Row(children: <Widget>[
            Expanded(child: block(58)),
            const SizedBox(width: 8),
            Expanded(child: block(58)),
          ]),
          const SizedBox(height: 12),
          block(140, w: double.infinity),
        ],
      ),
    );
  }
}
