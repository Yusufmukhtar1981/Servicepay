import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
// ignore: depend_on_referenced_packages
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';

import 'package:servicepay_app/withdrawal_screen.dart';

class _OptimisticPendingWriteFailureStore
    extends SharedPreferencesStorePlatform {
  _OptimisticPendingWriteFailureStore({
    required this.delegate,
    required this.pendingKey,
    required this.shouldThrow,
  });

  final SharedPreferencesStorePlatform delegate;
  final String pendingKey;
  final bool shouldThrow;

  @override
  Future<bool> setValue(String valueType, String key, Object value) async {
    if (key.endsWith(pendingKey)) {
      if (shouldThrow) throw StateError('simulated platform persistence error');
      return false;
    }
    return delegate.setValue(valueType, key, value);
  }

  @override
  Future<bool> remove(String key) => delegate.remove(key);

  @override
  Future<bool> clear() => delegate.clear();

  @override
  Future<Map<String, Object>> getAll() => delegate.getAll();
}

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
    Future<bool> Function(String key, String value)? pendingIntentWriter,
  }) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: WithdrawalScreen(
          client: client,
          pendingIntentWriter: pendingIntentWriter,
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Future<void> requestWithdrawal(
    WidgetTester tester,
    String amount,
  ) async {
    await tester.enterText(find.byType(TextField).at(3), amount);
    await tester.drag(find.byType(ListView).first, const Offset(0, -550));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request Withdrawal'));
    await tester.pumpAndSettle();
    if (find.byType(AlertDialog).evaluate().isNotEmpty) {
      await tester.enterText(find.byType(TextField).last, '1234');
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await tester.pumpAndSettle();
    }
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

  http.Response profileResponse({
    String id = 'customer-withdrawal-test',
    num walletBalance = 10000,
    num walletHeldBalance = 4000,
  }) {
    return http.Response(
      jsonEncode(<String, dynamic>{
        'success': true,
        'user': <String, dynamic>{
          '_id': id,
          'walletBalance': walletBalance,
          'walletHeldBalance': walletHeldBalance,
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
        if (request.url.path.endsWith('/auth/profile')) {
          expect(
              request.headers['Authorization'], 'Bearer withdrawal-test-token');
          return profileResponse();
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
        if (request.url.path.endsWith('/auth/profile')) {
          expect(
              request.headers['Authorization'], 'Bearer withdrawal-test-token');
          return profileResponse();
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
          expect(
              request.headers['Authorization'], 'Bearer withdrawal-test-token');
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
      expect(requestKey, hasLength(32));
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

  testWidgets(
    'persists uncertain attempt, reuses its key, and blocks changed intent',
    (tester) async {
      final keys = <String>[];
      var postCount = 0;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/settings/public')) {
          return settingsResponse();
        }
        if (request.url.path.endsWith('/auth/profile')) {
          expect(
              request.headers['Authorization'],
              anyOf('Bearer withdrawal-test-token',
                  'Bearer withdrawal-relogin-token'));
          return profileResponse();
        }
        if (request.url.path.endsWith('/transaction-pin/status')) {
          return http.Response(
            '{"success":true,"transactionPinSet":true}',
            200,
          );
        }
        if (request.url.path.endsWith('/withdrawals/my')) {
          return http.Response('{"success":true,"withdrawals":[]}', 200);
        }
        if (request.method == 'POST' &&
            request.url.path.endsWith('/withdrawals/request')) {
          postCount += 1;
          expect(
            request.headers['Authorization'],
            postCount == 1
                ? 'Bearer withdrawal-test-token'
                : 'Bearer withdrawal-relogin-token',
          );
          keys.add(request.headers['Idempotency-Key']!);
          if (postCount == 1) {
            return http.Response(
              '{"success":false,"message":"service unavailable"}',
              503,
            );
          }
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'withdrawal': <String, dynamic>{'_id': 'withdrawal-retry'},
            }),
            201,
          );
        }
        throw StateError('Unexpected request: ${request.url}');
      });

      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();
      await requestWithdrawal(tester, '300');
      await tester.pumpAndSettle();
      expect(postCount, 1);
      final prefs = await SharedPreferences.getInstance();
      final storageKey =
          'customer_withdrawal_pending_intent_v1_customer-withdrawal-test';
      final persisted = prefs.getString(storageKey)!;
      expect(persisted, contains(keys.single));
      expect(persisted, isNot(contains('Saved Test Bank')));
      expect(persisted, isNot(contains('0123456789')));
      expect(persisted, isNot(contains('Saved Customer')));

      await prefs.setString('auth_token', 'withdrawal-relogin-token');
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('A previous withdrawal is unresolved'),
        findsOneWidget,
      );

      await requestWithdrawal(tester, '301');
      await tester.pumpAndSettle();
      expect(postCount, 1);
      expect(
        find.textContaining('A previous withdrawal is still unresolved'),
        findsOneWidget,
      );

      await requestWithdrawal(tester, '300');
      await tester.pumpAndSettle();
      expect(postCount, 2);
      expect(keys.last, keys.first);
      expect(prefs.getString(storageKey), isNull);
    },
  );

  testWidgets(
    'timeout replays the same key despite the first request reducing balance',
    (tester) async {
      final neverCompletes = Completer<http.Response>();
      final keys = <String>[];
      var postCount = 0;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/settings/public')) {
          return settingsResponse();
        }
        if (request.url.path.endsWith('/auth/profile')) {
          return profileResponse(
            walletBalance: postCount == 0 ? 10000 : 0,
            walletHeldBalance: postCount == 0 ? 4000 : 0,
          );
        }
        if (request.url.path.endsWith('/transaction-pin/status')) {
          return http.Response(
            '{"success":true,"transactionPinSet":true}',
            200,
          );
        }
        if (request.url.path.endsWith('/withdrawals/my')) {
          return http.Response('{"success":true,"withdrawals":[]}', 200);
        }
        if (request.method == 'POST' &&
            request.url.path.endsWith('/withdrawals/request')) {
          postCount += 1;
          keys.add(request.headers['Idempotency-Key']!);
          if (postCount == 1) return neverCompletes.future;
          return http.Response(
            '{"success":true,"withdrawal":{"_id":"timeout-replay"}}',
            201,
          );
        }
        throw StateError('Unexpected request: ${request.url}');
      });

      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(3), '300');
      await tester.drag(find.byType(ListView).first, const Offset(0, -550));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Request Withdrawal'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '1234');
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await tester.pump();
      expect(postCount, 1);
      await tester.pump(const Duration(seconds: 31));
      await tester.pumpAndSettle();
      expect(find.textContaining('request timed out'), findsOneWidget);

      final prefs = await SharedPreferences.getInstance();
      final storageKey =
          'customer_withdrawal_pending_intent_v1_customer-withdrawal-test';
      expect(prefs.getString(storageKey), contains(keys.single));

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();
      await requestWithdrawal(tester, '300');
      await tester.pumpAndSettle();

      expect(postCount, 2);
      expect(keys[1], keys[0]);
      expect(prefs.getString(storageKey), isNull);
    },
  );

  testWidgets('pending idempotency state is isolated by authenticated profile',
      (tester) async {
    const oldCustomerId = 'prior-customer';
    const oldRequestKey = 'prior-customer-request-key';
    const bank = 'Saved Test Bank';
    const accountNumber = '0123456789';
    const accountName = 'Saved Customer';
    const amount = 300.0;
    final normalizedIntent = jsonEncode(<String>[
      bank,
      accountNumber,
      accountName,
      amount.toStringAsFixed(2),
    ]);
    final otherCustomerIntent = <String, String>{
      'customerId': oldCustomerId,
      'requestKey': oldRequestKey,
      'intentHash': sha256.convert(utf8.encode(normalizedIntent)).toString(),
    };
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'withdrawal-test-token',
      'withdrawal_bank_name': bank,
      'withdrawal_account_number': accountNumber,
      'withdrawal_account_name': accountName,
      'customer_withdrawal_pending_intent_v1_$oldCustomerId':
          jsonEncode(otherCustomerIntent),
    });

    String? postedKey;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return settingsResponse();
      }
      if (request.url.path.endsWith('/auth/profile')) {
        expect(
          request.headers['Authorization'],
          'Bearer withdrawal-test-token',
        );
        return profileResponse(id: 'current-customer');
      }
      if (request.url.path.endsWith('/transaction-pin/status')) {
        return http.Response(
          '{"success":true,"transactionPinSet":true}',
          200,
        );
      }
      if (request.url.path.endsWith('/withdrawals/my')) {
        return http.Response('{"success":true,"withdrawals":[]}', 200);
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/withdrawals/request')) {
        postedKey = request.headers['Idempotency-Key'];
        return http.Response(
          '{"success":true,"withdrawal":{"_id":"new-customer-withdrawal"}}',
          201,
        );
      }
      throw StateError('Unexpected request: ${request.url}');
    });

    await pumpScreen(tester, client: client);
    await tester.pumpAndSettle();
    await requestWithdrawal(tester, '300');
    await tester.pumpAndSettle();

    expect(postedKey, isNotNull);
    expect(postedKey, isNot(oldRequestKey));
    final prefs = await SharedPreferences.getInstance();
    expect(
      jsonDecode(prefs
          .getString('customer_withdrawal_pending_intent_v1_$oldCustomerId')!),
      otherCustomerIntent,
    );
  });

  testWidgets('available withdrawal funds exclude held wallet balance',
      (tester) async {
    final attemptedAmounts = <double>[];

    Future<void> checkBalance({
      required num walletBalance,
      required num walletHeldBalance,
      required String amount,
      required bool shouldSubmit,
    }) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'withdrawal-test-token',
        'withdrawal_bank_name': 'Saved Test Bank',
        'withdrawal_account_number': '0123456789',
        'withdrawal_account_name': 'Saved Customer',
      });
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/settings/public')) {
          return settingsResponse();
        }
        if (request.url.path.endsWith('/auth/profile')) {
          return profileResponse(
            walletBalance: walletBalance,
            walletHeldBalance: walletHeldBalance,
          );
        }
        if (request.url.path.endsWith('/transaction-pin/status')) {
          return http.Response(
            '{"success":true,"transactionPinSet":true}',
            200,
          );
        }
        if (request.url.path.endsWith('/withdrawals/my')) {
          return http.Response('{"success":true,"withdrawals":[]}', 200);
        }
        if (request.method == 'POST' &&
            request.url.path.endsWith('/withdrawals/request')) {
          attemptedAmounts.add(
            (jsonDecode(request.body) as Map)['amount'] as double,
          );
          return http.Response(
            '{"success":true,"withdrawal":{"_id":"balance-withdrawal"}}',
            201,
          );
        }
        throw StateError('Unexpected request: ${request.url}');
      });
      final attemptedBefore = attemptedAmounts.length;
      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();
      final available =
          (walletBalance - walletHeldBalance).clamp(0, double.infinity);
      expect(
        find.text('Available to withdraw: ₦${available.toStringAsFixed(2)}'),
        findsOneWidget,
      );
      await requestWithdrawal(tester, amount);
      await tester.pumpAndSettle();
      expect(
        attemptedAmounts.length > attemptedBefore,
        shouldSubmit,
        reason: 'wallet balance=$walletBalance, held=$walletHeldBalance, '
            'requested=$amount',
      );
      if (!shouldSubmit) {
        expect(find.textContaining('Your available wallet balance is ₦'),
            findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    }

    await checkBalance(
      walletBalance: 10000,
      walletHeldBalance: 4000,
      amount: '6000',
      shouldSubmit: true,
    );
    expect(attemptedAmounts, <double>[6000.0]);
    await checkBalance(
      walletBalance: 10000,
      walletHeldBalance: 4000,
      amount: '6001',
      shouldSubmit: false,
    );
    await checkBalance(
      walletBalance: 4000,
      walletHeldBalance: 4000,
      amount: '100',
      shouldSubmit: false,
    );
    expect(attemptedAmounts, <double>[6000.0]);
  });

  testWidgets('definitive validation rejection clears the pending key',
      (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return settingsResponse();
      }
      if (request.url.path.endsWith('/auth/profile')) {
        return profileResponse();
      }
      if (request.url.path.endsWith('/transaction-pin/status')) {
        return http.Response(
          '{"success":true,"transactionPinSet":true}',
          200,
        );
      }
      if (request.url.path.endsWith('/withdrawals/my')) {
        return http.Response('{"success":true,"withdrawals":[]}', 200);
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/withdrawals/request')) {
        return http.Response(
          '{"success":false,"message":"Invalid withdrawal amount"}',
          400,
        );
      }
      throw StateError('Unexpected request: ${request.url}');
    });
    await pumpScreen(tester, client: client);
    await tester.pumpAndSettle();
    await requestWithdrawal(tester, '300');
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getString(
        'customer_withdrawal_pending_intent_v1_customer-withdrawal-test',
      ),
      isNull,
    );
    expect(find.text('Invalid withdrawal amount'), findsOneWidget);
  });

  testWidgets(
    'history acknowledgement blocks retry until explicit New Withdrawal',
    (tester) async {
      const oldKey = 'already-committed-key';
      const customerId = 'customer-withdrawal-test';
      const accountNumber = '0123456789';
      const bank = 'Saved Test Bank';
      const accountName = 'Saved Customer';
      const amount = 300.0;
      final intent = jsonEncode(<String>[
        bank,
        accountNumber,
        accountName,
        amount.toStringAsFixed(2),
      ]);
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'withdrawal-test-token',
        'withdrawal_bank_name': bank,
        'withdrawal_account_number': accountNumber,
        'withdrawal_account_name': accountName,
        'customer_withdrawal_pending_intent_v1_$customerId': jsonEncode(
          <String, String>{
            'customerId': customerId,
            'requestKey': oldKey,
            'intentHash': sha256.convert(utf8.encode(intent)).toString(),
          },
        ),
      });

      var postCount = 0;
      String? newKey;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/settings/public')) {
          return settingsResponse();
        }
        if (request.url.path.endsWith('/auth/profile')) {
          return profileResponse(id: customerId);
        }
        if (request.url.path.endsWith('/transaction-pin/status')) {
          return http.Response(
            '{"success":true,"transactionPinSet":true}',
            200,
          );
        }
        if (request.url.path.endsWith('/withdrawals/my')) {
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'withdrawals': <Map<String, dynamic>>[
                <String, dynamic>{
                  '_id': 'history-ack-id',
                  'reference': 'WDR-HISTORY-ACK',
                  'idempotencyKey': oldKey,
                  'amount': amount,
                  'status': 'PENDING',
                },
              ],
            }),
            200,
          );
        }
        if (request.method == 'POST' &&
            request.url.path.endsWith('/withdrawals/request')) {
          postCount += 1;
          newKey = request.headers['Idempotency-Key'];
          return http.Response(
            '{"success":true,"withdrawal":{"_id":"new-explicit-withdrawal"}}',
            201,
          );
        }
        throw StateError('Unexpected request: ${request.url}');
      });

      await pumpScreen(tester, client: client);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('already in history (WDR-HISTORY-ACK)'),
        findsOneWidget,
      );
      expect(find.text('New Withdrawal'), findsOneWidget);

      await requestWithdrawal(tester, '300');
      await tester.pumpAndSettle();
      expect(postCount, 0);

      await tester.tap(find.text('New Withdrawal'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField).at(3)).controller?.text,
        '',
      );
      await requestWithdrawal(tester, '300');
      await tester.pumpAndSettle();
      expect(postCount, 1);
      expect(newKey, isNot(oldKey));
    },
  );

  testWidgets('failed pending-key persistence resets UI and prevents PIN/post',
      (tester) async {
    var allowPersistence = false;
    var postCount = 0;
    Future<bool> writer(String key, String value) async {
      if (!allowPersistence) return false;
      return (await SharedPreferences.getInstance()).setString(key, value);
    }

    final client = MockClient((request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return settingsResponse();
      }
      if (request.url.path.endsWith('/auth/profile')) {
        return profileResponse();
      }
      if (request.url.path.endsWith('/transaction-pin/status')) {
        return http.Response(
          '{"success":true,"transactionPinSet":true}',
          200,
        );
      }
      if (request.url.path.endsWith('/withdrawals/my')) {
        return http.Response('{"success":true,"withdrawals":[]}', 200);
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/withdrawals/request')) {
        postCount += 1;
        return http.Response(
          '{"success":true,"withdrawal":{"_id":"persist-recovery"}}',
          201,
        );
      }
      throw StateError('Unexpected request: ${request.url}');
    });

    await pumpScreen(
      tester,
      client: client,
      pendingIntentWriter: writer,
    );
    await tester.pumpAndSettle();
    await requestWithdrawal(tester, '300');
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Request Withdrawal'), findsOneWidget);
    expect(
        find.textContaining('Unable to save a safe retry key'), findsOneWidget);
    expect(postCount, 0);

    allowPersistence = true;
    await requestWithdrawal(tester, '300');
    await tester.pumpAndSettle();
    expect(postCount, 1);
  });

  testWidgets(
    're-persists cached retry key before PIN after platform false or throw',
    (tester) async {
      for (final shouldThrow in <bool>[false, true]) {
        SharedPreferences.setMockInitialValues(<String, Object>{
          'auth_token': 'withdrawal-test-token',
          'withdrawal_bank_name': 'Saved Test Bank',
          'withdrawal_account_number': '0123456789',
          'withdrawal_account_name': 'Saved Customer',
        });
        final prefs = await SharedPreferences.getInstance();
        final backingStore = SharedPreferencesStorePlatform.instance;
        const storageKey =
            'customer_withdrawal_pending_intent_v1_customer-withdrawal-test';
        var postCount = 0;
        String? postedKey;
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/settings/public')) {
            return settingsResponse();
          }
          if (request.url.path.endsWith('/auth/profile')) {
            return profileResponse();
          }
          if (request.url.path.endsWith('/transaction-pin/status')) {
            return http.Response(
              '{"success":true,"transactionPinSet":true}',
              200,
            );
          }
          if (request.url.path.endsWith('/withdrawals/my')) {
            return http.Response('{"success":true,"withdrawals":[]}', 200);
          }
          if (request.method == 'POST' &&
              request.url.path.endsWith('/withdrawals/request')) {
            postCount += 1;
            postedKey = request.headers['Idempotency-Key'];
            return http.Response(
              '{"success":true,"withdrawal":{"_id":"platform-recovery"}}',
              201,
            );
          }
          throw StateError('Unexpected request: ${request.url}');
        });

        await pumpScreen(tester, client: client);
        await tester.pumpAndSettle();
        SharedPreferencesStorePlatform.instance =
            _OptimisticPendingWriteFailureStore(
          delegate: backingStore,
          pendingKey: storageKey,
          shouldThrow: shouldThrow,
        );

        await requestWithdrawal(tester, '300');
        expect(find.byType(AlertDialog), findsNothing);
        expect(postCount, 0);
        final optimisticValue = prefs.getString(storageKey)!;
        final optimisticIntent =
            jsonDecode(optimisticValue) as Map<String, dynamic>;
        final optimisticKey = optimisticIntent['requestKey'];
        expect(
          await backingStore.getAll(),
          isNot(contains('flutter.$storageKey')),
        );

        // The cache still exposes the failed write. A restored retry must try
        // to persist that exact key again before showing PIN or posting.
        await requestWithdrawal(tester, '300');
        expect(find.byType(AlertDialog), findsNothing);
        expect(postCount, 0);
        expect(
          (jsonDecode(prefs.getString(storageKey)!) as Map)['requestKey'],
          optimisticKey,
        );

        SharedPreferencesStorePlatform.instance = backingStore;
        await requestWithdrawal(tester, '300');
        await tester.pumpAndSettle();
        expect(postCount, 1);
        expect(postedKey, optimisticKey);
        expect(prefs.getString(storageKey), isNull);

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
    },
  );

  testWidgets('routes customers without a PIN to Create PIN', (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/settings/public')) {
        return settingsResponse();
      }
      if (request.url.path.endsWith('/auth/profile')) {
        expect(
            request.headers['Authorization'], 'Bearer withdrawal-test-token');
        return profileResponse();
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
      if (request.url.path.endsWith('/auth/profile')) {
        expect(
            request.headers['Authorization'], 'Bearer withdrawal-test-token');
        return profileResponse();
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
    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getString(
        'customer_withdrawal_pending_intent_v1_customer-withdrawal-test',
      ),
      isNotNull,
    );
  });
}
