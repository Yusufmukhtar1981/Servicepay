import 'package:flutter/material.dart';

const managementForest = Color(0xFF092B20);
const managementPanel = Color(0xFF123B2D);
const managementRaised = Color(0xFF194735);
const managementAccent = Color(0xFF54E38A);
const managementMuted = Color(0xFFAAC2B5);

class ManagementBrandMark extends StatelessWidget {
  const ManagementBrandMark({super.key});
  @override
  Widget build(BuildContext context) => Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: managementAccent,
          borderRadius: BorderRadius.circular(11),
        ),
        alignment: Alignment.center,
        child: const Text(
          'S',
          style: TextStyle(
            color: managementForest,
            fontSize: 22,
            fontWeight: FontWeight.w900,
            fontStyle: FontStyle.italic,
          ),
        ),
      );
}

class ManagementKpiCard extends StatelessWidget {
  const ManagementKpiCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    required this.comparison,
  });
  final String label;
  final String value;
  final String comparison;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: managementPanel,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: managementAccent.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: managementAccent, size: 19),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w800,
                    )),
                const SizedBox(height: 3),
                Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: managementMuted, fontSize: 10)),
                Text(comparison,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: managementAccent, fontSize: 9)),
              ],
            ),
          ),
        ]),
      );
}

class ManagementActivityChart extends StatelessWidget {
  const ManagementActivityChart({super.key, required this.points, required this.label});
  final List<Map<String, dynamic>> points;
  final String label;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 25),
        child: Center(
          child: Text('No measured activity for this period.',
              style: TextStyle(color: managementMuted, fontSize: 11)),
        ),
      );
    }
    final values =
        points.map((p) => (p['transactions'] as num).toDouble()).toList();
    final dates = points.map((p) => DateTime.tryParse('${p['at']}')).toList();
    if (dates.any((d) => d == null)) {
      return const Text('Activity dates are unavailable.',
          style: TextStyle(color: managementMuted));
    }
    final times = dates.map((d) => d!.millisecondsSinceEpoch.toDouble()).toList();
    final labels = points.map((p) {
      final parsed = DateTime.tryParse('${p['at']}');
      final dt = parsed?.toUtc().add(const Duration(hours: 1));
      return dt == null ? '${p['at'] ?? ''}' : '${dt.day}/${dt.month}';
    }).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(
        height: 210,
        child: Semantics(
          label:
              '$label. ${points.asMap().entries.map((e) => '${labels[e.key]}: ${values[e.key].toStringAsFixed(0)}').join(', ')}',
          child: CustomPaint(
            painter: _ManagementChartPainter(values: values, labels: labels, times: times),
            child: const SizedBox.expand(),
          ),
        ),
      ),
      const SizedBox(height: 8),
      Text('Transactions · ${points.length} periods with records · Africa/Lagos',
          style: const TextStyle(color: managementMuted, fontSize: 10)),
      const SizedBox(height: 8),
      Wrap(
        spacing: 6,
        runSpacing: 5,
        children: points.asMap().entries.map((entry) {
          final text =
              '${labels[entry.key]}: ${values[entry.key].toStringAsFixed(0)} transactions';
          return Tooltip(
            message: text,
            child: Semantics(
              label: text,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                decoration: BoxDecoration(
                  color: managementRaised,
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(text,
                    style: const TextStyle(color: managementMuted, fontSize: 9)),
              ),
            ),
          );
        }).toList(),
      ),
    ]);
  }
}

class _ManagementChartPainter extends CustomPainter {
  _ManagementChartPainter({required this.values, required this.labels, required this.times});
  final List<double> values;
  final List<String> labels;
  final List<double> times;

  @override
  void paint(Canvas canvas, Size size) {
    const left = 35.0, right = 9.0, top = 10.0, bottom = 31.0;
    final chart = Rect.fromLTRB(left, top, size.width - right, size.height - bottom);
    final maxValue = values.fold<double>(0, (a, b) => a > b ? a : b);
    final ceiling = maxValue <= 0 ? 1.0 : maxValue * 1.15;
    final axisPaint = Paint()..color = Colors.white24..strokeWidth = 1;
    final gridPaint = Paint()..color = Colors.white10..strokeWidth = 1;
    for (var i = 0; i <= 3; i++) {
      final y = chart.top + chart.height * i / 3;
      canvas.drawLine(Offset(chart.left, y), Offset(chart.right, y),
          i == 3 ? axisPaint : gridPaint);
      _drawText(canvas, '${(ceiling * (3 - i) / 3).round()}',
          Offset(0, y - 7), const TextStyle(color: managementMuted, fontSize: 9));
    }
    final first = times.first, last = times.last;
    var interval = 86400000.0;
    if (times.length > 1) {
      interval = times[1] - times[0];
      for (var i = 2; i < times.length; i++) {
        final gap = times[i] - times[i - 1];
        if (gap > 0 && gap < interval) interval = gap;
      }
    }
    if (interval <= 0) interval = 86400000;
    final span = last - first + interval;
    final barWidth = (chart.width * interval / span * .45).clamp(4.0, 26.0).toDouble();
    final paint = Paint()..color = managementAccent;
    for (var i = 0; i < values.length; i++) {
      final centerX = chart.left + chart.width * (times[i] - first + interval / 2) / span;
      final height = chart.height * values[i] / ceiling;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(centerX - barWidth / 2, chart.bottom - height, barWidth, height),
          const Radius.circular(3),
        ),
        paint,
      );
      if (values.length <= 8 ||
          i == 0 ||
          i == values.length - 1 ||
          i == values.length ~/ 2) {
        final text = labels[i];
        _drawText(canvas, text,
            Offset(centerX - _approxWidth(text, 9) / 2, chart.bottom + 8),
            const TextStyle(color: managementMuted, fontSize: 9));
      }
    }
  }

  void _drawText(Canvas canvas, String text, Offset offset, TextStyle style) {
    final painter =
        TextPainter(text: TextSpan(text: text, style: style), textDirection: TextDirection.ltr)
          ..layout();
    painter.paint(canvas, offset);
  }

  double _approxWidth(String value, double font) => value.length * font * .58;

  @override
  bool shouldRepaint(covariant _ManagementChartPainter oldDelegate) =>
      oldDelegate.values != values || oldDelegate.labels != labels || oldDelegate.times != times;
}

class ManagementDetailDialog extends StatelessWidget {
  const ManagementDetailDialog({super.key, required this.title, required this.values});
  final String title;
  final Map<String, String> values;

  @override
  Widget build(BuildContext context) => AlertDialog(
        backgroundColor: managementPanel,
        title: Text(title, style: const TextStyle(color: Colors.white)),
        content: SizedBox(
          width: 430,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: values.entries
                  .map((e) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 7),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 105,
                              child: Text(e.key,
                                  style: const TextStyle(
                                      color: managementMuted, fontSize: 11)),
                            ),
                            Expanded(
                              child: Text(e.value,
                                  style: const TextStyle(
                                      color: Colors.white, fontSize: 12)),
                            ),
                          ],
                        ),
                      ))
                  .toList(),
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context), child: const Text('Close'))
        ],
      );
}

class ManagementNoteLine extends StatelessWidget {
  const ManagementNoteLine(this.title, this.body, {super.key});
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.check_circle_outline,
              color: managementAccent, size: 17),
          const SizedBox(width: 9),
          Expanded(
            child: RichText(
              text: TextSpan(
                style: const TextStyle(
                    fontSize: 11, height: 1.4, color: managementMuted),
                children: [
                  TextSpan(
                      text: '$title · ',
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w700)),
                  TextSpan(text: body),
                ],
              ),
            ),
          ),
        ]),
      );
}
