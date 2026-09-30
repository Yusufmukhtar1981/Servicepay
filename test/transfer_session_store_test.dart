import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:servicepay_app/transfer_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

const MethodChannel _secureStorageChannel =
    MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  String? secureToken;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    secureToken = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_secureStorageChannel, (call) async {
      switch (call.method) {
        case 'write':
          secureToken = (call.arguments as Map)['value'] as String;
          return null;
        case 'read':
          return secureToken;
        case 'delete':
          secureToken = null;
          return null;
        default:
          return null;
      }
    });
    await SessionStore.clear();
    await SessionStore.writeToken('secure-transfer-session-token');
  });

  tearDown(() async {
    await SessionStore.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_secureStorageChannel, null);
  });

  testWidgets(
      'uses the secure session token for beneficiary lookup without posting a transfer',
      (WidgetTester tester) async {
    final List<http.Request> beneficiaryRequests = <http.Request>[];
    var transferPosts = 0;
    final MockClient client = MockClient((http.Request request) async {
      if (request.method == 'POST') {
        transferPosts += 1;
        return http.Response('{}', 500);
      }

      if (request.url.path == '/api/transfer/beneficiary/08123456789') {
        beneficiaryRequests.add(request);
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': false,
            'message': 'Beneficiary lookup stopped by the test.',
          }),
          404,
        );
      }

      return http.Response(
        jsonEncode(<String, dynamic>{
          'features': <Map<String, dynamic>>[
            <String, dynamic>{
              'key': 'SERVICEPAY_TRANSFER',
              'enabled': true,
              'effectiveEnabled': true,
              'visible': true,
            },
          ],
        }),
        200,
      );
    });

    await http.runWithClient(() async {
      await tester.pumpWidget(
        MaterialApp(home: TransferScreen(client: client)),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const Key('transfer-phone-input')),
        '08123456789',
      );
      await tester.enterText(
        find.byKey(const Key('transfer-amount-input')),
        '100',
      );
      await tester.tap(find.byKey(const Key('transfer-submit')));
      await tester.pumpAndSettle();
    }, () => client);

    expect(beneficiaryRequests, hasLength(1));
    expect(
      beneficiaryRequests.single.headers['authorization'],
      'Bearer secure-transfer-session-token',
    );
    expect(transferPosts, 0);
    expect(
      find.text('Beneficiary lookup stopped by the test.'),
      findsOneWidget,
    );
    expect(
      find.text('Your login session has expired. Please log in again.'),
      findsNothing,
    );
  });
}
