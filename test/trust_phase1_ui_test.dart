import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/trust/trust_models.dart';
import 'package:servicepay_app/trust/trust_profile_screen.dart';
import 'package:servicepay_app/trust/trust_search_screen.dart';

void main() {
  const TrustProfile profile = TrustProfile(
    servicePayId: 'SPT-ABCDEF123456',
    displayName: 'Ada Example',
    maskedPhone: '*******4645',
    identityVerified: true,
    trustLevel: 'TRUSTED',
    trustScore: 70,
    discoverable: false,
    accountStatus: 'ACTIVE',
    scoreInputs: <String, dynamic>{
      'accountActive': true,
      'accountAgeMonths': 18,
      'kycVerified': true,
      'kycTier': 'TIER_2',
      'successfulIdentityVerifications': 1,
    },
  );

  testWidgets('shows the Verify Before You Pay discovery guidance',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: TrustSearchScreen()),
    );

    expect(find.text('Verify Before You Pay'), findsOneWidget);
    expect(
      find.text('Search by phone, Trust ID, or business name'),
      findsOneWidget,
    );
  });

  testWidgets('shows a public-safe search result and opens its profile',
      (WidgetTester tester) async {
    Future<List<TrustProfile>> search({
      required String query,
      required String kind,
    }) async =>
        <TrustProfile>[profile];

    await tester.pumpWidget(
      MaterialApp(home: TrustSearchScreen(searchProfiles: search)),
    );

    await tester.enterText(find.byType(TextField), '08021234645');
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pumpAndSettle();

    expect(find.text('Ada Example'), findsOneWidget);
    expect(find.text('*******4645'), findsOneWidget);
    expect(find.text('TRUSTED'), findsOneWidget);

    await tester.tap(find.byType(ListTile));
    await tester.pump();

    expect(
      find.byType(TrustProfileScreen, skipOffstage: false),
      findsOneWidget,
    );
  });

  testWidgets('shows a generic empty result without exposing privacy state',
      (WidgetTester tester) async {
    Future<List<TrustProfile>> search({
      required String query,
      required String kind,
    }) async =>
        <TrustProfile>[];

    await tester.pumpWidget(
      MaterialApp(home: TrustSearchScreen(searchProfiles: search)),
    );

    await tester.enterText(find.byType(TextField), '08021234645');
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pumpAndSettle();

    expect(find.text('No Trust profile found.'), findsOneWidget);
  });

  testWidgets('shows admin-only score inputs and discoverability',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: TrustProfileScreen(
          isAdminView: true,
          initialProfile: profile,
        ),
      ),
    );

    await tester.scrollUntilVisible(
      find.text('Admin review'),
      220,
    );
    expect(find.text('Admin review'), findsOneWidget);
    expect(find.text('Hidden'), findsOneWidget);
    expect(find.text('18 months'), findsOneWidget);
    expect(find.text('TIER_2'), findsOneWidget);
  });
}
