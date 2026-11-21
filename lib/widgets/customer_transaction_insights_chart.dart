part of 'customer_transaction_insights.dart';

// Native grouped-bar chart and accessible selected-day details.

class _InsightsChart extends StatelessWidget {
  const _InsightsChart({
    required this.buckets,
    required this.showValue,
    required this.weekly,
    required this.selected,
    required this.onSelect,
  });

  final List<InsightBucket> buckets;
  final bool showValue;
  final bool weekly;
  final int? selected;
  final ValueChanged<int> onSelect;

  static const Color _allColor = CustomerDashboardPalette.seriesBlue;
  static const Color _okColor = CustomerDashboardPalette.seriesEmerald;
  static const Color _badColor = CustomerDashboardPalette.seriesCoral;

  double _total(InsightBucket b) =>
      showValue ? b.totals.totalValue : b.totals.totalCount.toDouble();
  double _ok(InsightBucket b) => showValue
      ? b.totals.successfulValue
      : b.totals.successfulCount.toDouble();
  double _bad(InsightBucket b) =>
      showValue ? b.totals.declinedValue : b.totals.declinedCount.toDouble();
  String _fmt(double v) => showValue ? insightMoney(v) : v.round().toString();

  @override
  Widget build(BuildContext context) {
    const double barArea = 140;
    double max = 0;
    for (final b in buckets) {
      if (_total(b) > max) max = _total(b);
    }
    Widget legend(Color color, String label) => Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                    color: color, borderRadius: BorderRadius.circular(3))),
            const SizedBox(width: 6),
            Flexible(
                child: Text(label,
                    style: const TextStyle(
                        color: CustomerDashboardPalette.text, fontSize: 13))),
          ],
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: 14,
          runSpacing: 6,
          children: <Widget>[
            legend(_allColor, 'All transactions'),
            legend(_okColor, 'Successful'),
            legend(_badColor, 'Declined'),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          showValue
              ? 'Daily value in naira (₦). Highest day: ${_fmt(max)}.'
              : 'Daily number of transactions. Highest day: ${_fmt(max)}.',
          key: const Key('insights-chart-unit'),
          style: const TextStyle(
              color: CustomerDashboardPalette.muted, fontSize: 12.5),
        ),
        const SizedBox(height: 10),
        LayoutBuilder(builder: (context, constraints) {
          final double minSlot = weekly ? 40 : 30;
          final double slot =
              (constraints.maxWidth / buckets.length).clamp(minSlot, 96.0);
          final double contentWidth = slot * buckets.length;
          final Widget bars = SizedBox(
            width: contentWidth < constraints.maxWidth
                ? constraints.maxWidth
                : contentWidth,
            child: Stack(
              children: <Widget>[
                Positioned(
                  left: 0,
                  right: 0,
                  top: barArea,
                  child: Container(
                      height: 1, color: CustomerDashboardPalette.muted),
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    for (int i = 0; i < buckets.length; i++)
                      _slot(context, i, slot, barArea, max),
                  ],
                ),
              ],
            ),
          );
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SingleChildScrollView(
                key: const Key('insights-chart'),
                scrollDirection: Axis.horizontal,
                reverse: true,
                child: bars,
              ),
              const SizedBox(height: 4),
              const Text('Baseline is 0. Tap a day to see its details.',
                  style: TextStyle(
                      color: CustomerDashboardPalette.muted, fontSize: 12)),
            ],
          );
        }),
      ],
    );
  }

  Widget _slot(
      BuildContext context, int i, double slot, double area, double max) {
    final b = buckets[i];
    final bool isSelected = selected == i;
    double h(double v) =>
        max <= 0 || v <= 0 ? 0 : (v / max * area).clamp(2.0, area);
    final double barWidth = ((slot - 10) / 3).clamp(4.0, 16.0);
    final Duration motion = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 260);
    // Height is exactly the scaled value; zero stays zero (no false bars).
    // Snap width to the new slot when switching periods; animate height only.
    Widget bar(double v, Color color) => SizedBox(
          width: barWidth,
          child: AnimatedContainer(
            duration: motion,
            curve: Curves.easeOutCubic,
            height: h(v),
            decoration: BoxDecoration(
              color: isSelected ? color : color.withValues(alpha: 0.85),
              borderRadius: BorderRadius.vertical(
                  top: Radius.circular(math.min(barWidth / 2, 6))),
            ),
          ),
        );
    return Semantics(
      button: true,
      selected: isSelected,
      label:
          '${_day(b.date)}: ${_fmt(_total(b))} all, ${_fmt(_ok(b))} successful, ${_fmt(_bad(b))} declined',
      excludeSemantics: true,
      child: GestureDetector(
        key: Key('insights-day-$i'),
        behavior: HitTestBehavior.opaque,
        onTap: () => onSelect(i),
        child: SizedBox(
          width: slot,
          child: Column(
            children: <Widget>[
              Container(
                height: area,
                decoration: BoxDecoration(
                  color: isSelected ? CustomerDashboardPalette.paleBlue : null,
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(8)),
                ),
                alignment: Alignment.bottomCenter,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    bar(_total(b), _allColor),
                    const SizedBox(width: 1),
                    bar(_ok(b), _okColor),
                    const SizedBox(width: 1),
                    bar(_bad(b), _badColor),
                  ],
                ),
              ),
              const SizedBox(height: 5),
              Text(
                weekly ? _weekdays[b.date.weekday - 1] : '${b.date.day}',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: isSelected
                      ? CustomerDashboardPalette.royalBlue
                      : CustomerDashboardPalette.muted,
                  fontSize: 12,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectedDay extends StatelessWidget {
  const _SelectedDay({
    required this.bucket,
    required this.canPrevious,
    required this.canNext,
    required this.onPrevious,
    required this.onNext,
  });

  final InsightBucket bucket;
  final bool canPrevious, canNext;
  final VoidCallback onPrevious, onNext;

  @override
  Widget build(BuildContext context) {
    final t = bucket.totals;
    final lines = <String>[
      '${t.totalCount} total, value ${insightMoney(t.totalValue)}',
      '${t.successfulCount} successful, value ${insightMoney(t.successfulValue)}',
      '${t.declinedCount} declined, value ${insightMoney(t.declinedValue)}',
      '${t.pendingCount} pending or processing',
      if (t.otherCount > 0) '${t.otherCount} with another status',
    ];
    return Semantics(
      container: true,
      liveRegion: true,
      child: Container(
        key: const Key('insights-selected-day'),
        padding: const EdgeInsets.fromLTRB(12, 6, 6, 12),
        decoration: BoxDecoration(
          color: CustomerDashboardPalette.paleBlue,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(_day(bucket.date),
                      style: const TextStyle(
                          color: CustomerDashboardPalette.text,
                          fontWeight: FontWeight.w700,
                          fontSize: 15)),
                ),
                IconButton(
                  key: const Key('insights-previous-day'),
                  tooltip: 'Previous day',
                  onPressed: canPrevious ? onPrevious : null,
                  color: CustomerDashboardPalette.royalBlue,
                  icon: const Icon(Icons.chevron_left_rounded),
                ),
                IconButton(
                  key: const Key('insights-next-day'),
                  tooltip: 'Next day',
                  onPressed: canNext ? onNext : null,
                  color: CustomerDashboardPalette.royalBlue,
                  icon: const Icon(Icons.chevron_right_rounded),
                ),
              ],
            ),
            for (final line in lines)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(line,
                    style: const TextStyle(
                        color: CustomerDashboardPalette.text,
                        fontSize: 13.5,
                        height: 1.3)),
              ),
          ],
        ),
      ),
    );
  }
}
