import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
    });
  });

  testWidgets('shows the premium customer dashboard essentials',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('ServicePay'), findsOneWidget);
    expect(find.text('Simple. Secure. Instant.'), findsOneWidget);
    expect(find.text('Ada'), findsOneWidget);
    expect(find.byKey(const Key('dashboard-refresh-tool')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-history-tool')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-help-tool')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-settings-tool')), findsOneWidget);
    expect(find.text('Available Balance'), findsOneWidget);
    expect(find.text('Transfer'), findsOneWidget);
    expect(find.text('Withdraw'), findsOneWidget);
    expect(find.text('Fund Wallet'), findsNothing);
    expect(find.text('Wallet Funding'), findsNothing);
    expect(find.text('QR Pay'), findsOneWidget);

    await tester.tap(find.byKey(const Key('dashboard-refresh-tool')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('dashboard-refresh-tool')));
    await tester.pump();

    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('Invite & Earn'),
      450,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Invite & Earn'), findsOneWidget);

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

  testWidgets('keeps the customer QR scan route in main navigation',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Transactions'), findsOneWidget);
    expect(find.text('Wallet'), findsWidgets);
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Scan'), findsOneWidget);

    final Finder qrNavigation = find.byKey(const Key('customer-qr-navigation'));
    expect(qrNavigation, findsOneWidget);
    await tester.tap(qrNavigation);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    expect(find.text('ServicePay QR Pay'), findsOneWidget);
  });
}
