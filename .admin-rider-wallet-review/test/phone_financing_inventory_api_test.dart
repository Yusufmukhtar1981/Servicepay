import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_phone_financing_api.dart';
import 'package:servicepay_app/admin/admin_phone_financing_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'head-office-token',
      'user_role': 'HEAD_OFFICE',
    });
  });

  test('createDevice sends the canonical trimmed inventory payload', () async {
    late http.Request sent;
    final client = MockClient((http.Request request) async {
      sent = request;
      return http.Response(
        jsonEncode(<String, Object>{
          'success': true,
          'device': <String, Object>{'_id': 'device-1'},
        }),
        201,
        headers: <String, String>{'content-type': 'application/json'},
      );
    });
    final api = AdminPhoneFinancingApi(
      client: client,
      baseUrl: 'https://example.test/api/phone-financing',
    );

    await api.createDevice(
      phoneProductId: '  product-id  ',
      imei1: ' 111111111111111 ',
      serialNumber: ' serial-1 ',
    );

    expect(sent.method, 'POST');
    expect(sent.url.path, '/api/phone-financing/admin/devices');
    expect(
      jsonDecode(sent.body),
      <String, Object>{
        'phoneProductId': 'product-id',
        'imei1': '111111111111111',
        'serialNumber': 'serial-1',
      },
    );
    expect(sent.headers['authorization'], 'Bearer head-office-token');
    api.close();
  });

  test('createDevice includes a non-empty optional IMEI 2', () async {
    late Map<String, dynamic> payload;
    final client = MockClient((http.Request request) async {
      payload = Map<String, dynamic>.from(jsonDecode(request.body) as Map);
      return http.Response('{"success":true}', 201);
    });
    final api = AdminPhoneFinancingApi(
      client: client,
      baseUrl: 'https://example.test/api/phone-financing',
    );

    await api.createDevice(
      phoneProductId: 'product-id',
      imei1: '111111111111111',
      imei2: ' 222222222222222 ',
      serialNumber: 'serial-1',
    );

    expect(payload['imei2'], '222222222222222');
    api.close();
  });

  testWidgets(
      'completed inventory dialog submits the selected product database ID',
      (WidgetTester tester) async {
    final api = _FakeInventoryApi();
    await tester.pumpWidget(
      MaterialApp(home: AdminPhoneFinancingScreen(api: api)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Inventory'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add device'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test Phone · stock 0').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'IMEI 1'),
      ' 111111111111111 ',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Serial number'),
      ' serial-1 ',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Add device'));
    await tester.pumpAndSettle();

    expect(api.created, isNotNull);
    expect(api.created!['phoneProductId'], 'database-product-id');
    expect(api.created!['imei1'], '111111111111111');
    expect(api.created!['imei2'], '');
    expect(api.created!['serialNumber'], 'serial-1');
  });
}

class _FakeInventoryApi extends AdminPhoneFinancingApi {
  _FakeInventoryApi()
      : super(
          client: MockClient((_) async => http.Response('{}', 200)),
          baseUrl: 'https://example.test',
        );

  Map<String, String>? created;

  @override
  Future<Map<String, dynamic>> dashboard() async => {
        'success': true,
        'metrics': <String, dynamic>{},
      };

  @override
  Future<Map<String, dynamic>> products() async => {
        'success': true,
        'products': <Map<String, dynamic>>[
          {
            '_id': 'database-product-id',
            'name': 'Test Phone',
            'stock': 0,
          },
        ],
      };

  @override
  Future<Map<String, dynamic>> applications(
          {String search = '', String status = ''}) async =>
      {'success': true, 'applications': <Object>[]};

  @override
  Future<Map<String, dynamic>> devices({String search = ''}) async =>
      {'success': true, 'devices': <Object>[]};

  @override
  Future<Map<String, dynamic>> finance(
          {String search = '', String status = ''}) async =>
      {'success': true, 'finance': <Object>[]};

  @override
  Future<Map<String, dynamic>> createDevice({
    required String phoneProductId,
    required String imei1,
    String imei2 = '',
    required String serialNumber,
  }) async {
    created = {
      'phoneProductId': phoneProductId,
      'imei1': imei1,
      'imei2': imei2,
      'serialNumber': serialNumber,
    };
    return {
      'success': true,
      'device': {'_id': 'device-1'},
    };
  }
}
