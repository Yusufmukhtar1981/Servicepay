import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/customer_experience_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';

class _FixtureApi extends CustomerExperienceApi {
  _FixtureApi({this.fail = false});
  final bool fail;
  @override
  Future<Map<String, dynamic>> cashback({int page = 1}) async {
    if (fail) {
      throw const CustomerExperienceException('Storage verification is pending.');
    }
    return {
      'balanceMinor': 12345,
      'totalMinor': 12345,
      'monthMinor': 12345,
      'yearMinor': 12345,
      'page': page,
      'pages': 1,
      'total': 1,
      'history': [
        {
          'reference': 'CB-FIXTURE-ONLY',
          'amountMinor': 12345,
          'description': 'Manual appreciation',
          'status': 'POSTED',
          'createdAt': '2026-11-01T12:00:00Z',
        },
      ],
    };
  }
}

void main() {
  for (final width in [360.0, 1440.0]) {
    testWidgets('cashback renders authoritative amounts at width $width',
        (tester) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _FixtureApi();
      addTearDown(api.close);
      await tester.pumpWidget(MaterialApp(
          home: CashbackScreen(api: api),
          theme: ThemeData(colorSchemeSeed: ServicePayColors.brand)));
      await tester.pumpAndSettle();
      expect(find.text('Cashback'), findsOneWidget);
      expect(find.text('₦123.45'), findsWidgets);
      expect(find.text('Manual appreciation'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('cashback error is explicit and never displays a false zero',
      (tester) async {
    final api = _FixtureApi(fail: true);
    addTearDown(api.close);
    await tester.pumpWidget(MaterialApp(home: CashbackScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.text('Storage verification is pending.'), findsOneWidget);
    expect(find.text('₦0.00'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
