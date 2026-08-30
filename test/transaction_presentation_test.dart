import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/transaction_presentation.dart';

void main() {
  test('custom transaction date range includes complete boundary days', () {
    final DateTimeRange range = DateTimeRange(
      start: DateTime(2026, 8, 10),
      end: DateTime(2026, 8, 12),
    );
    expect(
      transactionDateMatchesRange(
        date: DateTime(2026, 8, 10),
        range: 'CUSTOM',
        now: DateTime(2026, 8, 30),
        customRange: range,
      ),
      isTrue,
    );
    expect(
      transactionDateMatchesRange(
        date: DateTime(2026, 8, 12, 23, 59, 59),
        range: 'CUSTOM',
        now: DateTime(2026, 8, 30),
        customRange: range,
      ),
      isTrue,
    );
    expect(
      transactionDateMatchesRange(
        date: DateTime(2026, 8, 13),
        range: 'CUSTOM',
        now: DateTime(2026, 8, 30),
        customRange: range,
      ),
      isFalse,
    );
  });

  group('TransactionPresentation status', () {
    test('normalizes only known status values', () {
      expect(TransactionPresentation({'status': 'successful'}).status,
          'SUCCESSFUL');
      expect(
          TransactionPresentation({'status': 'REFUNDED'}).status, 'REVERSED');
      expect(TransactionPresentation({'status': 'queued_by_provider'}).status,
          'PROCESSING');
      expect(TransactionPresentation({}).status, 'PROCESSING');
    });

    test('does not make an unknown state successful', () {
      final transaction =
          TransactionPresentation({'status': 'awaiting_provider'});
      expect(transaction.status, isNot('SUCCESSFUL'));
    });
  });

  test('search includes recipient, phone, account, service and reference', () {
    final transaction = TransactionPresentation({
      '_id': '66ddcafe',
      'reference': 'SP-12345',
      'serviceType': 'BANK_TRANSFER',
      'fee': 25,
      'totalAmount': 1025,
      'metadata': {
        'providerResponse': {
          'accountName': 'Ada Okafor',
          'accountNumber': '0123456789',
          'recipientPhone': '08031234567',
          'providerReference': 'NIP-7788',
        },
      },
    });

    expect(transaction.lookupId, '66ddcafe');
    expect(transaction.fee, 25);
    expect(transaction.total, 1025);
    expect(
      transaction.details.map((entry) => entry.value),
      containsAll(<String>[
        'Ada Okafor',
        '0123456789',
        'NIP-7788',
        '₦25.00',
        '₦1025.00',
      ]),
    );
    expect(transaction.matchesSearch('ada'), isTrue);
    expect(transaction.matchesSearch('0803'), isTrue);
    expect(transaction.matchesSearch('012345'), isTrue);
    expect(transaction.matchesSearch('bank transfer'), isTrue);
    expect(transaction.matchesSearch('sp-123'), isTrue);
  });

  test('exposes canonical source data for status checks and issue reports', () {
    final transaction = TransactionPresentation({
      'id': 'transaction:66ddcafe',
      'source': 'TRANSACTION',
      'sourceId': '66ddcafe',
      'reference': 'DATA-001',
      'type': 'DATA',
      'counterparty': '08031234567',
      'provider': 'CLUBKONNECT',
    });

    expect(transaction.lookupId, 'transaction:66ddcafe');
    expect(transaction.source, 'TRANSACTION');
    expect(transaction.sourceId, '66ddcafe');
    expect(transaction.recipient, '08031234567');
    expect(transaction.provider, 'CLUBKONNECT');
  });

}
