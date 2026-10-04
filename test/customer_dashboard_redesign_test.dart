import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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
    expect(find.text('Transfer'), findsOneWidget);
    expect(find.text('Withdrawal'), findsOneWidget);
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

  testWidgets('keeps wallet actions in one equal row on mobile',
      (WidgetTester tester) async {
    for (final Size size in <Size>[
      const Size(360, 800),
      const Size(390, 844),
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

      expect(tester.getCenter(transfer).dy, tester.getCenter(withdraw).dy);
      expect(tester.getCenter(withdraw).dy, tester.getCenter(addMoney).dy);
      expect(tester.getSize(transfer).width, tester.getSize(withdraw).width);
      expect(tester.getSize(withdraw).width, tester.getSize(addMoney).width);
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

  testWidgets(
      'keeps customer navigation to four fixed destinations and QR in All Services',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump();

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Transactions'), findsOneWidget);
    expect(find.text('Wallet'), findsWidgets);
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Scan'), findsNothing);

    await tester.tap(find.text('Transactions'));
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
    await tester.enterText(find.byType(TextField).last, 'QR Pay');
    await tester.pump();
    await tester.ensureVisible(find.text('QR Pay').last);
    await tester.tap(find.text('QR Pay').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('ServicePay QR Pay'), findsOneWidget);
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
}
