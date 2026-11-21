import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/customer_transaction_insights.dart';
import 'package:servicepay_app/widgets/customer_dashboard_visibility.dart';
import 'package:servicepay_app/widgets/customer_dashboard_visuals.dart';
import 'package:servicepay_app/widgets/customer_transaction_insights.dart';

Map<String, dynamic> _row(String id, String status, num amount, DateTime at,
        {String? code}) =>
    <String, dynamic>{
      'id': id,
      'reference': 'REF-$id',
      'status': status,
      'amount': amount,
      'type': 'airtime',
      'createdAt': at.toIso8601String(),
      if (code != null) 'failureCode': code,
    };

CustomerTransactionInsights _sample(CustomerInsightsPeriod period) {
  final now = DateTime(2025, 6, 18, 14, 30); // Wednesday
  final window = InsightsWindow.at(period, now);
  return CustomerTransactionInsights.fromRows(<Map<String, dynamic>>[
    _row('a', 'SUCCESSFUL', 1500, DateTime(2025, 6, 18, 9)),
    _row('b', 'FAILED', 250.5, DateTime(2025, 6, 17, 10, 5),
        code: 'INSUFFICIENT_FUNDS'),
    _row('c', 'PENDING', 100, DateTime(2025, 6, 16, 8)),
    _row('d', 'SUCCESSFUL', 1000, DateTime(2025, 6, 10, 8)),
  ], window);
}

Widget _host(Widget child,
        {double width = 390, double scale = 1, bool visible = true}) =>
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
            size: Size(width, 900), textScaler: TextScaler.linear(scale)),
        child: CustomerDashboardVisibility(
          visible: visible,
          child: Scaffold(
            body: SingleChildScrollView(
              child: SizedBox(width: width - 32, child: child),
            ),
          ),
        ),
      ),
    );

void main() {
  testWidgets('returning from a service route reloads recorded insights',
      (tester) async {
    final navigator = GlobalKey<NavigatorState>();
    var loads = 0;
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navigator,
      home: Scaffold(
        body: SingleChildScrollView(
          child: CustomerTransactionInsightsSection(loader: (period) async {
            loads++;
            return _sample(period);
          }),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(loads, 1);
    unawaited(navigator.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('Service route')))));
    await tester.pumpAndSettle();
    expect(loads, 1);
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    expect(loads, 2);
  });

  testWidgets('weekly default shows metrics, comparison and declined details',
      (tester) async {
    final periods = <CustomerInsightsPeriod>[];
    bool opened = false;
    await tester.pumpWidget(_host(CustomerTransactionInsightsSection(
      loader: (p) async {
        periods.add(p);
        return _sample(p);
      },
      onOpenHistory: () => opened = true,
    )));
    await tester.pumpAndSettle();
    expect(periods, <CustomerInsightsPeriod>[CustomerInsightsPeriod.weekly]);
    expect(find.text('My Transaction Insights'), findsOneWidget);
    expect(find.byKey(const Key('metric-total')), findsOneWidget);
    expect(find.text('₦1,850.50'), findsWidgets);
    expect(find.text('Up 100.0%'), findsNothing);
    expect(find.text('No previous-period activity to compare'), findsWidgets);
    await tester.ensureVisible(find.byKey(const Key('insights-declined-b')));
    await tester.tap(find.byKey(const Key('insights-declined-b')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('insights-declined-detail')), findsOneWidget);
    expect(find.text('REF-b'), findsWidgets);
    expect(find.text('Insufficient available funds.'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('insights-open-history')));
    await tester.tap(find.byKey(const Key('insights-open-history')));
    expect(opened, isTrue);
  });

  testWidgets('day selection, value mode and monthly toggle', (tester) async {
    final periods = <CustomerInsightsPeriod>[];
    await tester.pumpWidget(_host(CustomerTransactionInsightsSection(
      loader: (p) async {
        periods.add(p);
        return _sample(p);
      },
    )));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('insights-day-1')));
    await tester.tap(find.byKey(const Key('insights-day-1')));
    await tester.pump();
    expect(find.text('Tue 17 Jun 2025'), findsOneWidget);
    await tester.tap(find.byKey(const Key('insights-previous-day')));
    await tester.pump();
    expect(find.text('Mon 16 Jun 2025'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('insights-mode-value')));
    await tester.tap(find.byKey(const Key('insights-mode-value')));
    await tester.pump();
    expect(find.textContaining('naira'), findsOneWidget);
    await tester
        .ensureVisible(find.byKey(const Key('insights-period-monthly')));
    await tester.tap(find.byKey(const Key('insights-period-monthly')));
    await tester.pumpAndSettle();
    expect(periods.last, CustomerInsightsPeriod.monthly);
    expect(find.textContaining('Month to date'), findsOneWidget);
  });

  testWidgets(
      'error hides old totals and retry reloads; stale responses ignored',
      (tester) async {
    int calls = 0;
    final slow = Completer<CustomerTransactionInsights>();
    await tester.pumpWidget(_host(CustomerTransactionInsightsSection(
      loader: (p) {
        calls++;
        if (calls == 1) return slow.future;
        if (calls == 2) return Future.error(StateError('Insights failed.'));
        return Future.value(_sample(p));
      },
    )));
    await tester.pump();
    expect(find.byKey(const Key('insights-loading')), findsOneWidget);
    await tester.tap(find.byKey(const Key('insights-period-monthly')));
    await tester.pumpAndSettle();
    expect(find.text('Insights failed.'), findsOneWidget);
    slow.complete(_sample(CustomerInsightsPeriod.weekly));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('metric-total')), findsNothing);
    await tester.tap(find.byKey(const Key('insights-retry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('metric-total')), findsOneWidget);
  });

  testWidgets('hidden dashboard tab does not load', (tester) async {
    int calls = 0;
    await tester
        .pumpWidget(_host(CustomerTransactionInsightsSection(loader: (p) async {
      calls++;
      return _sample(p);
    }), visible: false));
    await tester.pumpAndSettle();
    expect(calls, 0);
  });

  for (final width in <double>[320, 390, 768]) {
    testWidgets('no overflow at $width with 2x text', (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(_host(
          CustomerTransactionInsightsSection(loader: (p) async => _sample(p)),
          width: width,
          scale: 2));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('insights-chart')), findsOneWidget);
    });
  }

  testWidgets('declined history reveals ten more at a time without reloading',
      (tester) async {
    final now = DateTime(2025, 6, 18, 14, 30);
    int calls = 0;
    final rows = <Map<String, dynamic>>[
      for (int i = 0; i < 25; i++)
        _row('x$i', 'FAILED', 10 + i, now.subtract(Duration(minutes: i + 1))),
    ];
    await tester.pumpWidget(_host(CustomerTransactionInsightsSection(
      loader: (p) async {
        calls++;
        return CustomerTransactionInsights.fromRows(
            rows, InsightsWindow.at(p, now));
      },
    )));
    await tester.pumpAndSettle();
    Finder tiles() => find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey<String> &&
            (w.key as ValueKey<String>).value.startsWith('insights-declined-x'),
        skipOffstage: false);
    expect(tiles(), findsNWidgets(3));
    for (final expected in <int>[13, 23, 25]) {
      await tester
          .ensureVisible(find.byKey(const Key('insights-declined-more')));
      await tester.tap(find.byKey(const Key('insights-declined-more')));
      await tester.pump();
      expect(tiles(), findsNWidgets(expected));
    }
    expect(find.byKey(const Key('insights-declined-more')), findsNothing);
    expect(calls, 1);
  });

  testWidgets('semantic metric accents, green toggles and matching chart series',
      (tester) async {
    await tester.pumpWidget(_host(CustomerTransactionInsightsSection(
      loader: (p) async => _sample(p),
    )));
    await tester.pumpAndSettle();
    Color fill(String key) => (tester
            .widget<Container>(find.descendant(
                of: find.byKey(Key(key)), matching: find.byType(Container)).first)
            .decoration! as BoxDecoration)
        .color!;
    expect(fill('insights-period-weekly'), CustomerDashboardPalette.activeGreen);
    expect(fill('insights-period-monthly'), CustomerDashboardPalette.inactiveGreen);
    expect(fill('insights-mode-count'), CustomerDashboardPalette.activeGreen);
    for (final (key, color) in <(String, Color)>[
      ('metric-total', CustomerDashboardPalette.seriesBlue),
      ('metric-successful', CustomerDashboardPalette.seriesEmerald),
      ('metric-declined', CustomerDashboardPalette.seriesCoral),
      ('metric-pending', CustomerDashboardPalette.seriesAmber),
      ('metric-total-value', CustomerDashboardPalette.seriesBlue),
      ('metric-successful-value', CustomerDashboardPalette.seriesEmerald),
      ('metric-declined-value', CustomerDashboardPalette.seriesCoral),
    ]) {
      final icon = tester.widget<Icon>(find.descendant(
          of: find.byKey(Key('$key-icon')), matching: find.byType(Icon)));
      expect(icon.color, color, reason: key);
    }
    // Legend swatches use exactly the series colours.
    for (final c in <Color>[
      CustomerDashboardPalette.seriesBlue,
      CustomerDashboardPalette.seriesEmerald,
      CustomerDashboardPalette.seriesCoral,
    ]) {
      expect(
          find.byWidgetPredicate((w) =>
              w is Container &&
              w.decoration is BoxDecoration &&
              (w.decoration! as BoxDecoration).color == c),
          findsWidgets);
    }
    expect(find.text('₦1,850.50'), findsWidgets);
    await tester.ensureVisible(find.byKey(const Key('insights-mode-value')));
    await tester.tap(find.byKey(const Key('insights-mode-value')));
    await tester.pumpAndSettle();
    expect(fill('insights-mode-value'), CustomerDashboardPalette.activeGreen);
    expect(fill('insights-mode-count'), CustomerDashboardPalette.inactiveGreen);
    expect(find.textContaining('Daily value in naira'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('insights-period-monthly')));
    await tester.tap(find.byKey(const Key('insights-period-monthly')));
    await tester.pumpAndSettle();
    expect(fill('insights-period-monthly'), CustomerDashboardPalette.activeGreen);
    expect(fill('insights-period-weekly'), CustomerDashboardPalette.inactiveGreen);
    expect(tester.takeException(), isNull);
  });
}
