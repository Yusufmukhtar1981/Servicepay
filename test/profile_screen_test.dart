import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/profile_screen.dart';
import 'package:servicepay_app/security_utils.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'test-token',
    });
  });

  http.Client profileClient({http.Response? passwordResponse}) {
    return MockClient((http.Request request) async {
      if (request.url.path == '/api/auth/profile') {
        return http.Response(
          jsonEncode(<String, Object>{
            'success': true,
            'user': <String, Object>{
              'id': 'SP-CUSTOMER-1024',
              'fullName': 'Amina Yusuf',
              'phone': '08012345678',
              'email': 'amina@example.com',
              'role': 'CUSTOMER',
              'status': 'ACTIVE',
              'state': 'Lagos',
              'lga': 'Ikeja',
              'zone': 'South West',
              'walletBalance': 25000,
              'transactionPinSet': true,
              'profilePhotoUrl': '',
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/kyc/status') {
        return http.Response(
          jsonEncode(<String, Object>{
            'success': true,
            'kyc': <String, Object>{
              'level': 'TIER_2',
              'requestedLevel': 'TIER_3',
              'status': 'UNDER_REVIEW',
              'identity': <String, Object>{
                'ninVerified': true,
                'bvnVerified': false,
              },
              'documents': <String, Object>{
                'idDocumentUploaded': true,
                'selfieUploaded': true,
                'proofOfAddressUploaded': false,
              },
            },
            'servicepayLimits': <String, Object>{
              'perTransaction': 200000,
              'daily': 1000000,
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/auth/change-password') {
        return passwordResponse ??
            http.Response(
              '{"success":true,"message":"Password changed successfully."}',
              200,
            );
      }
      return http.Response('{"success":false}', 404);
    });
  }

  Future<void> pumpProfile(
    WidgetTester tester, {
    Size size = const Size(390, 844),
    http.Client? client,
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: ProfileScreen(client: client ?? profileClient()),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows live identity and KYC tier details', (tester) async {
    await pumpProfile(tester);

    expect(find.text('Amina Yusuf'), findsWidgets);
    expect(find.byKey(const Key('profile-photo-button')), findsOneWidget);
    expect(find.byKey(const Key('profile-kyc-tier-card')), findsOneWidget);
    expect(find.text('Tier 2'), findsOneWidget);
    expect(find.text('Under Review'), findsOneWidget);
    expect(find.text('Upgrade request: TIER 3'), findsOneWidget);
    expect(find.text('₦200,000'), findsOneWidget);
    expect(find.text('₦1,000,000'), findsOneWidget);
  });

  testWidgets('renders without overflow on narrow and wide screens',
      (tester) async {
    await pumpProfile(tester, size: const Size(320, 700));
    expect(tester.takeException(), isNull);

    await tester.binding.setSurfaceSize(const Size(1100, 900));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  test('uses the shared strong-password policy', () {
    expect(isStrongPassword('weak'), isFalse);
    expect(isStrongPassword('lowercase1!'), isFalse);
    expect(isStrongPassword('ValidPass1!'), isTrue);
  });
}
