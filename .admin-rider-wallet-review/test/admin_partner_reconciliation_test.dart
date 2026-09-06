import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_partner_reconciliation_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'head-office-test-token',
      'user_role': 'HEAD_OFFICE',
    });
  });

  testWidgets('shows pending reconciliation and full Partner API history',
      (tester) async {
    await pump(tester, reconciliationClient());
    expect(find.text('Partner API Reconciliation'), findsOneWidget);
    expect(find.textContaining('SPP-AIRTIME-UNCERTAIN'), findsOneWidget);
    expect(find.textContaining('SPP-DATA-SUCCESSFUL'), findsOneWidget);
    expect(find.text('REQUERY REQUIRED'), findsOneWidget);
    await tester.tap(find.textContaining('SPP-AIRTIME-UNCERTAIN'));
    await tester.pumpAndSettle();
    expect(find.text('Already debited'), findsOneWidget);
    expect(find.textContaining('Partner wallet debit'), findsOneWidget);
    expect(find.text('MARK SUCCESSFUL'), findsOneWidget);
    expect(find.text('MARK FAILED / REFUND'), findsOneWidget);
  });

  testWidgets('submits a successful resolution once with a required note',
      (tester) async {
    Map<String, dynamic>? body;
    await pump(tester, reconciliationClient(onPost: (request) {
      body = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(jsonEncode(<String, dynamic>{'success': true}), 200);
    }));
    await tester.tap(find.textContaining('SPP-AIRTIME-UNCERTAIN'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MARK SUCCESSFUL'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).first,
      'Provider confirmed service delivery.',
    );
    await tester.tap(find.text('Confirm successful'));
    await tester.pumpAndSettle();
    expect(body?['outcome'], 'SUCCESSFUL');
    expect(body?['verificationNote'], contains('Provider confirmed'));
  });

  testWidgets('submits failed resolution as the protected refund path',
      (tester) async {
    Map<String, dynamic>? body;
    await pump(tester, reconciliationClient(onPost: (request) {
      body = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(jsonEncode(<String, dynamic>{'success': true}), 200);
    }));
    await tester.tap(find.textContaining('SPP-AIRTIME-UNCERTAIN'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MARK FAILED / REFUND'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).first,
      'Provider confirmed no purchase was delivered.',
    );
    await tester.tap(find.text('Confirm refund'));
    await tester.pumpAndSettle();
    expect(body?['outcome'], 'FAILED');
  });

  testWidgets('blocks duplicate resolution and unauthorized responses visibly',
      (tester) async {
    await pump(tester, reconciliationClient(onPost: (_) {
      return http.Response(jsonEncode(<String, dynamic>{
        'message': 'This transaction already has a final outcome.',
      }), 409);
    }));
    await tester.tap(find.textContaining('SPP-AIRTIME-UNCERTAIN'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MARK FAILED / REFUND'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).first,
      'Provider confirmed no purchase was delivered.',
    );
    await tester.tap(find.text('Confirm refund'));
    await tester.pumpAndSettle();
    expect(find.textContaining('already has a final outcome'), findsOneWidget);
  });

  testWidgets('does not expose resolution actions for already successful records',
      (tester) async {
    await pump(tester, reconciliationClient());
    await tester.tap(find.textContaining('SPP-DATA-SUCCESSFUL'));
    await tester.pumpAndSettle();
    expect(find.text('MARK SUCCESSFUL'), findsNothing);
    expect(find.text('MARK FAILED / REFUND'), findsNothing);
  });

  testWidgets('shows Head Office authorization failure from the backend',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'staff-test-token',
      'user_role': 'STAFF',
    });
    var requestCount = 0;
    final client = MockClient((request) async {
      requestCount++;
      return http.Response('{}', 200);
    });
    await pump(tester, client);
    expect(
      find.text('Head Office access is required for Partner API reconciliation.'),
      findsOneWidget,
    );
    expect(requestCount, 0);
  });
}

Future<void> pump(WidgetTester tester, http.Client client) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(body: AdminPartnerReconciliationView(client: client)),
  ));
  await tester.pumpAndSettle();
}

http.Client reconciliationClient({
  http.Response Function(http.Request request)? onPost,
}) {
  return MockClient((request) async {
    if (request.method == 'GET' && request.url.path.endsWith('/admin/partners')) {
      return http.Response(jsonEncode(<String, dynamic>{
        'partners': <Map<String, dynamic>>[
          <String, dynamic>{'id': 'partner-1', 'businessName': 'Acme Telecom', 'apiKey': 'sp_live_masked'},
        ],
      }), 200);
    }
    if (request.method == 'GET' && request.url.path.endsWith('/partner-1/usage')) {
      return http.Response(jsonEncode(<String, dynamic>{
        'transactions': <Map<String, dynamic>>[
          transaction('SPP-AIRTIME-UNCERTAIN', 'REQUERY_REQUIRED'),
          transaction('SPP-DATA-SUCCESSFUL', 'SUCCESSFUL'),
        ],
        'auditEvents': <Map<String, dynamic>>[
          <String, dynamic>{
            'action': 'API_REQUERY_ATTEMPTED',
            'createdAt': '2026-08-25T10:00:00.000Z',
            'metadata': <String, dynamic>{'reference': 'SPP-AIRTIME-UNCERTAIN'},
          },
        ],
      }), 200);
    }
    if (request.method == 'GET' && request.url.path.endsWith('/reconciliation')) {
      return http.Response(jsonEncode(<String, dynamic>{
        'message': 'Verify outcomes with the provider before resolving.',
        'transactions': <Map<String, dynamic>>[
          transaction('SPP-AIRTIME-UNCERTAIN', 'REQUERY_REQUIRED'),
        ],
      }), 200);
    }
    if (request.method == 'POST' && request.url.path.contains('/reconciliation/')) {
      return onPost?.call(request) ??
          http.Response(jsonEncode(<String, dynamic>{'success': true}), 200);
    }
    return http.Response('Not found', 404);
  });
}

Map<String, dynamic> transaction(String reference, String status) =>
    <String, dynamic>{
      'reference': reference,
      'idempotencyKey': 'idem-$reference',
      'service': 'AIRTIME',
      'network': 'MTN',
      'phone': '08030000000',
      'amount': 500,
      'walletDebitStatus': 'DEBITED',
      'providerReference': status == 'SUCCESSFUL' ? 'provider-ref-1' : '',
      'status': status,
      'createdAt': '2026-08-25T09:00:00.000Z',
      'updatedAt': '2026-08-25T10:00:00.000Z',
    };