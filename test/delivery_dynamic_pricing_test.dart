import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/create_delivery_screen.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'fixture-token'});
  });

  MockClient fixtureClient({
    double price = 3000,
    bool unavailable = false,
    http.Response Function(http.Request)? purchase,
  }) => MockClient((request) async {
    if (request.method == 'POST') {
      return purchase!(request);
    }
    if (request.url.path.endsWith('/pricing')) {
      return http.Response(jsonEncode({
        'standardDeliveryFee': price, 'version': 2,
      }), unavailable ? 503 : 200);
    }
    return http.Response(jsonEncode({'data': {'states': [
      {'stateCode': 'KANO', 'stateName': 'Kano', 'isLive': true},
    ]}}), 200);
  });

  Future<void> open(WidgetTester tester, MockClient client) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(home: CreateDeliveryScreen(httpClient: client)));
    await tester.pumpAndSettle();
  }

  testWidgets('fee and debit description both use the Admin price', (tester) async {
    await open(tester, fixtureClient());
    expect(find.text('₦3,000.00'), findsOneWidget);
    expect(find.textContaining('current delivery fee of ₦3,000.00'), findsOneWidget);
    expect(find.textContaining('₦2,000'), findsNothing);
  });

  testWidgets('Admin can set 2000 without changing customer code', (tester) async {
    await open(tester, fixtureClient(price: 2000));
    expect(find.text('₦2,000.00'), findsOneWidget);
    expect(find.textContaining('current delivery fee of ₦2,000.00'), findsOneWidget);
  });

  testWidgets('unavailable price disables submission and makes no price claim', (tester) async {
    await open(tester, fixtureClient(unavailable: true));
    final button = tester.widget<FilledButton>(find.ancestor(
      of: find.text('Request Delivery'),
      matching: find.byWidgetPredicate((widget) => widget is FilledButton),
    ).first);
    expect(button.onPressed, isNull);
    expect(find.textContaining('₦2,000'), findsNothing);
    expect(find.textContaining('₦3,000'), findsNothing);
  });

  testWidgets('confirmation uses saved order fee, not latest price or a constant', (tester) async {
    var requests = 0;
    await open(tester, fixtureClient(purchase: (request) {
      requests++;
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['deliveryPriceVersion'], 2);
      expect(body.containsKey('deliveryFee'), isFalse);
      return http.Response(jsonEncode({'delivery': {
        'trackingNumber': 'FIXTURE-REPLAY',
        'deliveryFee': 2500,
      }}), 200);
    }));
    for (var index = 0; index < 2; index++) {
      final target = find.byType(DropdownButtonFormField<String>).at(index);
      await tester.ensureVisible(target);
      await tester.tap(target);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Kano').last);
      await tester.pumpAndSettle();
    }
    const values = {
      'Pickup Name': 'Fixture Sender',
      'Pickup Phone Number': '08012345678',
      'Pickup Address': 'Fixture origin address',
      'Receiver Name': 'Fixture Receiver',
      'Receiver Phone': '08022345678',
      'Receiver Address': 'Fixture destination address',
      'Delivery Note / Item Description': 'Fixture parcel',
    };
    for (final entry in values.entries) {
      await tester.enterText(find.widgetWithText(TextFormField, entry.key), entry.value);
    }
    await tester.ensureVisible(find.text('Request Delivery'));
    await tester.tap(find.text('Request Delivery'));
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    // Submission stays busy until the success dialog is dismissed.
    // Its background spinner intentionally prevents pumpAndSettle here.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(requests, 1);
    expect(find.text('Delivery Fee: ₦2,500.00'), findsOneWidget);
    expect(find.text('Delivery Fee: ₦2,000'), findsNothing);
    expect(find.text('FIXTURE-REPLAY'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
  });
}
