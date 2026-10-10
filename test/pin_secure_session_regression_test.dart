import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:servicepay_app/transaction_pin_screen.dart';
import 'package:servicepay_app/change_transaction_pin_screen.dart';
import 'package:servicepay_app/reset_transaction_pin_screen.dart';
import 'package:servicepay_app/profile_screen.dart';
import 'package:servicepay_app/login_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const secureChannel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  setUp(() async {
    final secure = <String, String>{};
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureChannel, (call) async {
      final args = Map<String, dynamic>.from(call.arguments as Map);
      final key = args['key']?.toString();
      if (call.method == 'write' && key != null) secure[key] = args['value'].toString();
      if (call.method == 'delete' && key != null) secure.remove(key);
      if (call.method == 'read') return secure[key];
      return null;
    });
    SharedPreferences.setMockInitialValues({});
    await SessionStore.clear();
    await SessionStore.writeToken('secure-session-only');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull);
  });
  tearDown(() async {
    await SessionStore.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureChannel, null);
  });

  testWidgets('an invalid PIN session opens sign-in above the existing PIN route without retry loops',
      (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{"success":false,"message":"Unauthorized"}', 401);
    });
    await tester.pumpWidget(MaterialApp(home: TransactionPinScreen(client: client)));
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), '2580');
    await tester.enterText(fields.at(1), '2580');
    await tester.tap(find.text('Create PIN'));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.byType(TransactionPinScreen, skipOffstage: false), findsOneWidget);
    expect((await SessionStore.readToken()), isNull);
    Navigator.of(tester.element(find.byType(LoginScreen))).pop(false);
    await tester.pumpAndSettle();
    expect(find.byType(TransactionPinScreen), findsOneWidget);
  });

  testWidgets('Create PIN uses the secure login session without a legacy token',
      (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.url.path, '/api/transaction-pin/create');
      expect(request.headers['Authorization'], 'Bearer secure-session-only');
      expect(jsonDecode(request.body), {'pin': '2580', 'confirmPin': '2580'});
      return http.Response('{"success":true,"message":"PIN created"}', 201);
    });
    await tester.pumpWidget(MaterialApp(home: TransactionPinScreen(client: client)));
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), '2580');
    await tester.enterText(fields.at(1), '2580');
    await tester.tap(find.text('Create PIN'));
    await tester.pump();
    expect(calls, 1);
    expect(find.text('PIN created'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
  });

  testWidgets('Change PIN uses the secure session and existing PIN verification',
      (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.method, 'PUT');
      expect(request.headers['Authorization'], 'Bearer secure-session-only');
      expect(jsonDecode(request.body), {
        'currentPin': '2580', 'newPin': '4826', 'confirmNewPin': '4826',
      });
      return http.Response('{"success":false,"message":"Incorrect transaction PIN."}', 401);
    });
    await tester.pumpWidget(MaterialApp(home: ChangeTransactionPinScreen(client: client)));
    await tester.enterText(find.byKey(const Key('change-pin-current')), '2580');
    await tester.enterText(find.byKey(const Key('change-pin-new')), '4826');
    await tester.enterText(find.byKey(const Key('change-pin-confirm')), '4826');
    await tester.tap(find.byKey(const Key('change-transaction-pin-submit')));
    await tester.pump();
    expect(calls, 1);
    expect(find.text('Incorrect transaction PIN.'), findsOneWidget);
  });

  testWidgets('Forgotten PIN reset sends password proof with the secure session',
      (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.url.path, '/api/transaction-pin/reset');
      expect(request.headers['Authorization'], 'Bearer secure-session-only');
      expect(jsonDecode(request.body)['currentPassword'], 'Password123!');
      return http.Response('{"success":false,"message":"Current password is incorrect."}', 401);
    });
    await tester.pumpWidget(MaterialApp(home: ResetTransactionPinScreen(client: client)));
    await tester.enterText(find.byKey(const Key('reset-pin-current-password')), 'Password123!');
    await tester.enterText(find.byKey(const Key('reset-pin-new-pin')), '4826');
    await tester.enterText(find.byKey(const Key('reset-pin-confirm-pin')), '4826');
    await tester.tap(find.byKey(const Key('reset-transaction-pin-submit')));
    await tester.pump();
    expect(calls, 1);
    expect(find.text('Current password is incorrect.'), findsOneWidget);
  });

  testWidgets('Security Settings offers Create when the server repairs a stale PIN flag',
      (tester) async {
    var statusChecks = 0;
    final client = MockClient((request) async {
      expect(request.headers['Authorization'], 'Bearer secure-session-only');
      if (request.url.path == '/api/auth/profile') {
        return http.Response('{"success":true,"user":{"fullName":"PIN regression","role":"CUSTOMER","transactionPinSet":true}}', 200);
      }
      if (request.url.path == '/api/transaction-pin/status') {
        statusChecks++;
        return http.Response('{"success":true,"transactionPinSet":false}', 200);
      }
      return http.Response('{"success":true}', 200);
    });
    await tester.pumpWidget(MaterialApp(home: ProfileScreen(client: client)));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Create Transaction PIN'), 300);
    expect(statusChecks, 1);
    expect(find.text('Create Transaction PIN'), findsOneWidget);
    expect(find.text('Change Transaction PIN'), findsNothing);
  });
}
