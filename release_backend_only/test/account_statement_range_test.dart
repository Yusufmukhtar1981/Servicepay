import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/account_statement_screen.dart';

AccountStatementTransaction transactionAt(DateTime occurredAt) {
  return AccountStatementTransaction(
    reference: occurredAt.toIso8601String(),
    description: 'Authoritative transaction',
    amount: '100.00',
    occurredAt: occurredAt,
    status: 'SUCCESSFUL',
    direction: StatementDirection.debit,
  );
}

void main() {
  final DateTime now = DateTime(2026, 8, 30, 12);

  for (final ({StatementPeriod period, int days}) preset in <({
    StatementPeriod period,
    int days,
  })>[
    (period: StatementPeriod.sevenDays, days: 7),
    (period: StatementPeriod.thirtyDays, days: 30),
  ]) {
    test('${preset.days}-day statement includes the complete first day', () {
      final DateTime firstDay = DateTime(2026, 8, 30).subtract(
        Duration(days: preset.days - 1),
      );
      final DateTimeRange range = accountStatementRange(
        period: preset.period,
        now: now,
      );
      final List<AccountStatementTransaction> filtered =
          filterStatementTransactions(
        transactions: <AccountStatementTransaction>[
          transactionAt(firstDay),
          transactionAt(firstDay.add(const Duration(hours: 12))),
          transactionAt(
            firstDay.add(
              const Duration(hours: 23, minutes: 59, seconds: 59),
            ),
          ),
          transactionAt(firstDay.subtract(const Duration(microseconds: 1))),
        ],
        range: range,
      );

      expect(range.start, firstDay);
      expect(filtered, hasLength(3));
    });
  }

  test('custom statement includes the complete first and last days', () {
    final DateTime firstDay = DateTime(2026, 8, 10);
    final DateTime lastDay = DateTime(2026, 8, 12);
    final DateTimeRange range = accountStatementRange(
      period: StatementPeriod.custom,
      now: now,
      customRange: DateTimeRange(start: firstDay, end: lastDay),
    );
    final List<AccountStatementTransaction> filtered =
        filterStatementTransactions(
      transactions: <AccountStatementTransaction>[
        transactionAt(firstDay),
        transactionAt(firstDay.add(const Duration(hours: 12))),
        transactionAt(
          firstDay.add(
            const Duration(hours: 23, minutes: 59, seconds: 59),
          ),
        ),
        transactionAt(
          lastDay.add(
            const Duration(hours: 23, minutes: 59, seconds: 59),
          ),
        ),
      ],
      range: range,
    );

    expect(range.start, firstDay);
    expect(filtered, hasLength(4));
  });
}
