import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_feature_controls_api.dart';
import 'package:servicepay_app/admin/admin_feature_controls_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Feature Controls never writes before explicit confirmation',
      (tester) async {
    var putCount = 0;
    Map<String, dynamic>? putBody;
    final client = MockClient((request) async {
      if (request.method == 'PUT') {
        putCount += 1;
        putBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
            jsonEncode(<String, dynamic>{'success': true}), 200);
      }
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'featureToggles': <String, bool>{
              'airtime': true,
              'delivery': false,
            },
          },
        }),
        200,
      );
    });
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'test-token',
      'user_role': 'HEAD_OFFICE',
    });

    await tester.pumpWidget(
      MaterialApp(
        home: AdminFeatureControlsScreen(
          api: AdminFeatureControlsApi(client: client),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Feature Controls'), findsOneWidget);
    expect(putCount, 0);
    await tester.tap(find.widgetWithText(SwitchListTile, 'Airtime'));
    await tester.pump();
    expect(putCount, 0);

    await tester.enterText(
      find.byType(TextField),
      'Scheduled service maintenance',
    );
    await tester.tap(find.text('SAVE FEATURE CONTROLS'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm feature-control changes'), findsOneWidget);
    expect(putCount, 0);

    await tester.tap(find.text('CONFIRM CHANGES'));
    await tester.pumpAndSettle();
    expect(putCount, 1);
    expect(putBody?['reason'], 'Scheduled service maintenance');
    expect(
      (putBody?['fintechControl'] as Map)['featureToggles'],
      <String, bool>{'airtime': false, 'delivery': false},
    );
  });

  testWidgets('Feature Controls is read-only outside Head Office',
      (tester) async {
    final client = MockClient((request) async => http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'featureToggles': <String, bool>{'airtime': true},
            },
          }),
          200,
        ));
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'test-token',
      'user_role': 'ADMIN',
    });

    await tester.pumpWidget(
      MaterialApp(
        home: AdminFeatureControlsScreen(
          api: AdminFeatureControlsApi(client: client),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('read-only access'), findsOneWidget);
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile)).onChanged,
      isNull,
    );
  });
}
