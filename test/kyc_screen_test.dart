import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/kyc_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('creates KYC document parts with an image MIME type', () {
    final part = kycDocumentMultipartFile(
      bytes: <int>[1, 2, 3],
      filename: 'government-id.png',
    );

    expect(part.field, 'document');
    expect(part.contentType.type, 'image');
    expect(part.contentType.subtype, 'png');
  });

  testWidgets('shows the customer KYC tier and identity form', (
    WidgetTester tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    await tester.pumpWidget(
      const MaterialApp(
        home: KycScreen(),
      ),
    );
    await tester.pump();

    expect(find.text('KYC Verification'), findsOneWidget);
    expect(find.text('Choose KYC Tier'), findsOneWidget);
    expect(find.text('Tier 1'), findsOneWidget);
    expect(find.text('Tier 2'), findsOneWidget);
    expect(find.text('Tier 3'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Identity verification'),
      300,
    );

    expect(find.text('Identity verification'), findsOneWidget);
    expect(find.text('LGA', skipOffstage: false), findsOneWidget);
  });
}
