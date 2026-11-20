import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/customer_transaction_insights.dart';

void main() {
  final now = DateTime.utc(2026, 11, 18, 12);
  final weekly = InsightsWindow.at(CustomerInsightsPeriod.weekly, now);
  Map<String, dynamic> row(String id, String status, String at, num amount,
          {String source = 'TRANSACTION',
          String? ref,
          String? transactionId}) =>
      {
        'id': id,
        'source': source,
        'sourceId': id,
        'reference': ref ?? id,
        'transactionId': transactionId ?? id,
        'status': status,
        'createdAt': at,
        'amount': amount,
        'type': 'DATA'
      };

  test('weekly compares equal elapsed portions of consecutive Monday weeks',
      () {
    expect(weekly.start, DateTime.utc(2026, 11, 16));
    expect(weekly.previousStart, DateTime.utc(2026, 11, 9));
    expect(weekly.previousEnd, DateTime.utc(2026, 11, 11, 12));
    expect(weekly.end.difference(weekly.start),
        weekly.previousEnd.difference(weekly.previousStart));
  });
  test('monthly compares the same elapsed portion, not the whole prior month',
      () {
    final month = InsightsWindow.at(CustomerInsightsPeriod.monthly, now);
    expect(month.start, DateTime.utc(2026, 11));
    expect(month.previousStart, DateTime.utc(2026, 10));
    expect(month.previousEnd, DateTime.utc(2026, 10, 18, 12));
    expect(month.previousCapped, isFalse);
  });
  test('shorter preceding month is honestly capped at its end', () {
    final month = InsightsWindow.at(
        CustomerInsightsPeriod.monthly, DateTime.utc(2026, 3, 31, 12));
    expect(month.previousStart, DateTime.utc(2026, 2));
    expect(month.previousEnd, DateTime.utc(2026, 3));
    expect(month.previousCapped, isTrue);
  });
  test('leap year, year rollover and first instant of period are valid', () {
    final leap = InsightsWindow.at(
        CustomerInsightsPeriod.monthly, DateTime.utc(2024, 3, 30));
    expect(leap.previousEnd, DateTime.utc(2024, 3));
    final year = InsightsWindow.at(
        CustomerInsightsPeriod.monthly, DateTime.utc(2026, 1));
    expect(year.previousStart, DateTime.utc(2025, 12));
    expect(year.previousEnd, year.previousStart);
  });
  test('half-open boundaries exclude future rows and previous-period excess',
      () {
    final data = CustomerTransactionInsights.fromRows([
      row('start', 'SUCCESSFUL', '2026-11-16T00:00:00Z', 5),
      row('end', 'SUCCESSFUL', '2026-11-18T12:00:00Z', 100),
      row('future', 'SUCCESSFUL', '2026-11-19T00:00:00Z', 100),
      row('prior', 'FAILED', '2026-11-09T00:00:00Z', 7),
      row('excess', 'SUCCESSFUL', '2026-11-11T12:00:00Z', 100),
    ], weekly);
    expect(data.current.totalCount, 1);
    expect(data.current.totalValue, 5);
    expect(data.previous.totalCount, 1);
    expect(data.previous.totalValue, 7);
  });
  test('all seven metrics use actual statuses and compensated recorded amounts',
      () {
    final data = CustomerTransactionInsights.fromRows([
      row('a', 'SUCCESSFUL', '2026-11-17T01:00:00Z', 100.1),
      row('b', 'COMPLETED', '2026-11-17T02:00:00Z', 0.2),
      row('c', 'DECLINED', '2026-11-17T03:00:00Z', 20),
      row('d', 'PENDING', '2026-11-17T04:00:00Z', 30),
      row('e', 'UNRECOGNIZED', '2026-11-17T05:00:00Z', 40),
      row('f', 'REFUNDED', '2026-11-17T06:00:00Z', 50),
    ], weekly);
    expect(data.current.totalCount, 6);
    expect(data.current.successfulCount, 2);
    expect(data.current.declinedCount, 1);
    expect(data.current.pendingCount, 2);
    expect(data.current.otherCount, 1);
    expect(data.current.totalValue, closeTo(240.3, 1e-10));
    expect(data.current.successfulValue, closeTo(100.3, 1e-10));
    expect(data.current.declinedValue, 20);
  });
  test('daily buckets include empty days but never future days', () {
    final data = CustomerTransactionInsights.fromRows([
      row('a', 'SUCCESSFUL', '2026-11-17T01:00:00Z', 55),
    ], weekly);
    expect(data.buckets.length, 3);
    expect(data.buckets.map((e) => e.totals.totalCount), [0, 1, 0]);
    expect(data.buckets[1].totals.successfulValue, 55);
  });
  test('monthly daily buckets sum exactly to selected-period totals', () {
    final month = InsightsWindow.at(CustomerInsightsPeriod.monthly, now);
    final data = CustomerTransactionInsights.fromRows([
      row('a', 'SUCCESSFUL', '2026-11-01T01:00:00Z', 50),
      row('b', 'FAILED', '2026-11-18T01:00:00Z', 10),
    ], month);
    expect(data.buckets.length, 18);
    expect(data.buckets.fold<int>(0, (n, b) => n + b.totals.totalCount), 2);
    expect(data.buckets.fold<double>(0, (n, b) => n + b.totals.totalValue), 60);
  });
  test('count/value/success/decline growth uses the immediately prior window',
      () {
    final data = CustomerTransactionInsights.fromRows([
      row('a', 'SUCCESSFUL', '2026-11-17T01:00:00Z', 100),
      row('b', 'FAILED', '2026-11-17T02:00:00Z', 50),
      row('c', 'SUCCESSFUL', '2026-11-10T01:00:00Z', 50),
    ], weekly);
    expect(data.countGrowth.percent, 100);
    expect(data.valueGrowth.percent, 200);
    expect(data.successfulGrowth.percent, 0);
    expect(data.declinedGrowth.percent, isNull);
    expect(const InsightGrowth(5, 10).percent, -50);
  });
  test('no previous activity never invents percentage growth', () {
    expect(const InsightGrowth(10, 0).percent, isNull);
    expect(const InsightGrowth(0, 0).percent, isNull);
    final empty = CustomerTransactionInsights.fromRows([], weekly);
    expect(empty.current.totalCount, 0);
    expect(empty.current.totalValue, 0);
    expect(empty.declined, isEmpty);
  });
  test('overlapping pages and cross-page source wrappers are not counted twice',
      () {
    final original =
        row('a', 'FAILED', '2026-11-17T01:00:00Z', 100, ref: 'REF-A');
    final data = CustomerTransactionInsights.fromRows([
      row('ledger-a', 'SUCCESSFUL', '2026-11-17T02:00:00Z', 100,
          source: 'LEDGER', ref: 'REF-A', transactionId: 'a'),
      row('transfer-a', 'SUCCESSFUL', '2026-11-17T02:00:00Z', 100,
          source: 'TRANSFER', ref: 'REF-A'),
      original,
      original,
      row('b', 'SUCCESSFUL', '2026-11-17T01:00:00Z', 100),
    ], weekly);
    expect(data.current.totalCount, 2);
    expect(data.current.declinedCount, 1);
    expect(data.current.successfulCount, 1);
  });
  test(
      'declined list is newest first, with original references and safe reasons',
      () {
    final data = CustomerTransactionInsights.fromRows([
      {
        ...row('a', 'FAILED', '2026-11-17T01:00:00Z', 1),
        'failureCode': 'INSUFFICIENT_BALANCE'
      },
      {
        ...row('b', 'REJECTED', '2026-11-17T02:00:00Z', 2),
        'reason': 'Bearer PRIVATE-SECRET',
        'metadata': {
          'providerResponse': {'message': 'PRIVATE-SECRET'}
        }
      },
    ], weekly);
    expect(data.declined.map((e) => e.reference), ['b', 'a']);
    expect(data.declined.last.declineReason, 'Insufficient available funds.');
    expect(data.declined.first.declineReason, isNot(contains('PRIVATE')));
  });
  test('invalid amounts/dates fail instead of producing invented zero totals',
      () {
    expect(
        () => InsightTransaction({
              'id': 'bad',
              'amount': 'NaN',
              'createdAt': '2026-11-17T01:00:00Z'
            }),
        throwsFormatException);
    expect(() => InsightTransaction({'id': 'bad', 'amount': 1}),
        throwsFormatException);
  });
  test('projection never mutates source records or nested provider data', () {
    final rows = [row('a', 'FAILED', '2026-11-17T01:00:00Z', 100)];
    final before = jsonEncode(rows);
    CustomerTransactionInsights.fromRows(rows, weekly);
    expect(jsonEncode(rows), before);
  });
  test('a genuine legacy reversal remains a separate recorded credit', () {
    final data = CustomerTransactionInsights.fromRows([
      row('original', 'FAILED', '2026-11-17T01:00:00Z', 100, ref: 'ORIGINAL'),
      {
        ...row('reversal', 'SUCCESSFUL', '2026-11-17T02:00:00Z', 100,
            source: 'LEDGER', ref: 'ORIGINAL', transactionId: 'original'),
        'reversalOf': 'debit-original',
        'direction': 'CREDIT'
      },
    ], weekly);
    expect(data.current.totalCount, 2);
    expect(data.current.successfulCount, 1);
    expect(data.current.declinedCount, 1);
  });
  test('canonical manual refund suppresses its duplicate reversal ledger only',
      () {
    final data = CustomerTransactionInsights.fromRows([
      row('refund', 'SUCCESSFUL', '2026-11-17T02:00:00Z', 100, ref: 'REFUND'),
      {
        ...row('ledger-refund', 'SUCCESSFUL', '2026-11-17T02:00:00Z', 100,
            source: 'LEDGER', ref: 'REFUND', transactionId: 'refund'),
        'reversalOf': 'debit-original',
        'metadata': {'manualRefund': true}
      },
      row('transfer', 'SUCCESSFUL', '2026-11-17T03:00:00Z', 15,
          source: 'TRANSFER', ref: 'TRANSFER'),
      row('ledger-transfer', 'SUCCESSFUL', '2026-11-17T03:00:00Z', 15,
          source: 'LEDGER', ref: 'TRANSFER'),
    ], weekly);
    expect(data.current.totalCount, 2);
    expect(data.current.totalValue, 115);
  });
}
