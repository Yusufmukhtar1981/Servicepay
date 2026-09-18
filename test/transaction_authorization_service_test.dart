import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/transaction_authorization_service.dart';

void main() {
  test('intent hash is stable and excludes transaction secrets', () {
    final first = TransactionAuthorizationService.intentHash(
      operation: 'transfer',
      idempotencyKey: 'abc',
      body: {
        'meta': {
          'a': [2, {'b': true}],
        },
        'amount': 10,
        'transactionPin': '0000',
      },
    );
    final second = TransactionAuthorizationService.intentHash(
      operation: 'transfer',
      idempotencyKey: 'abc',
      body: {
        'amount': 10,
        'meta': {
          'a': [2, {'b': true}],
        },
        'biometricGrant': 'one-time-grant',
      },
    );
    expect(first, second);
    expect(
      first,
      '1494750a9aad427fdc0a45252b1836f85e0cc13716907e3585817aa572a487f2',
    );
  });

  test('intent hash excludes independently bound request metadata', () {
    final first = TransactionAuthorizationService.intentHash(
      operation: 'transfer',
      idempotencyKey: 'abc',
      body: {'amount': 10},
    );
    final second = TransactionAuthorizationService.intentHash(
      operation: 'transfer',
      idempotencyKey: 'abc',
      body: {
        'amount': 10,
        'idempotencyKey': 'different',
        'deviceId': 'different-device',
      },
    );
    expect(first, second);
  });
}