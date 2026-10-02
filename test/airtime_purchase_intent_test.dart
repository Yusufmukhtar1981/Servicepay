import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/airtime_screen.dart';

class _MemoryIntentStorage implements AirtimePurchaseIntentStorage {
  final Map<String, String> entries = <String, String>{};
  int failedWritesRemaining = 0;
  int writeAttempts = 0;

  @override
  Future<String?> read(String key) async => entries[key];

  @override
  Future<void> write(String key, String value) async {
    writeAttempts++;
    if (failedWritesRemaining > 0) {
      failedWritesRemaining--;
      throw StateError('Unable to persist the request key.');
    }
    entries[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    entries.remove(key);
  }
}

void main() {
  AirtimePurchaseIntent createIntent(_MemoryIntentStorage storage) =>
      AirtimePurchaseIntent(storage: storage);

  Future<Map<String, dynamic>> unresolvedResult({
    int httpStatus = 202,
    String status = 'PENDING',
  }) async =>
      <String, dynamic>{
        'success': false,
        'status': status,
        'httpStatus': httpStatus,
      };

  test(
    'a failed key write blocks dispatch and the retry persists before dispatch',
    () async {
      final storage = _MemoryIntentStorage()..failedWritesRemaining = 1;
      final intent = createIntent(storage);
      var dispatchCount = 0;

      await expectLater(
        intent.submit(
          network: 'MTN',
          phone: '08012345678',
          amount: '100',
          dispatch: (key) async {
            dispatchCount++;
            expect(storage.entries.values.single, contains(key));
            return <String, dynamic>{
              'success': true,
              'status': 'SUCCESSFUL',
              'accountingStatus': 'COMPLETE',
              'reference': 'airtime-reference-1',
              'httpStatus': 200,
            };
          },
        ),
        throwsStateError,
      );

      expect(dispatchCount, 0);
      expect(storage.writeAttempts, 1);

      await intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100.00',
        dispatch: (key) async {
          dispatchCount++;
          expect(storage.entries.values.single, contains(key));
          return <String, dynamic>{
            'success': true,
            'status': 'SUCCESSFUL',
            'accountingStatus': 'COMPLETE',
            'reference': 'airtime-reference-1',
            'httpStatus': 200,
          };
        },
      );

      expect(dispatchCount, 1);
      expect(storage.writeAttempts, 2);
      expect(storage.entries, isEmpty);
    },
  );

  test('duplicate submissions use the same persisted key', () async {
    final intent = createIntent(_MemoryIntentStorage());
    final dispatchedKeys = <String>[];

    Future<Map<String, dynamic>> dispatch(String key) async {
      dispatchedKeys.add(key);
      return unresolvedResult();
    }

    final results = await Future.wait([
      intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100',
        dispatch: dispatch,
      ),
      intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100',
        dispatch: dispatch,
      ),
    ]);

    expect(results, hasLength(2));
    expect(dispatchedKeys, hasLength(2));
    expect(dispatchedKeys[0], dispatchedKeys[1]);
    expect(
      dispatchedKeys.first,
      matches(RegExp(r'^airtime-[A-Za-z0-9_-]{32}$')),
    );
  });

  test('fingerprints canonicalize money, network and phone', () async {
    final storage = _MemoryIntentStorage();
    final intent = createIntent(storage);
    final keys = <String>[];

    for (final payload in <(String, String, String)>[
      ('MTN', '08012345678', '100'),
      (' mtn ', ' 080 12345678 ', '00100.0'),
    ]) {
      await intent.submit(
        network: payload.$1,
        phone: payload.$2,
        amount: payload.$3,
        dispatch: (key) async {
          keys.add(key);
          return unresolvedResult();
        },
      );
    }

    expect(keys[1], keys[0]);
    expect(
      AirtimePurchaseIntent.formatAmountCents(
        AirtimePurchaseIntent.amountInCents('100')!,
      ),
      '100.00',
    );
    expect(AirtimePurchaseIntent.amountInCents('100.001'), isNull);
  });

  test('timeouts retain a key and are never automatically retried', () async {
    final intent = createIntent(_MemoryIntentStorage());
    var dispatchCount = 0;
    String? firstKey;

    await expectLater(
      intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100',
        dispatch: (key) async {
          dispatchCount++;
          firstKey = key;
          throw TimeoutException('Ambiguous outcome');
        },
      ),
      throwsA(isA<TimeoutException>()),
    );

    expect(dispatchCount, 1);
    final key = await intent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      amount: '100',
    );
    expect(key, firstKey);
    expect(dispatchCount, 1);
  });

  test(
    'HTTP 202 and pending or unknown responses retain the same key',
    () async {
      final intent = createIntent(_MemoryIntentStorage());
      final keys = <String>[];

      for (final result in <Map<String, dynamic>>[
        <String, dynamic>{
          'success': false,
          'httpStatus': 202,
          'status': 'PENDING',
        },
        <String, dynamic>{
          'success': true,
          'httpStatus': 202,
          'status': 'UNKNOWN',
        },
        <String, dynamic>{
          'success': false,
          'httpStatus': 200,
          'status': 'UNKNOWN',
        },
      ]) {
        await intent.submit(
          network: 'Airtel',
          phone: '08098765432',
          amount: '250',
          dispatch: (key) async {
            keys.add(key);
            return result;
          },
        );
      }

      expect(keys, hasLength(3));
      expect(keys.toSet(), hasLength(1));
    },
  );

  test(
    'a changed payload is blocked until the unresolved purchase is terminal',
    () async {
      final intent = createIntent(_MemoryIntentStorage());
      late String original;
      await intent.submit(
        network: 'Glo',
        phone: '08012345678',
        amount: '100',
        dispatch: (key) async {
          original = key;
          return unresolvedResult();
        },
      );

      var dispatchCount = 1;
      Future<void> expectChangedPayloadBlocked({
        String network = 'Glo',
        String phone = '08012345678',
        String amount = '200',
      }) async {
        await expectLater(
          intent.submit(
            network: network,
            phone: phone,
            amount: amount,
            dispatch: (_) async {
              dispatchCount++;
              return unresolvedResult();
            },
          ),
          throwsStateError,
        );
      }

      await expectChangedPayloadBlocked(amount: '200');
      await expectChangedPayloadBlocked(phone: '08098765432');
      await expectChangedPayloadBlocked(network: 'Airtel');
      expect(dispatchCount, 1);

      expect(
        await intent.keyForSubmission(
          network: 'Glo',
          phone: '08012345678',
          amount: '100.00',
        ),
        original,
      );

      await intent.submit(
        network: 'Glo',
        phone: '08012345678',
        amount: '100.0',
        dispatch: (_) async => <String, dynamic>{
          'success': false,
          'status': 'FAILED',
          'dispatchStatus': 'REFUNDED',
          'accountingStatus': 'NOT_DUE',
          'reference': 'airtime-reference-2',
          'httpStatus': 200,
        },
      );

      expect(
        await intent.keyForSubmission(
          network: 'Glo',
          phone: '08012345678',
          amount: '200',
        ),
        isNot(original),
      );
    },
  );

  test('generic 4xx, network and unbound results never clear a key', () async {
    final intent = createIntent(_MemoryIntentStorage());
    final submittedKeys = <String>[];

    for (final result in <Map<String, dynamic>>[
      <String, dynamic>{
        'success': false,
        'httpStatus': 400,
        'status': 'FAILED',
        'reference': 'untrusted-400-reference',
      },
      <String, dynamic>{
        'success': false,
        'httpStatus': 404,
        'status': 'FAILED',
        'reference': 'untrusted-404-reference',
      },
      <String, dynamic>{
        'success': false,
        'httpStatus': 408,
        'status': 'FAILED',
        'reference': 'gateway-timeout-reference',
      },
      <String, dynamic>{
        'success': false,
        'httpStatus': 429,
        'status': 'RATE_LIMITED',
      },
      <String, dynamic>{
        'success': false,
        'httpStatus': 500,
        'status': 'FAILED',
        'reference': 'untrusted-500-reference',
      },
      <String, dynamic>{
        'success': true,
        'httpStatus': 200,
      },
      <String, dynamic>{
        'success': false,
        'httpStatus': 0,
        'status': 'NETWORK_ERROR',
      },
    ]) {
      await intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100',
        dispatch: (key) async {
          submittedKeys.add(key);
          return result;
        },
      );
    }

    expect(submittedKeys, hasLength(7));
    expect(submittedKeys.toSet(), hasLength(1));
  });

  testWidgets(
    'status check explicitly requeries a pending key and retains HTTP 202',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'test-session-token',
      });
      final storage = _MemoryIntentStorage();
      final intent = createIntent(storage);
      var purchaseDispatches = 0;

      await intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100',
        dispatch: (_) async {
          purchaseDispatches++;
          return unresolvedResult();
        },
      );
      final pendingKey = await intent.pendingKey();
      expect(pendingKey, isNotNull);

      final requests = <http.Request>[];
      await http.runWithClient(
        () async {
          await tester.pumpWidget(
            MaterialApp(
              home: AirtimeScreen(purchaseIntent: intent),
            ),
          );
          await tester.pumpAndSettle();

          expect(
            requests.where(
              (request) => request.url.path.endsWith(
                '/clubkonnect/airtime/requery',
              ),
            ),
            isEmpty,
            reason: 'A pending purchase must not trigger an automatic requery.',
          );
          expect(find.text('Check previous request'), findsOneWidget);

          await tester.tap(find.text('Check previous request'));
          await tester.pumpAndSettle();

          final requeryRequests = requests
              .where(
                (request) => request.url.path.endsWith(
                  '/clubkonnect/airtime/requery',
                ),
              )
              .toList();
          expect(requeryRequests, hasLength(1));
          expect(requeryRequests.single.method, 'POST');
          expect(
            jsonDecode(requeryRequests.single.body),
            <String, dynamic>{'idempotencyKey': pendingKey},
          );
          expect(
            requests.where(
              (request) => request.url.path.endsWith('/clubkonnect/airtime'),
            ),
            isEmpty,
            reason: 'Checking status must not dispatch a paid airtime request.',
          );
          expect(purchaseDispatches, 1);
          expect(await intent.pendingKey(), pendingKey);
          expect(find.textContaining('not confirmed yet'), findsOneWidget);
        },
        () => http_testing.MockClient((request) async {
          requests.add(request);
          if (request.url.path.endsWith('/customer/beneficiaries')) {
            return http.Response(
              jsonEncode(<String, dynamic>{'beneficiaries': <Object>[]}),
              200,
            );
          }
          if (request.url.path.endsWith('/clubkonnect/airtime/requery')) {
            return http.Response(
              jsonEncode(<String, dynamic>{
                'success': false,
                'status': 'PENDING',
                'message': 'The request is still processing.',
              }),
              202,
            );
          }
          return http.Response('{}', 500);
        }),
      );
    },
  );

  testWidgets(
    'SUCCESS waits for accounting completion and requery recovers charge data',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'test-session-token',
      });
      final storage = _MemoryIntentStorage();
      final intent = createIntent(storage);
      var purchaseDispatches = 0;

      final initialResult = <String, dynamic>{
        'success': true,
        'status': 'SUCCESSFUL',
        'accountingStatus': 'PENDING',
        'reference': 'airtime-accounting-reference',
        'httpStatus': 200,
      };
      final result = await intent.submit(
        network: 'MTN',
        phone: '08012345678',
        amount: '100',
        dispatch: (_) async {
          purchaseDispatches++;
          return initialResult;
        },
      );

      expect(intent.isTerminalResult(result), isFalse);
      expect(intent.isDeliveredAccountingPending(result), isTrue);
      final pendingKey = await intent.pendingKey();
      expect(pendingKey, isNotNull);

      final requests = <http.Request>[];
      await http.runWithClient(
        () async {
          await tester.pumpWidget(
            MaterialApp(
              home: AirtimeScreen(purchaseIntent: intent),
            ),
          );
          await tester.pumpAndSettle();

          expect(find.text('Check previous request'), findsOneWidget);
          expect(
            requests.where(
              (request) => request.url.path.endsWith(
                '/clubkonnect/airtime/requery',
              ),
            ),
            isEmpty,
          );

          await tester.tap(find.text('Check previous request'));
          await tester.pumpAndSettle();

          final requeryRequests = requests
              .where(
                (request) => request.url.path.endsWith(
                  '/clubkonnect/airtime/requery',
                ),
              )
              .toList();
          expect(requeryRequests, hasLength(1));
          expect(
            jsonDecode(requeryRequests.single.body),
            <String, dynamic>{'idempotencyKey': pendingKey},
          );
          expect(
            requests.where(
              (request) => request.url.path.endsWith('/clubkonnect/airtime'),
            ),
            isEmpty,
            reason: 'Accounting recovery must not buy airtime again.',
          );
          expect(purchaseDispatches, 1);
          expect(await intent.pendingKey(), isNull);
          expect(find.text('Check previous request'), findsNothing);
          expect(
            find.textContaining('Amount charged: ₦93.75'),
            findsOneWidget,
          );
        },
        () => http_testing.MockClient((request) async {
          requests.add(request);
          if (request.url.path.endsWith('/customer/beneficiaries')) {
            return http.Response(
              jsonEncode(<String, dynamic>{'beneficiaries': <Object>[]}),
              200,
            );
          }
          if (request.url.path.endsWith('/clubkonnect/airtime/requery')) {
            return http.Response(
              jsonEncode(<String, dynamic>{
                'success': true,
                'status': 'SUCCESS',
                'accountingStatus': 'COMPLETE',
                'amountCharged': '93.75',
                'reference': 'airtime-accounting-reference',
              }),
              200,
            );
          }
          return http.Response('{}', 500);
        }),
      );
    },
  );
}
