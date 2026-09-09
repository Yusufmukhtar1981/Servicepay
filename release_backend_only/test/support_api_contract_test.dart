import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/admin/admin_support_api.dart';
import 'package:servicepay_app/services/support_api_service.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'support-test-token',
    });
  });

  test('customer support API unwraps nested ticket collections and details',
      () async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer support-test-token');
      if (request.url.path.endsWith('/tickets/ticket-1')) {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'id': 'ticket-1',
              'caseReference': 'SUP-100',
              'subject': 'Account help',
              'status': 'OPEN',
              'priority': 'NORMAL',
              'replies': <Map<String, dynamic>>[],
            },
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'total': 1,
            'items': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'ticket-1',
                'caseReference': 'SUP-100',
                'subject': 'Account help',
              },
            ],
          },
        }),
        200,
      );
    });
    final api = SupportApiService(client: client);

    final page = await api.tickets();
    final detail = await api.ticket('ticket-1');

    expect(page.total, 1);
    expect(page.tickets.single.reference, 'SUP-100');
    expect(detail.id, 'ticket-1');
    expect(detail.reference, 'SUP-100');
  });

  test('admin internal notes include an idempotency key', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/admin/support/tickets/ticket-1/notes');
      expect(
        jsonDecode(request.body),
        <String, dynamic>{
          'body': 'Internal investigation only',
          'idempotencyKey': 'note-key',
        },
      );
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'id': 'ticket-1'},
        }),
        201,
      );
    });
    final api = AdminSupportApi(client: client);

    await api.note('ticket-1', 'Internal investigation only',
        idempotencyKey: 'note-key');
  });

  test('admin ticket search sends support filters', () async {
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/admin/support/tickets');
      expect(request.url.queryParameters['search'], 'SPT-20260830-FF5C07');
      expect(request.url.queryParameters['status'], 'IN_REVIEW');
      expect(request.url.queryParameters['category'], 'TRANSACTION');
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'items': <dynamic>[],
            'total': 0,
          },
        }),
        200,
      );
    });

    await AdminSupportApi(client: client).tickets(
      search: 'SPT-20260830-FF5C07',
      status: 'IN_REVIEW',
      category: 'TRANSACTION',
    );
  });

  test('admin reply sends a stable idempotency key', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(
        jsonDecode(request.body),
        <String, dynamic>{
          'message': 'We are reviewing your ticket.',
          'idempotencyKey': 'admin-reply-key',
        },
      );
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'id': 'ticket-1'},
        }),
        201,
      );
    });

    await AdminSupportApi(client: client).reply(
      'ticket-1',
      'We are reviewing your ticket.',
      idempotencyKey: 'admin-reply-key',
    );
  });

  test('reply requests require and send an idempotency key', () async {
    final client = MockClient((request) async {
      expect(jsonDecode(request.body), <String, dynamic>{
        'message': 'Still waiting',
        'idempotencyKey': 'reply-key',
      });
      return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{'id': 'ticket-1'}
          }),
          201);
    });
    await SupportApiService(client: client)
        .reply('ticket-1', 'Still waiting', idempotencyKey: 'reply-key');
  });

  test('transaction issue creation sends the selected history lookup id',
      () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/support/tickets');
      expect(
        jsonDecode(request.body),
        <String, dynamic>{
          'subject': 'Issue with Data',
          'description': 'Paid but service was not received',
          'priority': 'NORMAL',
          'category': 'TRANSACTION',
          'idempotencyKey': 'transaction-issue-key',
          'transactionLookupId': 'transaction:66ddcafe',
        },
      );
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'id': 'ticket-2',
            'caseReference': 'SUP-200',
          },
        }),
        201,
      );
    });

    final ticket = await SupportApiService(client: client).createTicket(
      subject: 'Issue with Data',
      description: 'Paid but service was not received',
      priority: 'NORMAL',
      category: 'TRANSACTION',
      idempotencyKey: 'transaction-issue-key',
      transactionLookupId: 'transaction:66ddcafe',
    );

    expect(ticket.reference, 'SUP-200');
  });

  test('transaction issue key survives reconstruction until success', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'customer-session-a',
    });
    final firstStore = TransactionIssueSubmissionKeys();
    final String first =
        await firstStore.forTransaction('transaction:66ddcafe');

    final reconstructedStore = TransactionIssueSubmissionKeys();
    final String retry =
        await reconstructedStore.forTransaction('transaction:66ddcafe');
    expect(retry, first);

    await reconstructedStore.complete('transaction:66ddcafe');
    final String afterSuccess = await TransactionIssueSubmissionKeys()
        .forTransaction('transaction:66ddcafe');
    expect(afterSuccess, isNot(first));
  });
}
