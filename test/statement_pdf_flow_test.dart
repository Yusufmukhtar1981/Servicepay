import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/customer_experience_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const storage = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  setUp(() {
    SharedPreferences.setMockInitialValues(
        {'servicepay_secure_session_present': true});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storage, (call) async =>
            call.method == 'read' ? 'isolated-statement-fixture-token' : null);
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storage, null);
  });

  test('PDF request binds dates to session and validates actual file signature', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response('%PDF-1.7\nfixture only', 200,
          headers: {'content-type': 'application/pdf'});
    });
    final api = CustomerExperienceApi(client: client);
    addTearDown(client.close);
    final Uint8List bytes = await api.statement(
        start: DateTime(2026, 11, 1), end: DateTime(2026, 11, 2));
    expect(bytes.take(5), '%PDF-'.codeUnits);
    expect(requests.single.method, 'GET');
    expect(requests.single.url.queryParameters,
        {'start': '2026-11-01', 'end': '2026-11-02'});
    expect(requests.single.headers['Authorization'],
        'Bearer isolated-statement-fixture-token');
    expect(requests.single.url.queryParameters.containsKey('customerId'), isFalse);
  });

  test('HTML cannot masquerade as a PDF even with a PDF content type', () async {
    final client = MockClient((_) async => http.Response('<html>Not a statement</html>', 200,
        headers: {'content-type': 'application/pdf'}));
    addTearDown(client.close);
    final api = CustomerExperienceApi(client: client);
    await expectLater(
        api.statement(start: DateTime(2026, 11, 1), end: DateTime(2026, 11, 2)),
        throwsA(isA<CustomerExperienceException>()));
  });

  test('incomplete historical balance evidence remains an explicit error', () async {
    final client = MockClient((_) async => http.Response(
        '{"message":"Historical balance evidence is incomplete."}', 409,
        headers: {'content-type': 'application/json'}));
    addTearDown(client.close);
    final api = CustomerExperienceApi(client: client);
    await expectLater(
        api.statement(start: DateTime(2026, 11, 1), end: DateTime(2026, 11, 2)),
        throwsA(isA<CustomerExperienceException>().having(
            (e) => e.toString(), 'message', contains('Historical balance'))));
  });

  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    testWidgets('PDF statement controls fit at $width', (tester) async {
      tester.view.physicalSize = Size(width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(MaterialApp(theme: ServicePayTheme.customer(),
          home: const GenerateStatementScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Generate & download PDF'), findsOneWidget);
      await tester.scrollUntilVisible(
          find.text('Generate & share PDF'), 150);
      expect(find.text('Generate & share PDF'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
