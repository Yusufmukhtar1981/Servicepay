import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/transactions_screen.dart';
import 'package:servicepay_app/widgets/customer_dashboard_visuals.dart';

class _RouteObserver extends NavigatorObserver {
  final List<Route<dynamic>> routes = <Route<dynamic>>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    routes.add(route);
    super.didPush(route, previousRoute);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
    });
  });

  testWidgets('customer wallet uses the navy surface and history action works',
      (WidgetTester tester) async {
    final _RouteObserver observer = _RouteObserver();
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(
      home: const DashboardScreen(),
      navigatorObservers: <NavigatorObserver>[observer],
    ));
    await tester.pump(const Duration(milliseconds: 120));

    final Container wallet = tester
        .widget<Container>(find.byKey(const Key('servicepay-wallet-card')));
    final BoxDecoration decoration = wallet.decoration! as BoxDecoration;
    final LinearGradient gradient = decoration.gradient! as LinearGradient;
    expect(gradient.colors.first, CustomerDashboardPalette.navy);
    expect(find.byKey(const Key('dashboard-add-money-action')), findsOneWidget);
    final Finder history =
        find.byKey(const Key('dashboard-wallet-history-action'));
    expect(history, findsOneWidget);
    expect(find.byKey(const Key('dashboard-transfer-action')), findsNothing);

    await tester.tap(history);
    await tester.pump();
    expect(observer.routes.last, isA<MaterialPageRoute<void>>());
    final MaterialPageRoute<dynamic> route =
        observer.routes.last as MaterialPageRoute<dynamic>;
    expect(
      route.builder(tester.element(find.byType(DashboardScreen))),
      isA<TransactionsScreen>(),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('customer navigation selects the blue treatment and routes',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.text('Transactions'));
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byType(TransactionsScreen), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (Widget widget) =>
            widget is Text &&
            widget.data == 'Transactions' &&
            widget.style?.color == CustomerDashboardPalette.royalBlue,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('wallet actions remain visible at narrow and wide widths',
      (WidgetTester tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final Size size in <Size>[
      const Size(320, 760),
      const Size(1440, 960),
    ]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
      await tester.pump(const Duration(milliseconds: 100));

      for (final Key key in <Key>[
        const Key('dashboard-add-money-action'),
        const Key('dashboard-wallet-history-action'),
      ]) {
        final Finder action = find.byKey(key);
        expect(action, findsOneWidget);
        expect(tester.getSize(action).width, greaterThan(0));
        expect(tester.getRect(action).right, lessThanOrEqualTo(size.width));
      }
      expect(tester.takeException(), isNull);
    }
  });
}
