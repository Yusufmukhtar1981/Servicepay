import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_customer_support_screen.dart';
import 'package:servicepay_app/admin/admin_support_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('admin can find, open, and reply to a support ticket', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'head-office-token',
    });
    var replyCalls = 0;
    var detailLoads = 0;

    Map<String, dynamic> ticket({bool replied = false}) => <String, dynamic>{
      '_id': 'ticket-1',
      'id': 'ticket-1',
      'caseReference': 'SPT-20260830-FF5C07',
      'subject': 'Pending transfer',
      'description': 'My transfer is still pending.',
      'category': 'TRANSFER',
      'priority': 'HIGH',
      'status': 'OPEN',
      'createdAt': '2026-08-30T12:00:00.000Z',
      'updatedAt': '2026-08-30T12:00:00.000Z',
      'statusEvents': <Map<String, dynamic>>[
        <String, dynamic>{
          'status': 'OPEN',
          'actorName': 'Test Customer',
          'actorRole': 'CUSTOMER',
          'createdAt': '2026-08-30T12:00:00.000Z',
        },
      ],
      'customer': <String, dynamic>{
        'fullName': 'Test Customer',
        'phone': '08000000000',
        'email': 'customer@example.test',
      },
      'transactionContext': <String, dynamic>{
        'reference': 'TRX-100',
        'transactionType': 'TRANSFER',
        'amount': 5000,
        'status': 'PENDING',
        'occurredAt': '2026-08-30T11:30:00.000Z',
      },
      'publicReplies': <Map<String, dynamic>>[
        <String, dynamic>{
          'authorName': 'Test Customer',
          'authorRole': 'CUSTOMER',
          'message': 'Please help.',
          'createdAt': '2026-08-30T12:01:00.000Z',
        },
        if (replied)
          <String, dynamic>{
            'authorName': 'ServicePay Support',
            'authorRole': 'HEAD_OFFICE',
            'message': 'We are reviewing your ticket.',
            'createdAt': '2026-08-30T12:05:00.000Z',
          },
      ],
    };

    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer head-office-token');
      if (request.url.path.endsWith('/metrics')) {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{'total': 1},
          }),
          200,
        );
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/ticket-1/replies')) {
        replyCalls++;
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['message'], 'We are reviewing your ticket.');
        expect('${body['idempotencyKey']}', isNotEmpty);
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': ticket(replied: true),
          }),
          201,
        );
      }
      if (request.url.path.endsWith('/tickets/ticket-1')) {
        detailLoads++;
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': ticket(replied: replyCalls > 0),
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'items': <Map<String, dynamic>>[ticket()],
            'total': 1,
          },
        }),
        200,
      );
    });

    final api = AdminSupportApi(client: client);
    await tester.pumpWidget(
      MaterialApp(home: AdminCustomerSupportScreen(api: api)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Support / Tickets'), findsOneWidget);
    expect(find.text('SPT-20260830-FF5C07'), findsOneWidget);
    expect(find.textContaining('TRX-100'), findsOneWidget);
    expect(find.textContaining('customer@example.test'), findsOneWidget);

    await tester.tap(find.text('SPT-20260830-FF5C07'));
    await tester.pumpAndSettle();
    expect(detailLoads, 1);
    expect(find.textContaining('Customer complaint'), findsOneWidget);
    expect(find.text('Related transaction'), findsOneWidget);
    expect(find.textContaining('CUSTOMER'), findsNWidgets(2));
    expect(find.text('Status timeline'), findsOneWidget);
    expect(find.text('OPEN'), findsNWidgets(2));

    await tester.enterText(
      find.byType(TextField).first,
      'We are reviewing your ticket.',
    );
    await tester.tap(find.text('Send reply'));
    await tester.pumpAndSettle();

    expect(replyCalls, 1);
    expect(
      find.textContaining('We are reviewing your ticket.'),
      findsOneWidget,
    );
  });
}
