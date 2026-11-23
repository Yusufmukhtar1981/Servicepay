import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/referral_screen.dart';
import 'package:servicepay_app/widgets/customer_dashboard_visuals.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/transactions_screen.dart';
import 'package:servicepay_app/services/announcement_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  ServicePayAnnouncement announcement({
    required String id,
    required String style,
    required String visibility,
  }) =>
      ServicePayAnnouncement(
        id: id,
        title: id,
        message: 'Campaign',
        type: 'INFO',
        displayStyle: style,
        priority: 0,
        visibility: visibility,
        mandatory: visibility == 'MANDATORY',
      );

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
    });
  });

  test('retains a popup-completed mandatory BOTH banner after refresh', () {
    final ServicePayAnnouncement item = announcement(
      id: 'mandatory-both',
      style: 'BOTH',
      visibility: 'MANDATORY',
    );
    final List<ServicePayAnnouncement> merged = mergeAnnouncementSessionState(
      loaded: const <ServicePayAnnouncement>[],
      current: <ServicePayAnnouncement>[item],
      popupCompletedBanners: <String, ServicePayAnnouncement>{item.id: item},
      hiddenBannerIds: const <String>{},
    );

    expect(merged.map((value) => value.id), <String>['mandatory-both']);
  });

  test('does not restore a dismissed EVERY_LOGIN banner after refresh', () {
    final ServicePayAnnouncement item = announcement(
      id: 'dismissed-banner',
      style: 'BANNER',
      visibility: 'EVERY_LOGIN',
    );
    final List<ServicePayAnnouncement> merged = mergeAnnouncementSessionState(
      loaded: <ServicePayAnnouncement>[item],
      current: <ServicePayAnnouncement>[item],
      popupCompletedBanners: const <String, ServicePayAnnouncement>{},
      hiddenBannerIds: <String>{item.id},
    );

    expect(merged, isEmpty);
  });

  testWidgets('shows the premium customer dashboard essentials',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('ServicePay'), findsOneWidget);
    expect(find.text('Ada'), findsOneWidget);
    expect(find.byKey(const Key('dashboard-header-refresh')), findsOneWidget);
    expect(find.text('Available Balance'), findsOneWidget);
    expect(find.text('Transfer'), findsNothing);
    expect(find.text('Withdrawal'), findsNothing);
    expect(find.byKey(const Key('customer-quick-services')), findsOneWidget);
    expect(find.byKey(const Key('customer-all-services')), findsOneWidget);
    expect(find.text('Data'), findsOneWidget);
    expect(find.text('Airtime'), findsOneWidget);
    expect(find.text('Fund Wallet'), findsNothing);
    expect(find.text('Wallet Funding'), findsNothing);
    expect(find.text('QR Pay'), findsNothing);

    await tester.tap(find.byKey(const Key('dashboard-header-refresh')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('dashboard-header-refresh')));
    await tester.pump();

    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('Recent Activity'),
      450,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Recent Activity'), findsOneWidget);
    expect(find.text('Activity unavailable'), findsOneWidget);
    expect(
      find.text('Your login session has expired. Please log in again.'),
      findsOneWidget,
    );
  });

  testWidgets('announcement surface remains between services and insights',
      (WidgetTester tester) async {
    for (final Size size in <Size>[
      const Size(390, 844),
      const Size(1440, 1000),
    ]) {
      await tester.binding.setSurfaceSize(size);
      await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));

      final double headerBottom = tester
          .getBottomLeft(find.byKey(const Key('customer-dashboard-header')))
          .dy;
      final double walletTop =
          tester.getTopLeft(find.byKey(const Key('servicepay-wallet-card'))).dy;
      expect(walletTop, greaterThan(headerBottom));
      final double promoTop =
          tester.getTopLeft(find.byKey(const Key('customer-announcement-surface'))).dy;
      expect(promoTop, greaterThan(walletTop));
      final double insightsTop = tester
          .getTopLeft(find.byKey(const Key('customer-transaction-insights')))
          .dy;
      expect(insightsTop, greaterThan(walletTop));
      expect(promoTop, lessThan(insightsTop));
      expect(promoTop, greaterThan(tester.getTopLeft(
          find.byKey(const Key('customer-quick-services'))).dy));
      expect(
        find
                .byKey(const Key('announcement-loading-state'))
                .evaluate()
                .isNotEmpty ||
            find
                .byKey(const Key('announcement-error-state'))
                .evaluate()
                .isNotEmpty,
        isTrue,
      );
      expect(tester.takeException(), isNull);
    }
    addTearDown(() => tester.binding.setSurfaceSize(null));
  });

  testWidgets(
      'order is wallet, account, services, business, activity, insights, referral',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'auth_token': 'test-token',
      'wallet_balance': 24500.0,
    });
    final requests = <http.Request>[];
    final client = MockClient((http.Request request) async {
      requests.add(request);
      if (request.url.path.endsWith('/auth/referral')) {
        return http.Response('{"success":true,"programme":{"version":2,'
            '"enabled":true,"activatedAt":"2020-01-01T00:00:00Z",'
            '"registrationBonus":100,"transactionCommission":1}}', 200);
      }
      if (request.url.path.endsWith('/announcements/active')) {
        return http.Response('{"announcements":[]}', 200);
      }
      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"walletBalance":24500}', 200);
      }
      if (request.url.path.endsWith('/securewave/virtual-account')) {
        return http.Response(
          '{"data":{"virtualAccount":{"status":"ACTIVE",'
          '"accountNumber":"0123456789","accountName":"Ada Okafor",'
          '"bankName":"ServicePay"}}}',
          200,
        );
      }
      return http.Response('{}', 404);
    });
    await tester.pumpWidget(MaterialApp(home: DashboardScreen(client: client)));
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.byKey(const Key('referral-promotion-card')), findsOneWidget);
    expect(find.text('Get ₦100 for each successful referral and ₦1 per eligible transaction.'),
        findsOneWidget);
    double top(Key key) =>
        tester.getTopLeft(find.byKey(key, skipOffstage: false)).dy;
    final wallet = top(const Key('servicepay-wallet-card'));
    final funding = top(const Key('customer-funding-account'));
    final insights = top(const Key('customer-transaction-insights'));
    final services = top(const Key('customer-quick-services'));
    final business = top(const Key('customer-business-hub-entry'));
    final activity = top(const Key('customer-recent-activity'));
    final referral = top(const Key('customer-referral-surface'));
    expect(wallet, lessThan(funding));
    expect(funding, lessThan(services));
    expect(services, lessThan(business));
    expect(business, lessThan(activity));
    expect(activity, lessThan(insights));
    expect(insights, lessThan(referral));
    for (final key in ['customer-quick-services', 'customer-business-hub-entry',
      'customer-recent-activity', 'customer-transaction-insights',
      'customer-referral-surface']) {
      expect(find.byKey(Key(key)), findsOneWidget);
    }
    // Referral is reached only after scrolling on a 390x844 phone.
    expect(referral, greaterThan(844));
    expect(find.text('0123456789'), findsOneWidget);
    expect(requests.every((request) => request.method == 'GET'), isTrue);
    expect(requests.singleWhere((request) =>
        request.url.path.endsWith('/auth/referral')).url.queryParameters['historyLimit'], '1');
    await tester.ensureVisible(find.byKey(const Key('referral-promotion-cta')));
    await tester.tap(find.byKey(const Key('referral-promotion-cta')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(ReferralScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows no-active-promotions only after a successful empty fetch',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'auth_token': 'test-token',
      'wallet_balance': 24500.0,
    });
    final MockClient client = MockClient((http.Request request) async {
      if (request.url.path.endsWith('/announcements/active')) {
        return http.Response('{"announcements":[]}', 200);
      }
      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"walletBalance":24500}', 200);
      }
      if (request.url.path.endsWith('/settings/public')) {
        return http.Response('{"settings":{"services":{}}}', 200);
      }
      return http.Response('{}', 404);
    });

    await tester.pumpWidget(
      MaterialApp(home: DashboardScreen(client: client)),
    );
    for (int index = 0; index < 12; index++) {
      await tester.pump(const Duration(milliseconds: 40));
    }

    expect(find.byKey(const Key('announcement-empty-state')), findsOneWidget);
    expect(find.text('No active promotions'), findsOneWidget);
    expect(find.byKey(const Key('announcement-loading-state')), findsNothing);
    expect(find.byKey(const Key('announcement-error-state')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('announcement fetch failure stays distinct and retry reloads',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'auth_token': 'test-token',
      'wallet_balance': 24500.0,
    });
    int announcementRequests = 0;
    final MockClient client = MockClient((http.Request request) async {
      if (request.url.path.endsWith('/announcements/active')) {
        announcementRequests++;
        return http.Response('{"message":"offline"}', 503);
      }
      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"walletBalance":24500}', 200);
      }
      if (request.url.path.endsWith('/settings/public')) {
        return http.Response('{"settings":{"services":{}}}', 200);
      }
      return http.Response('{}', 404);
    });

    await tester.pumpWidget(
      MaterialApp(home: DashboardScreen(client: client)),
    );
    for (int index = 0; index < 12; index++) {
      await tester.pump(const Duration(milliseconds: 40));
    }

    expect(announcementRequests, 1);
    expect(find.byKey(const Key('announcement-error-state')), findsOneWidget);
    expect(find.text('No active promotions'), findsNothing);
    // The announcement surface now sits below the account and insights cards.
    await tester.ensureVisible(find.byKey(const Key('announcement-error-state')));
    await tester.pump();
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('announcement-error-state')),
        matching: find.text('Retry'),
      ),
    );
    for (int index = 0; index < 12; index++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(announcementRequests, 2);
    expect(find.byKey(const Key('announcement-error-state')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('funding remains without hidden wallet actions on mobile and web',
      (WidgetTester tester) async {
    for (final Size size in <Size>[
      const Size(320, 760),
      const Size(360, 800),
      const Size(390, 844),
      const Size(1440, 1000),
    ]) {
      await tester.binding.setSurfaceSize(size);
      await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
      await tester.pump(const Duration(milliseconds: 100));

      final Finder transfer =
          find.byKey(const Key('dashboard-transfer-action'));
      final Finder withdraw =
          find.byKey(const Key('dashboard-withdraw-action'));
      final Finder addMoney =
          find.byKey(const Key('dashboard-add-money-action'));

      expect(transfer, findsNothing);
      expect(withdraw, findsNothing);
      expect(addMoney, findsOneWidget);
      expect(tester.getSize(addMoney).width, greaterThan(0));
      expect(tester.takeException(), isNull);
    }

    addTearDown(() => tester.binding.setSurfaceSize(null));
  });

  testWidgets('renders real recent activity and unread notifications',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 0.0,
      'auth_token': 'test-token',
    });

    final MockClient client = MockClient((http.Request request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return http.Response(
          '{"settings":{"services":{"airtime":true,"data":true}}}',
          200,
        );
      }

      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"walletBalance":76543.21}', 200);
      }

      if (request.url.path.endsWith('/transactions')) {
        expect(request.url.queryParameters['limit'], '5');
        return http.Response(
          '{"transactions":['
          '{"_id":"tx-2","serviceType":"wallet_funding",'
          '"description":"Wallet top up","amount":5000,'
          '"direction":"CREDIT","status":"COMPLETED",'
          '"createdAt":"2026-08-29T12:00:00.000Z"},'
          '{"_id":"tx-1","serviceType":"data_purchase",'
          '"description":"Mobile data","amount":1250,'
          '"direction":"DEBIT","status":"PENDING",'
          '"createdAt":"2026-08-29T11:00:00.000Z"}'
          ']}',
          200,
        );
      }

      if (request.url.path.endsWith('/notifications')) {
        return http.Response(
          '{"success":true,"notifications":[],"unreadCount":3}',
          200,
        );
      }

      if (request.url.path.endsWith('/delivery/my')) {
        return http.Response(
          '{"deliveries":[{"_id":"delivery-1","status":"IN_TRANSIT",'
          '"packageName":"Office parcel","trackingNumber":"SP-001",'
          '"createdAt":"2026-08-29T12:30:00.000Z"}]}',
          200,
        );
      }

      if (request.url.path.endsWith('/marketplace/orders/mine')) {
        return http.Response('{"orders":[]}', 200);
      }

      if (request.url.path.endsWith('/solar/my-finance') ||
          request.url.path.endsWith('/phone-financing/my-finance')) {
        return http.Response('{"finances":[]}', 200);
      }

      if (request.url.path.endsWith('/empowerment/my-applications')) {
        return http.Response('{"applications":[]}', 200);
      }

      return http.Response('{"message":"Not found"}', 404);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: DashboardScreen(client: client),
      ),
    );

    for (int index = 0; index < 8; index++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.text('₦76,543.21'), findsOneWidget);
    expect(find.byKey(const Key('dashboard-unread-badge')), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Active Services'),
      450,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Active Services'), findsOneWidget);
    expect(
      find.byKey(const Key('dashboard-service-status-delivery')),
      findsOneWidget,
    );
    expect(find.text('Office parcel'), findsOneWidget);
    expect(find.text('IN TRANSIT'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Wallet Funding'),
      450,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Wallet Funding'), findsOneWidget);
    expect(find.text('Wallet top up'), findsOneWidget);
    expect(find.text('+₦5000.00'), findsOneWidget);
    expect(find.text('Data Purchase'), findsOneWidget);
    expect(find.text('Mobile data'), findsOneWidget);
    expect(find.text('-₦1250.00'), findsOneWidget);
    expect(find.text('SUCCESSFUL'), findsOneWidget);
    expect(find.text('PENDING'), findsOneWidget);
    expect(
      find.byKey(const Key('dashboard-see-all-transactions')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'loads activity independently and labels missing financial data honestly',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
      'auth_token': 'test-token',
    });

    final MockClient client = MockClient((http.Request request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return http.Response('{"settings":{"services":{}}}', 200);
      }

      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"message":"Wallet unavailable"}', 503);
      }

      if (request.url.path.endsWith('/transactions')) {
        return http.Response(
          '{"transactions":[{"_id":"tx-incomplete",'
          '"type":"transfer","description":"Pending provider detail",'
          '"createdAt":"2026-08-29T12:00:00.000Z"}]}',
          200,
        );
      }

      if (request.url.path.endsWith('/notifications')) {
        return http.Response(
          '{"success":true,"notifications":[],"unreadCount":4}',
          200,
        );
      }

      if (request.url.path.endsWith('/delivery/my')) {
        return http.Response('{"deliveries":[]}', 200);
      }

      if (request.url.path.endsWith('/marketplace/orders/mine')) {
        return http.Response('{"orders":[]}', 200);
      }

      if (request.url.path.endsWith('/solar/my-finance') ||
          request.url.path.endsWith('/phone-financing/my-finance')) {
        return http.Response('{"finances":[]}', 200);
      }

      if (request.url.path.endsWith('/empowerment/my-applications')) {
        return http.Response('{"applications":[]}', 200);
      }

      return http.Response('{"message":"Not found"}', 404);
    });

    await tester.pumpWidget(
      MaterialApp(home: DashboardScreen(client: client)),
    );

    for (int index = 0; index < 8; index++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.text('₦24,500.00'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Amount unavailable'),
      450,
      scrollable: find.byType(Scrollable).first,
    );

    expect(find.text('Transfer'), findsWidgets);
    expect(find.text('Pending provider detail'), findsOneWidget);
    expect(find.text('Amount unavailable'), findsOneWidget);
    expect(find.text('STATUS UNAVAILABLE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('keeps four customer destinations and hides QR from All Services',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump();

    expect(find.text('Home'), findsOneWidget);
    expect(find.byKey(const Key('customer-navigation-label-1')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('customer-navigation-label-1'))).data, 'History');
    expect(find.text('Wallet'), findsWidgets);
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Scan'), findsNothing);
    expect(
      tester.widget<Text>(find.text('Home')).style?.color,
      CustomerDashboardPalette.serviceCyan,
    );
    expect(tester.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor,
        CustomerDashboardPalette.canvas);
    expect(
        tester
            .widget<Text>(find.byKey(
                const Key('customer-header-avatar-initial')))
            .style
            ?.color,
        CustomerDashboardPalette.text);

    await tester.tap(find.byKey(const Key('customer-navigation-label-1')));
    await tester.pump(const Duration(milliseconds: 100));
    expect(
        tester
            .widget<TransactionsScreen>(find.byType(TransactionsScreen))
            .isActive,
        isTrue);
    await tester.tap(find.text('Home'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(
        tester
            .widget<TransactionsScreen>(
                find.byType(TransactionsScreen, skipOffstage: false))
            .isActive,
        isFalse);

    await tester.ensureVisible(find.byKey(const Key('customer-all-services')));
    await tester.tap(find.byKey(const Key('customer-all-services')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1000));
    expect(tester.widget<Scaffold>(find.byType(Scaffold).last).backgroundColor,
        CustomerDashboardPalette.canvas);
    await tester.enterText(find.byType(TextField).last, 'QR Pay');
    await tester.pump();
    expect(
        find.byWidgetPredicate(
            (widget) => widget is Text && widget.data == 'QR Pay'),
        findsNothing);
    expect(find.text('ServicePay QR Pay'), findsNothing);
    await tester.enterText(find.byType(TextField).last, 'Electricity');
    await tester.pump();
    expect(
        find.byWidgetPredicate(
            (widget) => widget is Text && widget.data == 'Electricity'),
        findsOneWidget);
  });

  testWidgets('balance can be hidden and shown without changing its value',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('₦24,500.00'), findsOneWidget);

    await tester.tap(find.byKey(const Key('dashboard-balance-visibility')));
    await tester.pump();
    expect(find.text('₦ ••••••••'), findsOneWidget);
    expect(find.text('₦24,500.00'), findsNothing);

    await tester.tap(find.byKey(const Key('dashboard-balance-visibility')));
    await tester.pump();
    expect(find.text('₦24,500.00'), findsOneWidget);
  });

  testWidgets('feature settings hide disabled quick services and All Services',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'auth_token': 'dashboard-test-token',
    });
    final MockClient client = MockClient((http.Request request) async {
      if (request.url.path.endsWith('/settings/customer/features')) {
        return http.Response(
          '{"features":['
          '{"key":"DATA","enabled":true,"effectiveEnabled":true,"visible":false},'
          '{"key":"ALL_SERVICES","enabled":true,"effectiveEnabled":true,"visible":false}'
          ']}',
          200,
        );
      }
      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"walletBalance":1234.0}', 200);
      }
      if (request.url.path.endsWith('/transactions')) {
        return http.Response('{"transactions":[]}', 200);
      }
      if (request.url.path.endsWith('/notifications')) {
        return http.Response('{"success":true,"unreadCount":0}', 200);
      }
      return http.Response('{}', 404);
    });

    await tester.pumpWidget(
      MaterialApp(home: DashboardScreen(client: client)),
    );
    for (int index = 0; index < 8; index++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.byKey(const Key('customer-quick-services')), findsOneWidget);
    expect(find.text('Data'), findsNothing);
    expect(find.byKey(const Key('customer-all-services')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows only the assigned funding account and copies its number',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'auth_token': 'dashboard-test-token',
    });
    final MockClient client = MockClient((http.Request request) async {
      if (request.url.path.endsWith('/wallet')) {
        return http.Response('{"walletBalance":1234.0}', 200);
      }
      if (request.url.path.endsWith('/securewave/virtual-account')) {
        return http.Response(
          '{"data":{"virtualAccount":{"status":"ACTIVE",'
          '"accountNumber":"0123456789","accountName":"Ada Okafor",'
          '"bankName":"ServicePay"}}}',
          200,
        );
      }
      if (request.url.path.endsWith('/transactions')) {
        return http.Response('{"transactions":[]}', 200);
      }
      if (request.url.path.endsWith('/notifications')) {
        return http.Response('{"success":true,"unreadCount":0}', 200);
      }
      return http.Response('{}', 404);
    });

    await tester.pumpWidget(
      MaterialApp(home: DashboardScreen(client: client)),
    );
    for (int index = 0; index < 8; index++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.byKey(const Key('customer-funding-account')), findsOneWidget);
    expect(find.text('0123456789'), findsOneWidget);
    expect(find.text('Ada Okafor'), findsOneWidget);
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('customer-copy-account')));
      await Future<void>.delayed(const Duration(milliseconds: 20));
    });
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Account number copied'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final width in <double>[320, 430]) {
    testWidgets('compact account and activity remain readable at $width',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(Size(width, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      SharedPreferences.setMockInitialValues(<String, Object>{
        'user_name': 'Ada Okafor',
        'user_role': 'CUSTOMER',
        'auth_token': 'test-token',
      });
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String?;
          }
          return null;
        },
      );
      addTearDown(() => tester.binding.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/wallet')) {
          return http.Response('{"walletBalance":1234}', 200);
        }
        if (request.url.path.endsWith('/securewave/virtual-account')) {
          return http.Response(
              '{"data":{"virtualAccount":{"status":"ACTIVE",'
              '"accountNumber":"0123456789",'
              '"accountName":"Ada Okafor A Very Long Account Holder Name",'
              '"bankName":"ServicePay Bank"}}}', 200);
        }
        if (request.url.path.endsWith('/transactions')) {
          return http.Response('{"transactions":['
              '{"_id":"latest","serviceType":"data_purchase",'
              '"description":"08012345678","amount":1234567.89,'
              '"direction":"DEBIT","status":"SUCCESS",'
              '"createdAt":"2026-11-23T12:00:00Z"},'
              '{"_id":"older","serviceType":"airtime_purchase",'
              '"description":"08087654321","amount":500,'
              '"direction":"DEBIT","status":"FAILED",'
              '"createdAt":"2026-11-22T11:00:00Z"}]}', 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(
        MaterialApp(home: DashboardScreen(client: client)),
      );
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      final card = find.byKey(const Key('customer-funding-account'));
      expect(tester.getSize(card).height, lessThan(130));
      expect(find.text('0123456789'), findsOneWidget);
      expect(find.text('ServicePay Bank'), findsOneWidget);
      expect(find.text('Ada Okafor A Very Long Account Holder Name'),
          findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('customer-copy-account')));
      await tester.tap(find.byKey(const Key('customer-copy-account')));
      await tester.pump();
      expect(copied, '0123456789');
      await tester.ensureVisible(find.text('Recent Activity'));
      await tester.pump();
      expect(find.text('-₦1234567.89'), findsOneWidget);
      expect(find.text('08012345678'), findsOneWidget);
      expect(find.text('SUCCESSFUL'), findsOneWidget);
      expect(find.text('FAILED'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(
          find.byKey(const Key('dashboard-see-all-transactions')));
      await tester.tap(
          find.byKey(const Key('dashboard-see-all-transactions')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(TransactionsScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
