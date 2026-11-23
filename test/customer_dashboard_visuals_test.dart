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
    expect(headerDecoration.color, CustomerDashboardPalette.header);
    expect(headerDecoration.borderRadius, BorderRadius.circular(20));
    final logo = tester.widget<Image>(
      find.byKey(const Key('customer-dashboard-logo')),
    );
    expect(logo.semanticLabel, 'ServicePay logo');
    expect(logo.image, isA<ResizeImage>());
    for (final String label in <String>['ServicePay', 'Ada']) {
      expect(
        tester.widget<Text>(find.text(label)).style?.color,
        CustomerDashboardPalette.text,
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
      CustomerDashboardPalette.softText,
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
    // Measure the actual layered wallet, not the raw bright gradient stop.
    final scrim = (wallet.child! as DecoratedBox).decoration as BoxDecoration;
    final scrimColours = (scrim.gradient! as LinearGradient).colors;
    final size = tester.getSize(find.byKey(const Key('servicepay-wallet-card')));
    final w2 = size.width * size.width;
    final h2 = size.height * size.height;
    for (var x = 0; x <= 20; x++) {
      for (var y = 0; y <= 10; y++) {
        final dx = x / 20;
        final dy = y / 10;
        final backdrop = Color.alphaBlend(
          Color.lerp(scrimColours.first, scrimColours.last,
              ((1 - dx) * w2 + dy * h2) / (w2 + h2))!,
          Color.lerp(CustomerDashboardPalette.walletStart,
              CustomerDashboardPalette.walletEnd,
              (dx * w2 + dy * h2) / (w2 + h2))!,
        );
        expect(
          (CustomerDashboardPalette.onWallet.computeLuminance() + .05) /
              (backdrop.computeLuminance() + .05),
          greaterThanOrEqualTo(4.5),
          reason: 'White wallet text must contrast with its layered background',
        );
      }
    }
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
              ? CustomerDashboardPalette.canvas
              : CustomerDashboardPalette.onWallet;
      final Color actionBackground = Color.alphaBlend(
        tester.widget<Material>(action).color!,
        CustomerDashboardPalette.walletEnd,
      );
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

  testWidgets('customer navigation selects the turquoise treatment and routes',
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
    for (final index in <int>[0, 2, 3]) {
      final label = tester.widget<Text>(
        find.byKey(Key('customer-navigation-label-$index')),
      );
      expect(label.style?.color, CustomerDashboardPalette.text);
    }
    expect(
      find.byWidgetPredicate(
        (Widget widget) =>
            widget is Text &&
            widget.key == const Key('customer-navigation-label-1') &&
            widget.data == 'History' &&
            widget.style?.color == CustomerDashboardPalette.serviceCyan,
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
      const Size(360, 800),
      const Size(390, 844),
      const Size(430, 932),
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
      // Widget tests use the square Ahem font, not Chrome's Roboto. Protect
      // usable label width here; the browser checks actual word wrapping.
      for (final label in <String>['Marketplace', 'NIN Verification']) {
        final paragraph = tester.renderObject<RenderParagraph>(find.descendant(
          of: find.byKey(Key('customer-quick-service-${label.toLowerCase()}')),
          matching: find.text(label),
        ));
        expect(
          paragraph.size.width,
          greaterThanOrEqualTo(80),
          reason: '$label needs room for complete words at ${size.width}px',
        );
      }
      final wordmark = tester.renderObject<RenderParagraph>(
        find.text('ServicePay').first,
      );
      expect(wordmark.size.width, greaterThanOrEqualTo(65));
      expect(tester.takeException(), isNull);
    }
  });

  test('premium green text and CTA pairs meet WCAG AA contrast', () {
    double ratio(Color a, Color b) {
      final double x = a.computeLuminance();
      final double y = b.computeLuminance();
      return (x > y ? x + 0.05 : y + 0.05) / (x > y ? y + 0.05 : x + 0.05);
    }

    // Secondary text must stay readable on both rich-green card surfaces.
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

  test('premium emerald wallet preserves the approved gradient and light action', () {
    expect(CustomerDashboardPalette.onWallet, const Color(0xFFF5FFFB));
    expect(CustomerDashboardPalette.walletStart, const Color(0xFF00B894));
    expect(CustomerDashboardPalette.walletEnd, const Color(0xFF087F68));
    expect(CustomerDashboardPalette.walletAction, CustomerDashboardPalette.text);
  });

  test('approved clarity palette uses solid surfaces and readable icon wells', () {
    expect(CustomerDashboardPalette.canvas, const Color(0xFF061F1A));
    expect(CustomerDashboardPalette.header, const Color(0xFF0A3028));
    expect(CustomerDashboardPalette.section, const Color(0xFF092B23));
    expect(CustomerDashboardPalette.serviceCard, const Color(0xFF0B3329));
    expect(CustomerDashboardPalette.accountCard, const Color(0xFF0C382E));
    expect(CustomerDashboardPalette.primaryAccent, const Color(0xFF28DDB5));
    expect(CustomerDashboardPalette.border, const Color(0xFF1C6552));
    expect(CustomerDashboardPalette.activeGreen, const Color(0xFF20D69A));
    expect(CustomerDashboardPalette.royalBlue, const Color(0xFF22D3EE));
    expect(CustomerDashboardPalette.text, const Color(0xFFF5FFFB));
    expect(CustomerDashboardPalette.softText, const Color(0xFFA9C8BE));
    expect(CustomerDashboardPalette.muted, const Color(0xFFA9C8BE));
    for (final foreground in <Color>[
      CustomerDashboardPalette.text,
      CustomerDashboardPalette.softText,
      CustomerDashboardPalette.muted,
    ]) {
      for (final background in <Color>[
        CustomerDashboardPalette.canvas,
        CustomerDashboardPalette.header,
        CustomerDashboardPalette.section,
        CustomerDashboardPalette.accountCard,
        CustomerDashboardPalette.paleBlue,
        CustomerDashboardPalette.serviceCard,
      ]) {
        // Solid surfaces require normal-text contrast. The actual layered
        // wallet is measured separately in the wallet widget test.
        final light = foreground.computeLuminance();
        final dark = background.computeLuminance();
        expect((light + .05) / (dark + .05), greaterThanOrEqualTo(4.5));
      }
    }
    for (final title in CustomerServiceColors.byTitle.keys) {
      final background = CustomerServiceColors.tintFor(title);
      expect(background.a, 1);
      expect(
        (CustomerServiceColors.iconFor(title).computeLuminance() + .05) /
            (background.computeLuminance() + .05),
        greaterThanOrEqualTo(3),
        reason: '$title icon must contrast with its solid well',
      );
    }
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

  testWidgets('nine Home service icons restore individual reference colours',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 120));
    expect(
      tester.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor,
      const Color(0xFF061F1A),
    );
    final services = tester.widget<Container>(
      find.byKey(const Key('customer-quick-services')),
    );
    expect((services.decoration as BoxDecoration).color,
        const Color(0xFF092B23));
    const expected = <String, Color>{
      'Data': Color(0xFF38BDF8),
      'Airtime': Color(0xFF2DD4BF),
      'Delivery': Color(0xFFFB923C),
      'NIN Verification': Color(0xFFA78BFA),
      'Marketplace': Color(0xFFFBBF24),
      'Electricity': Color(0xFFFDE047),
      'EduPay': Color(0xFF818CF8),
      'Keke Napep': Color(0xFFFB7185),
      'Flight Booking': Color(0xFF60A5FA),
    };
    for (final entry in expected.entries) {
      final tile = find
          .byKey(Key('customer-quick-service-${entry.key.toLowerCase()}'));
      expect(tile, findsOneWidget, reason: entry.key);
      expect(
        tester.widget<Material>(
          find.ancestor(of: tile, matching: find.byType(Material)).first,
        ).color,
        const Color(0xFF0B3329),
      );
      final glyph = tester.widget<CustomerServiceGlyph>(
          find.descendant(of: tile, matching: find.byType(CustomerServiceGlyph)));
      expect(glyph.iconColor, entry.value, reason: entry.key);
      expect(glyph.backgroundColor, CustomerServiceColors.tintFor(entry.key));
      expect(glyph.radius, 12);
      expect(
          tester.widget<Text>(find.descendant(
                  of: tile, matching: find.text(entry.key))).style?.color,
          CustomerDashboardPalette.text);
    }
    expect(tester.takeException(), isNull);
  });
}
