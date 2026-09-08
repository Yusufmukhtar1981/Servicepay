import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/qr_pay_screen.dart';
import 'package:servicepay_app/servicepay_transfer_helper.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'test-token',
    });
  });

  Future<void> pumpSheet(
    WidgetTester tester, {
    required http.Client client,
    Duration timeout = const Duration(seconds: 30),
    VoidCallback? onViewTransaction,
    Size size = const Size(390, 844),
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: QrPaymentSheet(
            receiverId: 'receiver-id',
            receiverName: 'Amina Yusuf',
            receiverPhone: '08012345678',
            client: client,
            requestTimeout: timeout,
            onViewTransaction: onViewTransaction,
          ),
        ),
      ),
    );
    await tester.pump();
  }

  Future<void> submitPayment(WidgetTester tester) async {
    final Finder fields = find.byType(TextField);
    await tester.enterText(fields.at(0), '2500');
    await tester.enterText(fields.at(1), '1234');
    await tester.tap(find.byKey(const Key('qr-payment-submit')));
    await tester.pump();
  }

  testWidgets(
    'locks immediately, retains the PIN, and ignores repeated taps',
    (WidgetTester tester) async {
      final Completer<http.Response> response = Completer<http.Response>();
      int requests = 0;
      final MockClient client = MockClient((http.Request request) async {
        requests += 1;
        return response.future;
      });

      await pumpSheet(tester, client: client);
      await submitPayment(tester);

      expect(find.text('Processing Payment...'), findsOneWidget);
      expect(find.byKey(const Key('qr-payment-processing')), findsOneWidget);
      expect(
        tester
            .widget<ElevatedButton>(
              find.byKey(const Key('qr-payment-submit')),
            )
            .onPressed,
        isNull,
      );
      final TextField pinField = tester.widget<TextField>(
        find.byType(TextField).at(1),
      );
      expect(pinField.controller?.text, '1234');

      await tester.tap(find.byKey(const Key('qr-payment-submit')));
      await tester.pump();
      expect(requests, 1);

      response.complete(
        http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'status': 'SUCCESSFUL',
              'reference': 'SPT-QR-001',
              'amount': 2500,
              'createdAt': '2026-08-26T20:30:00.000Z',
              'sender': <String, dynamic>{
                'walletBalance': 17500,
              },
              'receiver': <String, dynamic>{
                'fullName': 'Amina Yusuf',
              },
            },
          }),
          200,
        ),
      );
      await tester.pump();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('PAYMENT SUCCESSFUL'), findsOneWidget);
    },
  );

  testWidgets(
    'shows a detailed success receipt and opens transaction history',
    (WidgetTester tester) async {
      bool viewedTransaction = false;
      final MockClient client = MockClient((http.Request request) async {
        expect(request.headers['Idempotency-Key'], startsWith('SPC-'));
        expect(request.body, isNot(contains('transactionPin')));
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['receiverPhone'], '08012345678');
        expect(body['amount'], 2500.0);
        expect(body['pin'], '1234');
        expect(body['clientReference'], request.headers['Idempotency-Key']);

        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'status': 'SUCCESSFUL',
              'reference': 'SPT-QR-RECEIPT',
              'amount': 2500,
              'createdAt': '2026-08-26T20:30:00.000Z',
              'sender': <String, dynamic>{
                'walletBalance': 17500,
              },
              'receiver': <String, dynamic>{
                'fullName': 'Amina Yusuf',
              },
              'receipt': <String, dynamic>{
                'reference': 'SPT-QR-RECEIPT',
                'beneficiaryName': 'Amina Yusuf',
                'createdAt': '2026-08-26T20:30:00.000Z',
              },
            },
          }),
          200,
        );
      });

      await pumpSheet(
        tester,
        client: client,
        onViewTransaction: () {
          viewedTransaction = true;
        },
      );
      await submitPayment(tester);
      await tester.pump();

      expect(find.text('PAYMENT SUCCESSFUL'), findsOneWidget);
      expect(find.text('₦2500.00'), findsOneWidget);
      expect(find.text('Amina Yusuf'), findsOneWidget);
      expect(find.text('08012345678'), findsOneWidget);
      expect(find.text('SPT-QR-RECEIPT'), findsOneWidget);
      expect(find.text('₦17500.00'), findsOneWidget);
      expect(find.text('DONE'), findsOneWidget);
      expect(find.text('VIEW TRANSACTION'), findsOneWidget);

      final SharedPreferences preferences =
          await SharedPreferences.getInstance();
      expect(preferences.getDouble('wallet_balance'), 17500);

      await tester.tap(
        find.byKey(const Key('qr-payment-view-transaction')),
      );
      await tester.pump();
      expect(viewedTransaction, isTrue);
    },
  );

  testWidgets(
    'shows pending state without an endless spinner',
    (WidgetTester tester) async {
      final MockClient client = MockClient((http.Request request) async {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'status': 'PROCESSING',
            },
          }),
          202,
        );
      });

      await pumpSheet(tester, client: client);
      await submitPayment(tester);
      await tester.pump();

      expect(find.text('PAYMENT PROCESSING'), findsOneWidget);
      expect(find.text('Payment is being confirmed.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('CHECK STATUS'), findsOneWidget);
    },
  );

  testWidgets(
    'does not show success for an ambiguous 2xx response',
    (WidgetTester tester) async {
      final MockClient client = MockClient((http.Request request) async {
        return http.Response('{}', 200);
      });

      await pumpSheet(tester, client: client);
      await submitPayment(tester);
      await tester.pump();

      expect(find.text('PAYMENT SUCCESSFUL'), findsNothing);
      expect(find.text('PAYMENT PROCESSING'), findsOneWidget);
      expect(find.text('Payment is being confirmed.'), findsOneWidget);
    },
  );

  testWidgets(
    'honors a nested backend rejection in a 2xx response',
    (WidgetTester tester) async {
      final MockClient client = MockClient((http.Request request) async {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'data': <String, dynamic>{
              'success': false,
              'message': 'Payment authorization was rejected.',
            },
          }),
          200,
        );
      });

      await pumpSheet(tester, client: client);
      await submitPayment(tester);
      await tester.pump();

      expect(find.text('PAYMENT SUCCESSFUL'), findsNothing);
      expect(find.text('PAYMENT NOT COMPLETED'), findsOneWidget);
      expect(
        find.text('Payment authorization was rejected.'),
        findsOneWidget,
      );
    },
  );

  for (final MapEntry<String, String> rejection in <String, String>{
    'Incorrect transaction PIN.': 'Incorrect transaction PIN.',
    'Your wallet balance is insufficient for this transfer.':
        'Your wallet balance is insufficient for this transfer.',
  }.entries) {
    testWidgets(
      'shows backend rejection: ${rejection.key}',
      (WidgetTester tester) async {
        final MockClient client = MockClient((http.Request request) async {
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': false,
              'message': rejection.value,
            }),
            400,
          );
        });

        await pumpSheet(tester, client: client);
        await submitPayment(tester);
        await tester.pump();

        expect(find.text('PAYMENT NOT COMPLETED'), findsOneWidget);
        expect(find.text(rejection.value), findsOneWidget);
        expect(find.text('TRY AGAIN'), findsOneWidget);
      },
    );
  }

  testWidgets(
    'shows a readable network failure',
    (WidgetTester tester) async {
      final MockClient client = MockClient((http.Request request) async {
        throw http.ClientException('offline');
      });

      await pumpSheet(tester, client: client);
      await submitPayment(tester);
      await tester.pump();

      expect(find.text('PAYMENT PROCESSING'), findsOneWidget);
      expect(find.text('Payment is being confirmed.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    },
  );

  testWidgets(
    'times out into a safe retry state on small Android layouts',
    (WidgetTester tester) async {
      final Completer<http.Response> response = Completer<http.Response>();
      int postRequests = 0;
      int statusRequests = 0;
      final MockClient client = MockClient((http.Request request) async {
        if (request.method == 'POST') {
          postRequests += 1;
          return response.future;
        }
        expect(request.method, 'GET');
        expect(request.url.path,
            '/api/transfer/servicepay/status/${request.url.pathSegments.last}');
        statusRequests += 1;
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{'status': 'PENDING'},
          }),
          200,
        );
      });

      await pumpSheet(
        tester,
        client: client,
        timeout: const Duration(milliseconds: 100),
        size: const Size(320, 640),
      );
      await submitPayment(tester);
      await tester.pump(const Duration(milliseconds: 150));

      expect(find.text('PAYMENT PROCESSING'), findsOneWidget);
      expect(find.text('Payment is being confirmed.'), findsOneWidget);
      expect(find.text('CHECK STATUS'), findsOneWidget);
      expect(postRequests, 1);
      expect(statusRequests, 3);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'keeps the payment form usable on desktop web widths',
    (WidgetTester tester) async {
      final MockClient client = MockClient((http.Request request) async {
        return http.Response('{}', 500);
      });

      await pumpSheet(
        tester,
        client: client,
        size: const Size(1280, 800),
      );

      expect(find.text('Amina Yusuf'), findsOneWidget);
      expect(find.text('Continue Payment'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'restores a pending QR intent after restart and rechecks without posting',
    (WidgetTester tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'test-token',
        'user_id': 'sender-1',
        'user_phone': '08000000000',
      });
      final prefs = await SharedPreferences.getInstance();
      await savePendingServicePayTransfer(
        prefs,
        PendingServicePayTransfer(
          reference: 'SPC-restored-reference',
          idempotencyKey: 'SPC-restored-reference',
          receiverPhone: '08012345678',
          amount: 2500,
          flowType: 'qr',
          createdAt: DateTime(2026, 1, 1),
        ),
      );
      int posts = 0;
      int gets = 0;
      final client = MockClient((request) async {
        if (request.method == 'POST') posts += 1;
        if (request.method == 'GET') {
          gets += 1;
          expect(request.url.path,
              '/api/transfer/servicepay/status/SPC-restored-reference');
          return http.Response(jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'status': 'SUCCESS',
              'reference': 'SPC-restored-reference',
              'amount': 2500,
            },
          }), 200);
        }
        throw StateError('unexpected request');
      });

      await pumpSheet(tester, client: client);
      await tester.pump();
      await tester.pump();

      expect(posts, 0);
      expect(gets, 1);
      expect(find.text('PAYMENT SUCCESSFUL'), findsOneWidget);
    },
  );

  testWidgets(
    'QrPayScreen recovers before scanning and uses status receipt identity',
    (WidgetTester tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'test-token',
        'user_id': 'sender-1',
        'user_phone': '08000000000',
      });
      final prefs = await SharedPreferences.getInstance();
      await savePendingServicePayTransfer(
        prefs,
        PendingServicePayTransfer(
          reference: 'SPC-parent-recovery',
          idempotencyKey: 'SPC-parent-recovery',
          receiverPhone: '08012345678',
          amount: 2500,
          flowType: 'qr',
          createdAt: DateTime.now(),
        ),
      );
      int posts = 0;
      int gets = 0;
      final client = MockClient((request) async {
        if (request.method == 'POST') posts += 1;
        if (request.method == 'GET') {
          gets += 1;
          expect(request.url.path,
              '/api/transfer/servicepay/status/SPC-parent-recovery');
          return http.Response(jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'status': 'SUCCESS',
              'reference': 'SPC-parent-recovery',
              'amount': 2500,
              'receiver': <String, dynamic>{
                'fullName': 'Authoritative Status Recipient',
                'phone': '08012345678',
              },
            },
          }), 200);
        }
        throw StateError('unexpected request');
      });
      await tester.pumpWidget(MaterialApp(home: QrPayScreen(client: client)));
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(posts, 0);
      expect(gets, 1);
      expect(find.text('Authoritative Status Recipient'), findsOneWidget);
      // Recovery sheet is modal, so no scanner route/payment POST can occur.
      expect(find.text('Scan ServicePay QR'), findsNothing);
    },
  );

  testWidgets(
    'backdated QR intent remains pending through 404s and only rechecks GET',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'test-token',
        'user_id': 'sender-1',
        'user_phone': '08000000000',
      });
      final prefs = await SharedPreferences.getInstance();
      await savePendingServicePayTransfer(
        prefs,
        PendingServicePayTransfer(
          reference: 'SPC-old-delayed-post',
          idempotencyKey: 'stable-old-key',
          receiverPhone: '08012345678',
          amount: 2500,
          flowType: 'qr',
          createdAt: DateTime.utc(2020, 1, 1),
        ),
      );
      int posts = 0;
      int gets = 0;
      final client = MockClient((request) async {
        if (request.method == 'POST') {
          posts += 1;
          throw StateError('a recovery flow must never POST');
        }
        gets += 1;
        expect(request.method, 'GET');
        expect(request.url.path,
            '/api/transfer/servicepay/status/SPC-old-delayed-post');
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': false,
            'message': 'Reference not found',
          }),
          404,
        );
      });

      await tester.pumpWidget(MaterialApp(home: QrPayScreen(client: client)));
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(find.text('PAYMENT PROCESSING'), findsOneWidget);
      expect(find.text('CHECK STATUS'), findsOneWidget);
      expect(posts, 0);
      expect(gets, 3);

      tester
          .widget<ElevatedButton>(
              find.byKey(const Key('qr-payment-retry')))
          .onPressed!
          .call();
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('PAYMENT PROCESSING'), findsOneWidget);
      expect(posts, 0);
      expect(gets, 6);
      final retained =
          restorePendingServicePayTransfer(prefs, flowType: 'qr');
      expect(retained?.reference, 'SPC-old-delayed-post');
      expect(retained?.idempotencyKey, 'stable-old-key');
    },
  );
}
