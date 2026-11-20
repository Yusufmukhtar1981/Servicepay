import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/servicepay_theme.dart';
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

  testWidgets('campaign frame clips artwork to rounded green borders',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: CustomerCampaignFrame(child: SizedBox(width: 320, height: 220)),
    ));
    final frame = tester.widget<Container>(find.descendant(
      of: find.byType(CustomerCampaignFrame),
      matching: find.byType(Container),
    ).first);
    expect(frame.clipBehavior, Clip.antiAlias);
    expect((frame.decoration as BoxDecoration).borderRadius,
        BorderRadius.circular(22));
    expect((frame.foregroundDecoration as BoxDecoration).border, isNotNull);
  });

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
    });
  });

  testWidgets('customer wallet uses exact green surface and actions work',
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

    final Container header = tester.widget<Container>(
      find.byKey(const Key('customer-dashboard-header')),
    );
    final BoxDecoration headerDecoration =
        header.decoration! as BoxDecoration;
    expect(headerDecoration.color, CustomerDashboardPalette.card);
    expect(headerDecoration.borderRadius, BorderRadius.circular(22));
    for (final String label in <String>['ServicePay', 'Ada']) {
      expect(
        tester.widget<Text>(find.text(label)).style?.color,
        Colors.white,
      );
    }
    expect(
      tester.widget<Text>(find.byWidgetPredicate(
        (Widget widget) =>
            widget is Text &&
            <String>[
              'Good morning,',
              'Good afternoon,',
              'Good evening,',
            ].contains(widget.data),
      )).style?.color,
      Colors.white,
    );
    for (final Key actionKey in <Key>[
      const Key('dashboard-header-refresh'),
      const Key('dashboard-header-notifications'),
    ]) {
      final Finder action = find.descendant(
        of: find.byKey(actionKey),
        matching: find.byType(Icon),
      );
      expect(tester.widget<Icon>(action).color,
          CustomerDashboardPalette.royalBlue);
    }

    final Container wallet = tester
        .widget<Container>(find.byKey(const Key('servicepay-wallet-card')));
    final BoxDecoration decoration = wallet.decoration! as BoxDecoration;
    expect(decoration.color, isNull);
    expect(decoration.gradient, isA<LinearGradient>());
    expect(
      (decoration.gradient! as LinearGradient).colors,
      <Color>[
        CustomerDashboardPalette.walletStart,
        CustomerDashboardPalette.walletEnd,
      ],
    );
    final Text balance =
        tester.widget<Text>(find.byKey(const Key('dashboard-balance-value')));
    expect(balance.style?.color, CustomerDashboardPalette.onWallet);
    expect(
      tester.widget<Text>(find.text('Available Balance').first).style?.color,
      CustomerDashboardPalette.onWallet,
    );
    for (final Key actionKey in <Key>[
      const Key('dashboard-add-money-action'),
      const Key('dashboard-wallet-history-action'),
    ]) {
      final Finder action = find.byKey(actionKey);
      expect(action, findsOneWidget);
      final bool filled =
          actionKey == const Key('dashboard-add-money-action');
      final Color foreground =
          filled
              ? ServicePayColors.onAccent
              : CustomerDashboardPalette.onWallet;
      final Color actionBackground = tester.widget<Material>(action).color!;
      final double foregroundLuminance = foreground.computeLuminance();
      final double backgroundLuminance = actionBackground.computeLuminance();
      final double contrast = foregroundLuminance > backgroundLuminance
          ? (foregroundLuminance + 0.05) / (backgroundLuminance + 0.05)
          : (backgroundLuminance + 0.05) / (foregroundLuminance + 0.05);
      expect(contrast, greaterThanOrEqualTo(4.5),
          reason: 'Wallet action labels must remain accessible');
      expect(
        tester.widget<Text>(find.descendant(
          of: action,
          matching: find.byType(Text),
        )).style?.color,
        foreground,
      );
      expect(
        tester.widget<Icon>(find.descendant(
          of: action,
          matching: find.byType(Icon),
        )).color,
        foreground,
      );
    }
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

  testWidgets('customer navigation selects the green treatment and routes',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const Key('customer-navigation-label-1')));
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byType(TransactionsScreen), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (Widget widget) =>
            widget is Text &&
            widget.key == const Key('customer-navigation-label-1') &&
            widget.data == 'History' &&
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
      const Size(390, 844),
      const Size(768, 1024),
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

  test('premium green text and CTA pairs meet WCAG AA contrast', () {
    double ratio(Color a, Color b) {
      final double x = a.computeLuminance();
      final double y = b.computeLuminance();
      return (x > y ? x + 0.05 : y + 0.05) / (x > y ? y + 0.05 : x + 0.05);
    }

    // Secondary text must stay readable on the #087F68 secondary card.
    expect(ratio(ServicePayColors.muted, ServicePayColors.card),
        greaterThanOrEqualTo(4.5));
    expect(ratio(CustomerDashboardPalette.muted, CustomerDashboardPalette.card),
        greaterThanOrEqualTo(4.5));
    expect(ratio(CustomerDashboardPalette.text, CustomerDashboardPalette.card),
        greaterThanOrEqualTo(4.5));
    expect(ratio(ServicePayColors.onAccent, const Color(0xFFFFC94A)),
        greaterThanOrEqualTo(4.5));
    // Bright emerald CTAs (Refer Now, Buy, Verify Meter) carry deep forest.
    expect(ratio(ServicePayColors.onAccent, ServicePayColors.accent),
        greaterThanOrEqualTo(4.5));
    expect(
        ratio(CustomerDashboardPalette.onWallet,
            CustomerDashboardPalette.walletEnd),
        greaterThanOrEqualTo(4.5));
    // Semantic amount/status colours sit on canvas pills or dark surfaces.
    for (final Color c in <Color>[
      ServicePayColors.success,
      ServicePayColors.danger,
      ServicePayColors.warning,
      ServicePayColors.info,
      CustomerDashboardPalette.error,
    ]) {
      expect(ratio(c, ServicePayColors.surface), greaterThanOrEqualTo(4.5));
      expect(ratio(c, ServicePayColors.canvas), greaterThanOrEqualTo(4.5));
    }
  });

  test('dark wallet uses exact white foreground and gradient', () {
    expect(CustomerDashboardPalette.onWallet, const Color(0xFFFFFFFF));
    expect(CustomerDashboardPalette.walletStart, const Color(0xFF087F68));
    expect(CustomerDashboardPalette.walletEnd, const Color(0xFF0A6655));
  });

  testWidgets('transaction rows wrap long phone, date and amount readably',
      (WidgetTester tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const String phone = 'To 08031234567';
    const String date = '28/11/2026 • 14:07';
    for (final double scale in <double>[1, 2]) {
      for (final Size size in <Size>[
        const Size(320, 900),
        const Size(390, 900),
        const Size(768, 900),
        const Size(1440, 900),
      ]) {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        await tester.pumpWidget(MaterialApp(
          theme: ServicePayTheme.customer(),
          home: MediaQuery(
            data: MediaQueryData(
              size: size,
              textScaler: TextScaler.linear(scale),
            ),
            child: Scaffold(
              body: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: CustomerTransactionCard(
                    title: 'Airtime Purchase',
                    description: phone,
                    amount: 1250000.75,
                    direction: 'DEBIT',
                    status: 'PENDING',
                    date: date,
                    icon: Icons.phone_android_rounded,
                    statusColor: ServicePayColors.warning,
                    directionColor: ServicePayColors.danger,
                    onTap: () {},
                  ),
                ),
              ),
            ),
          ),
        ));
        expect(tester.takeException(), isNull,
            reason: 'No overflow at $size x$scale');
        RenderParagraph para(String text) =>
            tester.renderObject<RenderParagraph>(find.text(text));
        final RenderParagraph amount = para('-₦1250000.75');
        expect(amount.didExceedMaxLines, isFalse);
        expect(amount.text.style?.fontSize, greaterThanOrEqualTo(19));
        expect(tester.getRect(find.text('-₦1250000.75')).right,
            lessThanOrEqualTo(size.width));
        final RenderParagraph dateText = para(date);
        expect(dateText.didExceedMaxLines, isFalse);
        expect(dateText.text.style?.fontSize, greaterThanOrEqualTo(14));
        final RenderParagraph phoneText = para(phone);
        expect(phoneText.text.style?.fontSize, greaterThanOrEqualTo(15));
        expect(phoneText.text.style?.color, Colors.white);
        expect(phoneText.didExceedMaxLines, isFalse);
        final RenderParagraph badge = para('PENDING');
        expect(badge.didExceedMaxLines, isFalse);
        expect(badge.text.style?.fontSize, greaterThanOrEqualTo(14));
      }
    }
  });
}
