import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/servicepay_transfer_helper.dart';
import 'package:servicepay_app/transfer_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
      'restored normal intent blocks edits and POST until authoritative failure',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'token',
      'user_id': 'sender-1',
      'user_phone': '08000000000',
    });
    final prefs = await SharedPreferences.getInstance();
    await savePendingServicePayTransfer(
      prefs,
      PendingServicePayTransfer(
        reference: 'SPC-normal-restored',
        idempotencyKey: 'stable-normal-key',
        receiverPhone: '08012345678',
        amount: 2500,
        flowType: 'normal',
        createdAt: DateTime.utc(2020, 1, 1),
      ),
    );
    var returnFailed = false;
    var posts = 0;
    var featureGets = 0;
    var recoveryGets = 0;
    final client = MockClient((request) async {
      if (request.method == 'POST') {
        posts += 1;
        throw StateError('recovery must not POST');
      }
      if (request.url.path == '/api/settings/customer/features') {
        featureGets += 1;
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
      }
      recoveryGets += 1;
      expect(request.method, 'GET');
      expect(request.url.path,
          '/api/transfer/servicepay/status/SPC-normal-restored');
      if (returnFailed) {
        return http.Response(jsonEncode(<String, dynamic>{
          'success': false,
          'data': <String, dynamic>{
            'status': 'FAILED',
            'message': 'Transfer was declined.',
          },
        }), 200);
      }
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': false,
          'message': 'Reference not found',
        }),
        404,
      );
    });

    await tester.pumpWidget(
      MaterialApp(home: TransferScreen(client: client)),
    );
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(featureGets, 1);
    expect(recoveryGets, 3);
    expect(posts, 0);
    expect(find.text('CHECK STATUS'), findsOneWidget);
    final phone = tester.widget<TextFormField>(
        find.byKey(const Key('transfer-phone-input')));
    final amount = tester.widget<TextFormField>(
        find.byKey(const Key('transfer-amount-input')));
    expect(phone.enabled, isFalse);
    expect(amount.enabled, isFalse);

    await tester.enterText(
        find.byKey(const Key('transfer-phone-input')), '08111111111');
    expect(phone.controller?.text, '08012345678');

    returnFailed = true;
    await tester.ensureVisible(find.byKey(const Key('transfer-submit')));
    await tester.tap(find.byKey(const Key('transfer-submit')));
    await tester.pump();
    await tester.pump();

    expect(posts, 0);
    expect(featureGets, 1);
    expect(recoveryGets, 4);
    expect(find.text('Transfer Money'), findsOneWidget);
    expect(
      tester
          .widget<TextFormField>(
              find.byKey(const Key('transfer-phone-input')))
          .enabled,
      isTrue,
    );
    expect(
        restorePendingServicePayTransfer(prefs, flowType: 'normal'), isNull);
  });
}