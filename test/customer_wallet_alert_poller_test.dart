import 'dart:convert';
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/customer_notification_settings.dart';
import 'package:servicepay_app/services/customer_wallet_alert_poller.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('poller hands off one alert and stops its timer in background',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    var handoffs = 0;
    final api = CustomerNotificationSettingsApi(
      client: MockClient((request) async {
        if (request.method == 'POST') {
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'settings': <String, dynamic>{
                'dashboardBackground': 'green',
                'soundNotifications': false,
                'voiceAnnouncements': false,
              },
              'alert': <String, dynamic>{
                'id': 'ledger-one',
                'amount': 12,
                'currency': 'NGN',
                'reference': 'ref-one',
                'createdAt': '2025-01-01T00:00:00.000Z',
                'balance': 42,
                'creditBalance': 12,
              },
              'retryAfterSeconds': 20,
            }),
            200,
          );
        }
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'settings': <String, dynamic>{
              'dashboardBackground': 'green',
              'soundNotifications': false,
              'voiceAnnouncements': false,
            },
          }),
          200,
        );
      }),
      readToken: () async => 'account-a',
    );
    final poller = CustomerWalletAlertPoller(
      api: api,
      minimumInterval: const Duration(seconds: 20),
      isSessionValid: () async => true,
      onAlert: (_, __) async => handoffs++,
    )..start();

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 5));
    expect(handoffs, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(seconds: 21));
    expect(handoffs, 1);

    poller.dispose();
    api.close();
  });

  testWidgets('stale account session is stopped before claiming',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    var requests = 0;
    final api = CustomerNotificationSettingsApi(
      client: MockClient((_) async {
        requests++;
        return http.Response('{}', 200);
      }),
      readToken: () async => 'old-session',
    );
    final poller = CustomerWalletAlertPoller(
      api: api,
      onAlert: (_, __) async {},
      isSessionValid: () async => false,
    )..start();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));
    expect(requests, 0);
    expect(poller.isRunning, isFalse);
    poller.dispose();
    api.close();
  });

  testWidgets('does not start polling while lifecycle is paused',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    var requests = 0;
    final api = CustomerNotificationSettingsApi(
      client: MockClient((_) async {
        requests++;
        return emptyHandoffResponse();
      }),
      readToken: () async => 'customer',
    );
    final poller = CustomerWalletAlertPoller(
      api: api,
      onAlert: (_, __) async {},
    )..start();
    await tester.pump(const Duration(seconds: 2));
    expect(requests, 0);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump(const Duration(milliseconds: 1));
    expect(requests, 1);
    poller.dispose();
    api.close();
  });

  testWidgets('pause and resume never overlaps a pending request',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    final firstResponse = Completer<http.Response>();
    var requestCount = 0;
    var activeRequests = 0;
    var maximumActiveRequests = 0;
    final api = CustomerNotificationSettingsApi(
      client: MockClient((_) async {
        requestCount++;
        activeRequests++;
        if (activeRequests > maximumActiveRequests) {
          maximumActiveRequests = activeRequests;
        }
        final response = requestCount == 1
            ? await firstResponse.future
            : emptyHandoffResponse();
        activeRequests--;
        return response;
      }),
      readToken: () async => 'customer',
    );
    final poller = CustomerWalletAlertPoller(
      api: api,
      onAlert: (_, __) async {},
    )..start();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));
    expect(requestCount, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(const Duration(seconds: 1));
    expect(requestCount, 1);
    firstResponse.complete(emptyHandoffResponse());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));
    expect(requestCount, 2);
    expect(maximumActiveRequests, 1);
    poller.dispose();
    api.close();
  });

  testWidgets('covered dashboard route pauses claims until visible',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    var routeVisible = false;
    var requests = 0;
    final api = CustomerNotificationSettingsApi(
      client: MockClient((_) async {
        requests++;
        return emptyHandoffResponse();
      }),
      readToken: () async => 'customer',
    );
    final poller = CustomerWalletAlertPoller(
      api: api,
      minimumInterval: const Duration(seconds: 20),
      isRouteVisible: () => routeVisible,
      onAlert: (_, __) async {},
    )..start();
    await tester.pump();
    await tester.pump(const Duration(seconds: 45));
    expect(requests, 0);
    routeVisible = true;
    await tester.pump(const Duration(seconds: 20));
    await tester.pump(const Duration(milliseconds: 1));
    expect(requests, greaterThanOrEqualTo(1));
    poller.dispose();
    api.close();
  });
}

http.Response emptyHandoffResponse() => http.Response(
      jsonEncode(<String, dynamic>{
        'success': true,
        'settings': <String, dynamic>{
          'dashboardBackground': 'green',
          'soundNotifications': false,
          'voiceAnnouncements': false,
        },
        'alert': null,
        'retryAfterSeconds': 20,
      }),
      200,
    );
