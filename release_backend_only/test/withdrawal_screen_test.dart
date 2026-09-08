import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/withdrawal_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'withdrawal-test-token',
      'withdrawal_bank_name': 'Saved Test Bank',
      'withdrawal_account_number': '0123456789',
      'withdrawal_account_name': 'Saved Customer',
    });
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    required http.Client client,
  }) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: WithdrawalScreen(client: client),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  http.Response settingsResponse() {
    return http.Response(
      jsonEncode(<String, dynamic>{
        'success': true,
        'settings': <String, dynamic>{
          'transactionLimits': <String, dynamic>{
            'minimumBankTransfer': 100,
            'maximumBankTransfer': 50000,
          },
        },
      }),
      200,
    );
  }

  testWidgets(
    'loads saved bank details and customer withdrawal history',
    (WidgetTester tester) async {
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/settings/public')) {
          return settingsResponse();
        }
        if (request.url.path.endsWith('/transaction-pin/status')) {
          return http.Response(
              '{"success":true,"transactionPinSet":true}', 200);
        }
        if (request.url.path.endsWith('/withdrawals/my')) {
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'withdrawals': <Map<String, dynamic>>[
                <String, dynamic>{
                  '_id': 'withdrawal-1',
                  'reference': 'WDR-TEST-001',
                  'amount': 250,
                  'bankName': 'Saved Test Bank',
                  'accountNumber': '0123456789',
                  'accountName': 'Saved Customer',
                  'status': 'PENDING',
                  'createdAt': '2026-08-26T20:30:00.000Z',
                },
              ],
            }),
            200,
          );
        }
        throw StateError('Unexpected request: ${request.url}');
      });

      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();

      final fields = find.byType(TextField);
      expect(tester.widget<TextField>(fields.at(0)).controller?.text,
          'Saved Test Bank');
      expect(tester.widget<TextField>(fields.at(1)).controller?.text,
          '0123456789');
      expect(tester.widget<TextField>(fields.at(2)).controller?.text,
          'Saved Customer');
      await tester.drag(find.byType(ListView), const Offset(0, -700));
      await tester.pumpAndSettle();
      expect(find.textContaining('WDR-TEST-001'), findsOneWidget);
      expect(find.text('PENDING'), findsOneWidget);
    },
  );

  testWidgets(
    'submits once with an idempotency key and accepts approved history',
    (WidgetTester tester) async {
      final postResponse = Completer<http.Response>();
      var postCount = 0;
      var historyCount = 0;
      String? requestKey;

      final client = MockClient((request) async {
        if (request.url.path.endsWith('/settings/public')) {
          return settingsResponse();
        }
        if (request.url.path.endsWith('/transaction-pin/status')) {
          return http.Response(
              '{"success":true,"transactionPinSet":true}', 200);
        }
        if (request.url.path.endsWith('/withdrawals/my')) {
          historyCount += 1;
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'withdrawals': historyCount > 1
                  ? <Map<String, dynamic>>[
                      <String, dynamic>{
                        '_id': 'withdrawal-2',
                        'reference': 'WDR-TEST-002',
                        'amount': 300,
                        'bankName': 'Saved Test Bank',
                        'accountNumber': '0123456789',
                        'accountName': 'Saved Customer',
                        'status': 'APPROVED',
                      },
                    ]
                  : <Map<String, dynamic>>[],
            }),
            200,
          );
        }
        if (request.method == 'POST' &&
            request.url.path.endsWith('/withdrawals/request')) {
          postCount += 1;
          requestKey = request.headers['Idempotency-Key'];
          expect(jsonDecode(request.body), <String, dynamic>{
            'bankName': 'Saved Test Bank',
            'accountNumber': '0123456789',
            'accountName': 'Saved Customer',
            'amount': 300.0,
            'transactionPin': '1234',
          });
          return postResponse.future;
        }
        throw StateError('Unexpected request: ${request.url}');
      });

      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();

      final fields = find.byType(TextField);
      await tester.enterText(fields.at(3), '300');
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      final submit = find.text('Request Withdrawal');
      await tester.tap(submit);
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).last, '1234');
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await tester.pump();

      expect(find.text('Submitting...'), findsOneWidget);
      expect(postCount, 1);
      expect(requestKey, isNotNull);
      expect(requestKey, startsWith('withdrawal-'));
      await tester.tap(find.text('Submitting...'), warnIfMissed: false);
      await tester.pump();
      expect(postCount, 1);

      postResponse.complete(
        http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'message': 'Withdrawal request submitted for approval.',
            'withdrawal': <String, dynamic>{
              '_id': 'withdrawal-2',
              'reference': 'WDR-TEST-002',
              'amount': 300,
              'status': 'APPROVED',
            },
          }),
          201,
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      expect(postCount, 1);
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      expect(find.textContaining('WDR-TEST-002'), findsOneWidget);
      expect(find.text('APPROVED'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField).at(3)).controller?.text,
        '',
      );
    },
  );

  testWidgets('routes customers without a PIN to Create PIN', (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return settingsResponse();
      }
      if (request.url.path.endsWith('/transaction-pin/status')) {
        return http.Response('{"success":true,"transactionPinSet":false}', 200);
      }
      if (request.url.path.endsWith('/withdrawals/my')) {
        return http.Response('{"success":true,"withdrawals":[]}', 200);
      }
      throw StateError('Unexpected request: ${request.url}');
    });
    await pumpScreen(tester, client: client);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create PIN'));
    await tester.pumpAndSettle();
    expect(find.text('Create Transaction PIN'), findsOneWidget);
  });

  testWidgets('shows wrong PIN server errors and does not mark it successful',
      (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return settingsResponse();
      }
      if (request.url.path.endsWith('/transaction-pin/status')) {
        return http.Response('{"success":true,"transactionPinSet":true}', 200);
      }
      if (request.url.path.endsWith('/withdrawals/my')) {
        return http.Response('{"success":true,"withdrawals":[]}', 200);
      }
      if (request.url.path.endsWith('/withdrawals/request')) {
        return http.Response(
            '{"success":false,"message":"Transaction PIN is incorrect"}', 200);
      }
      throw StateError('Unexpected request: ${request.url}');
    });
    await pumpScreen(tester, client: client);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(3), '300');
    await tester.tap(find.text('Request Withdrawal'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '2580');
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pump();
    expect(find.text('Transaction PIN is incorrect'), findsOneWidget);
  });
}
