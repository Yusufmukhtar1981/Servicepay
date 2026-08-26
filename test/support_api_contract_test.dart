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
}
