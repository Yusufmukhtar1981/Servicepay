import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/customer_notification_settings.dart';

void main() {
  group('customer notification settings contract', () {
    test('GET and PATCH use only the documented settings fields', () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'settings': <String, dynamic>{
              'dashboardBackground':
                  request.method == 'PATCH' ? 'default' : 'green',
              'soundNotifications': request.method == 'PATCH',
              'voiceAnnouncements': false,
            },
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });
      final api = CustomerNotificationSettingsApi(
        client: client,
        baseUrl: 'https://api.test/api',
        readToken: () async => 'session-token',
      );

      final initial = await api.load();
      expect(initial.dashboardBackground, 'green');
      final updated = await api.update(<String, dynamic>{
        'dashboardBackground': 'default',
      });

      expect(updated.dashboardBackground, 'default');
      expect(
          requests.map((request) => request.method), <String>['GET', 'PATCH']);
      expect(requests.first.url.path, '/api/notifications/customer-settings');
      expect(requests.first.headers['authorization'], 'Bearer session-token');
      expect(jsonDecode(requests.last.body), <String, dynamic>{
        'dashboardBackground': 'default',
      });
      api.close();
    });

    test('wallet alert claim posts an empty object and validates NGN response',
        () async {
      late http.Request captured;
      final api = CustomerNotificationSettingsApi(
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'settings': <String, dynamic>{
                'dashboardBackground': 'green',
                'soundNotifications': false,
                'voiceAnnouncements': false,
              },
              'alert': <String, dynamic>{
                'id': 'ledger-123',
                'amount': 3800.5,
                'currency': 'NGN',
                'reference': 'TRF-731',
                'createdAt': '2025-05-12T10:30:00.000Z',
                'balance': 8000.5,
                'creditBalance': 3800.5,
              },
              'retryAfterSeconds': 20,
            }),
            200,
          );
        }),
        baseUrl: 'https://api.test/api',
        readToken: () async => 'session-token',
      );

      final alert = await api.claimNextAlert();
      expect(captured.url.path, '/api/notifications/wallet-credit-alerts/next');
      expect(captured.method, 'POST');
      expect(captured.body, '{}');
      expect(alert?.id, 'ledger-123');
      expect(alert?.amount, 3800.5);
      api.close();
    });

    test('handoff uses bundled preferences without a second request', () async {
      var requests = 0;
      final api = CustomerNotificationSettingsApi(
        client: MockClient((request) async {
          requests++;
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'settings': <String, dynamic>{
                'dashboardBackground': 'default',
                'soundNotifications': true,
                'voiceAnnouncements': true,
              },
              'alert': <String, dynamic>{
                'id': 'ledger-bundled',
                'amount': 725,
                'currency': 'NGN',
                'reference': 'reference-bundled',
                'createdAt': '2025-05-12T10:30:00.000Z',
                'balance': 1400,
                'creditBalance': 725,
              },
              'retryAfterSeconds': 20,
            }),
            200,
          );
        }),
        baseUrl: 'https://api.test/api',
        readToken: () async => 'session-token',
      );
      final handoff = await api.claimNextHandoff();
      expect(requests, 1);
      expect(handoff.settings.dashboardBackground, 'default');
      expect(handoff.settings.soundNotifications, isTrue);
      expect(handoff.alert?.id, 'ledger-bundled');
      api.close();
    });

    test('rejects invalid money, empty id, and empty reference values',
        () async {
      final common = <String, dynamic>{
        'id': 'ledger',
        'amount': 1.0,
        'currency': 'NGN',
        'reference': 'reference',
        'createdAt': '2025-05-12T10:30:00.000Z',
        'balance': 2.0,
        'creditBalance': 1.0,
      };
      expect(
        () => WalletCreditAlert.fromJson(<String, dynamic>{
          ...common,
          'amount': double.infinity,
        }),
        throwsA(isA<CustomerSettingsException>()),
      );
      expect(
        () => WalletCreditAlert.fromJson(<String, dynamic>{
          ...common,
          'balance': -1,
        }),
        throwsA(isA<CustomerSettingsException>()),
      );
      expect(
        () => WalletCreditAlert.fromJson(<String, dynamic>{
          ...common,
          'id': '  ',
        }),
        throwsA(isA<CustomerSettingsException>()),
      );
      expect(
        () => WalletCreditAlert.fromJson(<String, dynamic>{
          ...common,
          'reference': ' ',
        }),
        throwsA(isA<CustomerSettingsException>()),
      );
    });

    test('PATCH rejects unknown keys before sending a request', () async {
      var requested = false;
      final api = CustomerNotificationSettingsApi(
        client: MockClient((_) async {
          requested = true;
          return http.Response('{}', 200);
        }),
        readToken: () async => 'session-token',
      );
      await expectLater(
        api.update(<String, dynamic>{'walletBalance': 100}),
        throwsArgumentError,
      );
      expect(requested, isFalse);
      api.close();
    });
  });
}
