import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/id_verification_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

const Map<String, dynamic> _historyVerification = <String, dynamic>{
  'fullName': 'Ada Nneka Okafor',
  'firstName': 'Ada',
  'middleName': 'Nneka',
  'lastName': 'Okafor',
  'dateOfBirth': '1992-04-15',
  'gender': 'Female',
  'nin': '12345678901',
  'phone': '08012345678',
  'address': '12 Unity Road',
  'stateOfOrigin': 'Enugu',
  'lga': 'Nsukka',
  'nationality': 'Nigerian',
  'dateOfIssue': '2020-01-10',
  'photo':
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'reference': 'NIN-HISTORY-001',
  'createdAt': '2026-08-26T12:00:00.000Z',
  'status': 'SUCCESSFUL',
  'slipType': 'STANDARD',
  'amountCharged': 250,
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('NIN flow exposes one premium card and no legacy slip options',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    await tester.pumpWidget(
      const MaterialApp(
        home: IdVerificationScreen(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Premium NIN verification result'), findsOneWidget);
    expect(find.text('Standard'), findsNothing);
    expect(find.text('Regular'), findsNothing);
    expect(find.text('Information'), findsNothing);
    expect(find.text('Basic'), findsNothing);
  });

  testWidgets('history-shaped data renders one responsive premium NIN card',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      const MaterialApp(
        home: VerificationResultScreen(
          verification: _historyVerification,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(VerifiedNinCard), findsOneWidget);
    expect(find.text('SERVICEPAY NIN VERIFICATION RESULT'), findsOneWidget);
    expect(find.text('Premium provider verification record'), findsOneWidget);
    expect(find.text('OKAFOR'), findsOneWidget);
    expect(find.text('ADA'), findsOneWidget);
    expect(find.text('NNEKA'), findsOneWidget);
    expect(find.text('123 456 789 01'), findsWidgets);
    expect(
        find.byKey(const ValueKey<String>('nin-card-photo')), findsOneWidget);
    expect(
      find.text('NOT A GOVERNMENT ID • NOT NIMC-ISSUED'),
      findsOneWidget,
    );
    expect(find.text('NOT GOVERNMENT ISSUED'), findsOneWidget);
    expect(find.text('SCAN TO VERIFY'), findsNothing);
    expect(find.text('STANDARD'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed history never renders or exports an identity card',
      (WidgetTester tester) async {
    final Map<String, dynamic> failedVerification =
        Map<String, dynamic>.from(_historyVerification)..['status'] = 'FAILED';

    await tester.pumpWidget(
      MaterialApp(
        home: VerificationResultScreen(
          verification: failedVerification,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Verification Failed'), findsOneWidget);
    expect(
      find.text(
        'This verification was not successful. No verification result was generated.',
      ),
      findsOneWidget,
    );
    expect(find.byType(VerifiedNinCard), findsNothing);
    expect(find.text('SERVICEPAY NIN VERIFICATION RESULT'), findsNothing);
    expect(find.text('Download'), findsNothing);
    expect(find.text('Share'), findsNothing);
  });

  testWidgets('premium card is bounded on desktop web',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      const MaterialApp(
        home: VerificationResultScreen(
          verification: _historyVerification,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final Size cardSize = tester.getSize(find.byType(VerifiedNinCard));
    expect(cardSize.width, lessThanOrEqualTo(720));
    expect(cardSize.width / cardSize.height, closeTo(1.45, 0.02));
    expect(tester.takeException(), isNull);
  });
}
