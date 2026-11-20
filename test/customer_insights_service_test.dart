import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/customer_transaction_insights.dart';
import 'package:servicepay_app/services/customer_insights_service.dart';

void main() {
  final now = DateTime.utc(2026, 11, 18, 12);
  Map<String, dynamic> row(String id, String date, {num amount = 10}) => {
        'id': id,
        'reference': id,
        'createdAt': date,
        'amount': amount,
        'status': 'SUCCESSFUL'
      };
  http.Response page(List<Map<String, dynamic>> rows,
          {bool more = false, String? cursor}) =>
      http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'transactions': rows,
              'pagination': {'hasMore': more, 'nextCursor': cursor}
            }
          }),
          200);
  CustomerInsightsService service(http.Client client,
          {Future<String?> Function()? token, int maxPages = 100}) =>
      CustomerInsightsService(
          client: client,
          readToken: token ?? () async => 'test-A',
          clock: () => now,
          maxPages: maxPages);

  test('uses authenticated GET only; paginates completely and deduplicates',
      () async {
    var requests = 0;
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/transactions');
      expect(request.url.queryParameters['limit'], '50');
      expect(request.url.queryParameters.containsKey('userId'), isFalse);
      expect(request.headers['Authorization'], 'Bearer test-A');
      requests++;
      if (requests == 1) {
        expect(request.url.queryParameters.containsKey('before'), isFalse);
        return page([row('a', '2026-11-17T01:00:00Z')],
            more: true, cursor: 'cursor-a');
      }
      expect(request.url.queryParameters['before'], 'cursor-a');
      return page(
          [row('a', '2026-11-17T01:00:00Z'), row('b', '2026-11-10T01:00:00Z')]);
    });
    final data = await service(client).load(CustomerInsightsPeriod.weekly);
    expect(data.current.totalCount, 1);
    expect(data.previous.totalCount, 1);
    expect(requests, 2);
  });
  test('stops only after a completed page proves prior-window coverage',
      () async {
    var requests = 0;
    final client = MockClient((_) async {
      requests++;
      return page([
        row('a', '2026-11-17T01:00:00Z'),
        row('old', '2026-10-01T01:00:00Z')
      ], more: true, cursor: 'older');
    });
    final data = await service(client).load(CustomerInsightsPeriod.weekly);
    expect(data.current.totalCount, 1);
    expect(requests, 1);
  });
  test('customer sessions never share cached records', () async {
    var token = 'test-A';
    final client = MockClient((request) async => page([
          row(request.headers['Authorization']!, '2026-11-17T01:00:00Z',
              amount:
                  request.headers['Authorization'] == 'Bearer test-A' ? 10 : 99)
        ]));
    final api = service(client, token: () async => token);
    expect(
        (await api.load(CustomerInsightsPeriod.weekly)).current.totalValue, 10);
    token = 'test-B';
    expect(
        (await api.load(CustomerInsightsPeriod.weekly)).current.totalValue, 99);
  });
  test('session change while a request is in flight discards its records',
      () async {
    var token = 'test-A';
    final client = MockClient((_) async {
      token = 'test-B';
      return page([row('a', '2026-11-17T01:00:00Z')]);
    });
    await expectLater(
        service(client, token: () async => token)
            .load(CustomerInsightsPeriod.weekly),
        throwsStateError);
  });
  test('no session sends no network request', () async {
    final client = MockClient((_) async => throw StateError('Must not send'));
    await expectLater(
        service(client, token: () async => null)
            .load(CustomerInsightsPeriod.weekly),
        throwsStateError);
  });
  test('unauthorized response never exposes its raw body', () async {
    final client =
        MockClient((_) async => http.Response('SECRET API KEY', 401));
    await expectLater(service(client).load(CustomerInsightsPeriod.weekly),
        throwsA(predicate((e) => !e.toString().contains('SECRET'))));
  });
  test('provider/server errors never become successful zero totals', () async {
    final client =
        MockClient((_) async => http.Response('INTERNAL SECRET', 503));
    await expectLater(service(client).load(CustomerInsightsPeriod.weekly),
        throwsA(predicate((e) => !e.toString().contains('SECRET'))));
  });
  test('repeated or absent cursor fails rather than double-counting pages',
      () async {
    final client = MockClient((_) async =>
        page([row('a', '2026-11-17T01:00:00Z')], more: true, cursor: 'repeat'));
    await expectLater(service(client).load(CustomerInsightsPeriod.weekly),
        throwsFormatException);
  });
  test('bounded pagination never silently returns sampled totals', () async {
    final client = MockClient((_) async =>
        page([row('a', '2026-11-17T01:00:00Z')], more: true, cursor: 'next'));
    await expectLater(
        service(client, maxPages: 1).load(CustomerInsightsPeriod.weekly),
        throwsStateError);
  });
  test('missing pagination is an explicit incomplete-history error', () async {
    final client = MockClient((_) async =>
        http.Response('{"success":true,"data":{"transactions":[]}}', 200));
    await expectLater(service(client).load(CustomerInsightsPeriod.weekly),
        throwsFormatException);
  });
  test('out-of-order history cannot trigger a false range-complete result',
      () async {
    final client = MockClient((_) async => page([
          row('old', '2026-10-01T01:00:00Z'),
          row('new', '2026-11-17T01:00:00Z')
        ]));
    await expectLater(service(client).load(CustomerInsightsPeriod.weekly),
        throwsFormatException);
  });
  test('empty authenticated history is a real zero result', () async {
    final client = MockClient((_) async => page([]));
    final data = await service(client).load(CustomerInsightsPeriod.monthly);
    expect(data.current.totalCount, 0);
    expect(data.current.totalValue, 0);
    expect(data.window.period, CustomerInsightsPeriod.monthly);
  });
  test('overall time budget stops work before another history request',
      () async {
    var sent = false;
    final client = MockClient((_) async {
      sent = true;
      return page([]);
    });
    final api = CustomerInsightsService(
        client: client,
        readToken: () async => 'test-A',
        clock: () => now,
        loadBudget: Duration.zero);
    await expectLater(
        api.load(CustomerInsightsPeriod.weekly), throwsStateError);
    expect(sent, isFalse);
  });
  test('only a recognized provider reason code reaches customer projection',
      () async {
    final client = MockClient((_) async => page([
          {
            ...row('a', '2026-11-17T01:00:00Z'),
            'status': 'FAILED',
            'metadata': {
              'providerResponse': {
                'code': 'INSUFFICIENT_BALANCE',
                'apiKey': 'PRIVATE-SECRET',
                'message': 'INTERNAL-STACK-TRACE'
              }
            }
          },
        ]));
    final data = await service(client).load(CustomerInsightsPeriod.weekly);
    expect(data.declined.single.declineReason, 'Insufficient available funds.');
    expect(data.declined.single.declineReason, isNot(contains('PRIVATE')));
  });
}
