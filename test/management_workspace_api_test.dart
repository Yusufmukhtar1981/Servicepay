import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/management/management_api.dart';

void main() {
  group('Management workspace API', () {
    test('uses session bearer token and sends customer filters and page',
        () async {
      late http.Request captured;
      final api = ManagementApi(
        tokenReader: () async => 'fixture-session-token',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
              jsonEncode({
                'success': true,
                'data': {
                  'items': [
                    {
                      'id': 'fixture-customer-7',
                      'fullName': 'Synthetic Customer',
                      'phone': '08012345678',
                      'email': 'fixture@example.test',
                      'createdAt': '2025-02-01T10:00:00Z',
                      'accountStatus': 'ACTIVE',
                      'activityStatus': 'ACTIVE',
                      'transactions': 2,
                      'transactionVolume': 1250,
                      'lastTransactionAt': null,
                    }
                  ],
                  'total': 1,
                  'page': 2,
                  'limit': 25,
                  'totalPages': 1,
                  'canViewWallet': false,
                },
              }),
              200);
        }),
      );

      final result = await api.workspaceCustomers(
        activity: 'ACTIVE',
        search: 'fixture customer',
        registeredFrom: '2025-02-01',
        registeredTo: '2025-02-28',
        page: 2,
      );

      expect(captured.url.path, endsWith('/management/workspace/customers'));
      expect(captured.headers['Authorization'], 'Bearer fixture-session-token');
      expect(captured.url.queryParameters, containsPair('activity', 'ACTIVE'));
      expect(captured.url.queryParameters,
          containsPair('registeredFrom', '2025-02-01'));
      expect(captured.url.queryParameters,
          containsPair('registeredTo', '2025-02-28'));
      expect(captured.url.queryParameters, containsPair('page', '2'));
      expect(result['canViewWallet'], isFalse);
      expect(
          (result['items'] as List).single['fullName'], 'Synthetic Customer');
    });

    test(
        'creates a complaint with its retained idempotency key and actual references',
        () async {
      late Map<String, dynamic> posted;
      final api = ManagementApi(
        tokenReader: () async => 'fixture-session-token',
        client: MockClient((request) async {
          posted = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
              jsonEncode({
                'success': true,
                'data': {
                  'ticket': {
                    'id': 'fixture-case-3',
                    'caseReference': 'SP-FIXTURE-3'
                  }
                },
              }),
              201);
        }),
      );

      final result = await api.createWorkspaceComplaint({
        'customerId': 'fixture-customer-7',
        'transactionId': 'fixture-transaction-2',
        'issueCategory': 'FAILED_TRANSACTION',
        'description': 'Synthetic fixture complaint description',
        'idempotencyKey': 'stable-fixture-key',
        'attachments': const [],
      });

      expect(posted['idempotencyKey'], 'stable-fixture-key');
      expect(posted['customerId'], 'fixture-customer-7');
      expect(posted['transactionId'], 'fixture-transaction-2');
      expect(result['ticket']['caseReference'], 'SP-FIXTURE-3');
    });

    test('searches and paginates scoped customer transactions', () async {
      late http.Request captured;
      final api = ManagementApi(
        tokenReader: () async => 'fixture-session-token',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
              jsonEncode({
                'success': true,
                'data': {
                  'items': [
                    {
                      'id': 'fixture-transaction-41',
                      'reference': 'TX-FIXTURE-41',
                      'serviceType': 'AIRTIME',
                      'amount': 320,
                      'status': 'SUCCESSFUL',
                      'createdAt': '2025-02-12T08:00:00Z',
                    }
                  ],
                  'page': 3,
                  'limit': 25,
                  'total': 61,
                  'totalPages': 3,
                },
              }),
              200);
        }),
      );

      final result = await api.workspaceCustomerTransactions(
        'fixture-customer-7',
        search: 'TX-FIXTURE-41',
        page: 3,
        limit: 25,
      );

      expect(
          captured.url.path,
          endsWith(
              '/management/workspace/customers/fixture-customer-7/transactions'));
      expect(captured.url.queryParameters,
          containsPair('search', 'TX-FIXTURE-41'));
      expect(captured.url.queryParameters, containsPair('page', '3'));
      expect(captured.url.queryParameters, containsPair('limit', '25'));
      expect((result['items'] as List).single['reference'], 'TX-FIXTURE-41');
      expect(result['totalPages'], 3);
    });

    test('preserves null commission values and blocks unsupported failures',
        () async {
      final api = ManagementApi(
        tokenReader: () async => 'fixture-session-token',
        client: MockClient((request) async => http.Response(
            jsonEncode({
              'success': true,
              'data': {
                'summary': {
                  'totalCommissionEarned': 1800,
                  'futureSettledCommissionEarned': 125.50,
                  'futureReversedCommission': 25.25,
                  'recordedAvailableCommission': 450,
                  'recordedWithdrawnCommission': 0,
                  'availableCommission': null,
                  'totalWithdrawn': null,
                  'pendingWithdrawals': null,
                  'commissionRecoveryDebt': null,
                },
                'readiness': {
                  'ready': false,
                  'canRequest': false,
                  'code': 'COMMISSION_CUSTODY_UNVERIFIED',
                  'message': 'Fixture custody is not verified.',
                },
                'items': [],
                'commissionHistory': [
                  {
                    'id': 'fixture-journal-3',
                    'kind': 'REVERSAL',
                    'reference': 'JRN-3',
                    'serviceType': 'DATA',
                    'createdAt': '2025-02-12T08:00:00Z',
                    'amountKobo': 2500,
                    'entries': [
                      {'accountId': 'own-account', 'amountKobo': 2500}
                    ],
                  }
                ],
                'custodySource': 'FUTURE_PROFIT_SHARING_ONLY',
                'legacyWalletWithdrawals': [],
              },
            }),
            200)),
      );

      final result = await api.workspaceWithdrawals();
      expect(result['summary']['availableCommission'], isNull);
      expect(result['summary']['futureSettledCommissionEarned'], 125.50);
      expect(result['summary']['futureReversedCommission'], 25.25);
      expect(result['readiness']['canRequest'], isFalse);
      expect(result['readiness']['code'], 'COMMISSION_CUSTODY_UNVERIFIED');
      expect(result['custodySource'], 'FUTURE_PROFIT_SHARING_ONLY');
      expect((result['commissionHistory'] as List).single['entries'], isNotEmpty);
    });

    test('posts commission withdrawal PIN, immutable details and idempotency key',
        () async {
      late http.Request captured;
      final api = ManagementApi(
        tokenReader: () async => 'fixture-session-token',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode({'success': true, 'data': {'id': 'fixture-request-8'}}),
            201,
          );
        }),
      );
      await api.requestCommissionWithdrawal({
        'amount': 175.25,
        'bankName': 'Fixture Bank',
        'accountName': 'Fixture Manager',
        'accountNumber': '0123456789',
        'transactionPin': '4826',
        'idempotencyKey': 'durable-fixture-retry-key',
      });
      expect(captured.method, 'POST');
      expect(captured.url.path, endsWith('/management/workspace/withdrawals'));
      expect(captured.headers['authorization'], 'Bearer fixture-session-token');
      expect(jsonDecode(captured.body), {
        'amount': 175.25,
        'bankName': 'Fixture Bank',
        'accountName': 'Fixture Manager',
        'accountNumber': '0123456789',
        'transactionPin': '4826',
        'idempotencyKey': 'durable-fixture-retry-key',
      });
    });

    test('pages combined commission withdrawal history',
        () async {
      late http.Request captured;
      final api = ManagementApi(
        tokenReader: () async => 'fixture-session-token',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode({'success': true, 'data': {'items': [], 'page': 3}}),
            200,
          );
        }),
      );
      await api.workspaceWithdrawals(page: 3, limit: 25);
      expect(captured.url.path, endsWith('/management/workspace/withdrawals'));
      expect(captured.url.queryParameters, containsPair('page', '3'));
      expect(captured.url.queryParameters, containsPair('limit', '25'));
    });
  });
}
