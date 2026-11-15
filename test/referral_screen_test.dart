import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/referral_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('v2 referral screen is narrow-layout safe and wires copy/share', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'customer-token',
    });
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    String? clipboardValue;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        clipboardValue = (call.arguments as Map)['text'] as String;
      }
      return null;
    });
    var sharedText = '';
    final requestedPages = <int>[];
    final client = MockClient((request) async {
      final page = int.parse(request.url.queryParameters['historyPage'] ?? '0');
      requestedPages.add(page);
      return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'referralCode': 'SP-TEST',
            'totalReferralEarnings': 101,
            'registrationBonusesEarned': 100,
            'transactionCommissionsEarned': 1,
            'legacyRewards': 2000,
            'programme': <String, dynamic>{'version': 2, 'enabled': true},
            'referrals': <dynamic>[],
            'historyPage': page,
            'historyPages': 2,
            'historyTotal': 51,
            'history': <dynamic>[
              <String, dynamic>{
                'id': 'event-$page',
                'reference': 'REF-$page',
                'date': '2025-03-03T10:00:00Z',
                'amount': 1,
                'direction': 'CREDIT',
                'rewardType': 'TRANSACTION',
                'referredCustomer': <String, dynamic>{'firstName': 'Ada'},
              },
            ],
          }),
          200);
    });

    await tester.pumpWidget(MaterialApp(
      home: ReferralScreen(
        client: client,
        shareReferral: (params) async {
          sharedText = params.text ?? '';
        },
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('SP-TEST'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('New-policy earnings'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('₦101'), findsOneWidget);
    expect(find.textContaining('₦100 once'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('Page 1 of 2'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(requestedPages, <int>[1, 2]);
    expect(find.textContaining('Page 2 of 2'), findsOneWidget);
    for (var step = 0; step < 4; step++) {
      await tester.drag(
        find.byType(ListView).first,
        const Offset(0, 900),
      );
      await tester.pumpAndSettle();
      if (find.text('SP-TEST').evaluate().isNotEmpty) break;
    }
    expect(find.text('SP-TEST'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('New-policy earnings'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('₦101'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Copy Code'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Copy Code'));
    await tester.pump();
    expect(clipboardValue, 'SP-TEST');
    await tester.scrollUntilVisible(
      find.text('Share Referral Link'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Share Referral Link'));
    await tester.pump();
    expect(sharedText, contains('https://servicepay.ng/register?ref=SP-TEST'));
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox());
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });
}
