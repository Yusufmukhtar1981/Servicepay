import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/customer_profile_edit_sheet.dart';

void main() {
  const user = <String, dynamic>{
    'id': 'cust-1',
    'fullName': 'Ada Okafor',
    'phone': '08030000000',
    'email': 'ada@example.test',
    'address': '12 Palm Avenue',
    'state': 'Lagos',
    'lga': 'Ikeja',
    'zone': 'South West',
  };

  Future<void> harness(
    WidgetTester tester,
    http.Client client, {
    Completer<Object?>? result,
    bool contactChangesEnabled = false,
  }) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            key: const Key('profile-launch'),
            onPressed: () {
              showModalBottomSheet<Object?>(
                context: context,
                isScrollControlled: true,
                builder: (_) => CustomerProfileEditSheet(
                  user: user,
                  client: client,
                  baseUrl: 'https://unit.test/api',
                  contactChangesEnabled: contactChangesEnabled,
                ),
              ).then((value) {
                if (result != null && !result.isCompleted) {
                  result.complete(value);
                }
              });
            },
            child: const Text('Launch'),
          ),
        ),
      ),
    ));
  }

  Future<void> scrollToBottom(WidgetTester tester) async {
    await tester.drag(
      find.byType(SingleChildScrollView).last,
      const Offset(0, -1000),
    );
    await tester.pump();
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('auth_token', 'customer-token');
  });

  testWidgets(
      'contact save is OTP gated and sends both codes in contract shape',
      (tester) async {
    final calls = <http.Request>[];
    final client = MockClient((request) async {
      calls.add(request);
      if (request.url.path.endsWith('/contact/request')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'challengeId': 'ch-1', 'expiresInSeconds': 600}
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {'requiresLogin': true}
        }),
        200,
      );
    });
    final result = Completer<Object?>();
    await harness(tester, client, result: result, contactChangesEnabled: true);
    await tester.tap(find.text('Launch'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextField, 'Phone Number'), '08031112222');
    await tester.pumpAndSettle();
    await scrollToBottom(tester);
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Request and enter both verification codes'),
        findsOneWidget);
    expect(calls.where((request) => request.method == 'PUT'), isEmpty);

    await tester.enterText(
      find.widgetWithText(
          TextField, 'Current password (required for contact changes)'),
      'my-password',
    );
    await scrollToBottom(tester);
    await tester.tap(find.text('Send verification codes'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(calls.first.url.path, '/api/auth/profile/contact/request');
    expect(jsonDecode(calls.first.body), {
      'field': 'phone',
      'value': '08031112222',
      'currentPassword': 'my-password',
    });
    await tester.enterText(
        find.widgetWithText(TextField, 'Code sent to new phone number'),
        '123456');
    await tester.enterText(
        find.widgetWithText(
            TextField, 'Approval code sent to existing contact'),
        '654321');
    await scrollToBottom(tester);
    await tester.tap(find.text('Save changes'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1000));
    await tester.pumpAndSettle();
    final put = calls.singleWhere((request) => request.method == 'PUT');
    final body = jsonDecode(put.body) as Map<String, dynamic>;
    expect(body['contactVerifications']['phone'], {
      'challengeId': 'ch-1',
      'code': '123456',
      'approvalCode': '654321',
    });
    expect(await result.future, 'requiresLogin');
    client.close();
  });

  testWidgets('server validation error is presented and form remains available',
      (tester) async {
    final client = MockClient((request) async {
      if (request.method == 'POST') {
        return http.Response(
          '{"success":true,"data":{"challengeId":"ch-2","expiresInSeconds":600}}',
          200,
        );
      }
      return http.Response(
          '{"success":false,"message":"Approval code expired."}', 400);
    });
    await harness(tester, client, contactChangesEnabled: true);
    await tester.tap(find.text('Launch'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextField, 'Phone Number'), '08031112222');
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(
          TextField, 'Current password (required for contact changes)'),
      'pass',
    );
    await scrollToBottom(tester);
    await tester.tap(find.text('Send verification codes'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(
        find.widgetWithText(TextField, 'Code sent to new phone number'),
        '123456');
    await tester.enterText(
        find.widgetWithText(
            TextField, 'Approval code sent to existing contact'),
        '654321');
    await scrollToBottom(tester);
    await tester.tap(find.text('Save changes'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Approval code expired.'), findsOneWidget);
    expect(find.text('Edit Profile'), findsOneWidget);
    Navigator.of(tester.element(find.text('Edit Profile'))).pop();
    await tester.pump();
    client.close();
  });

  testWidgets('successful profile save returns refresh signal to caller',
      (tester) async {
    Map<String, dynamic>? saved;
    final client = MockClient((request) async {
      expect(request.method, 'PUT');
      saved = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(
        jsonEncode({
          'success': true,
          'user': {...user, 'address': '18 Palm Avenue'},
        }),
        200,
      );
    });
    final result = Completer<Object?>();
    await harness(tester, client, result: result);
    await tester.tap(find.text('Launch'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Phone and email changes are temporarily unavailable while secure verification is configured.',
      ),
      findsOneWidget,
    );
    expect(
      tester
          .widget<TextField>(find.widgetWithText(TextField, 'Full Name'))
          .controller!
          .text,
      'Ada Okafor',
    );
    expect(
      tester
          .widget<TextField>(
            find.widgetWithText(TextField, 'Phone Number'),
          )
          .readOnly,
      isTrue,
    );
    expect(
      tester
          .widget<TextField>(find.widgetWithText(TextField, 'Email Address'))
          .controller!
          .text,
      'ada@example.test',
    );
    expect(
      tester
          .widget<TextField>(
            find.widgetWithText(TextField, 'State'),
          )
          .readOnly,
      isTrue,
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Residential Address'),
      '18 Palm Avenue',
    );
    await scrollToBottom(tester);
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(await result.future, true);
    expect(saved!['fullName'], 'Ada Okafor');
    expect(saved!['address'], '18 Palm Avenue');
    expect(saved!['phone'], user['phone']);
    expect(saved!['email'], user['email']);
    expect(saved!['state'], user['state']);
    client.close();
  });

  testWidgets('unauthorized save is reported without dismissing the editor',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = MockClient((_) async =>
        http.Response('{"success":false,"message":"Unauthorized"}', 401));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CustomerProfileEditSheet(
          user: user,
          client: client,
          baseUrl: 'https://unit.test/api',
        ),
      ),
    ));
    await tester.enterText(
        find.widgetWithText(TextField, 'Full Name'), 'Ada Okafor New');
    await scrollToBottom(tester);
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(find.text('Unauthorized'), findsOneWidget);
    expect(find.text('Edit Profile'), findsOneWidget);
    client.close();
  });
}
