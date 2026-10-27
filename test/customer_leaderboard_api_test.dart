import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/services/customer_leaderboard_api.dart';
import 'package:servicepay_app/customer_leaderboard_screen.dart';
import 'package:servicepay_app/customer_champions_dashboard_entry.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('parses the privacy-safe monthly contract and preserves personal ranks',
      () {
    final report = CustomerLeaderboardReport.fromJson({
      'success': true,
      'data': {
        'enabled': true,
        'period': {'month': '2026-09', 'timeZone': 'Africa/Lagos'},
        'countTop': [
          {
            'rank': 1,
            'displayName': 'A*** K***',
            'count': 12,
            'value': 9400,
            'isMe': true,
          }
        ],
        'valueTop': <Object>[],
        'me': {
          'countRank': 1,
          'valueRank': null,
          'count': 12,
          'value': 9400,
          'transactionsNeededToTop10': 0,
        },
        'rules': {
          'eligibleServices': ['airtime'],
          'minAmount': 0,
          'periodBasis': 'createdAt',
          'historyUsesCurrentRules': true,
        },
        'calculatedAt': '2026-09-23T12:00:00Z',
        'cachedUntil': '2026-09-23T12:01:00Z',
      },
    });
    expect(report.enabled, isTrue);
    expect(report.timeZone, 'Africa/Lagos');
    expect(report.countTop.single.displayName, 'A*** K***');
    expect(report.countTop.single.rank, 1);
    expect(report.countTop.single.isMe, isTrue);
    expect(report.me['countRank'], 1);
    expect(report.me['valueRank'], isNull);
    expect(report.valueTop, isEmpty);
    expect(report.rules['periodBasis'], 'createdAt');
    expect(report.rules['historyUsesCurrentRules'], isTrue);
  });

  testWidgets('monthly report exposes both ranking tabs and masked entries',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'champion-session'});
    final api = CustomerLeaderboardApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async => http.Response(
            jsonEncode({
              'success': true,
              'data': {
                'enabled': true,
                'period': {'month': '2026-09', 'timeZone': 'Africa/Lagos'},
                'countTop': [
                  {
                    'rank': 1,
                    'displayName': 'A*** K***',
                    'count': 4,
                    'value': 2200,
                    'isMe': false
                  }
                ],
                'valueTop': [
                  {
                    'rank': 1,
                    'displayName': 'J*** O***',
                    'count': 2,
                    'value': 6000,
                    'isMe': false
                  }
                ],
                'me': {
                  'countRank': null,
                  'valueRank': null,
                  'count': 0,
                  'value': 0,
                  'transactionsNeededToTop10': 3
                },
                'calculatedAt': '2026-09-23T12:00:00Z',
                'cachedUntil': '2026-09-23T12:01:00Z',
              },
            }),
            200,
          )),
    );
    await tester
        .pumpWidget(MaterialApp(home: CustomerLeaderboardScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.text('SERVICEPAY CHAMPIONS'), findsOneWidget);
    await tester.drag(find.byType(ListView).first, const Offset(0, -650));
    await tester.pumpAndSettle();
    expect(find.text('Most Transactions'), findsOneWidget);
    expect(find.text('Highest Transaction Value'), findsOneWidget);
    expect(find.text('A*** K***'), findsOneWidget);
  });

  testWidgets(
      'compact dashboard section refreshes from disabled and reaches all ten on narrow screens',
      (tester) async {
    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({'auth_token': 'champion-session'});

    var requestCount = 0;
    Map<String, dynamic> row(int rank) => {
          'rank': rank,
          'displayName': 'C*** ${rank.toString().padLeft(2, '0')}',
          'count': 12 - rank,
          'value': 12000 - (rank * 100),
          'isMe': false,
        };
    final api = CustomerLeaderboardApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async {
        requestCount++;
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'enabled': requestCount > 1,
              'period': {'month': '2026-09', 'timeZone': 'Africa/Lagos'},
              'countTop': List.generate(10, (index) => row(index + 1)),
              'valueTop': List.generate(10, (index) => row(index + 1)),
              'me': {
                'countRank': 19,
                'valueRank': 22,
                'count': 4,
                'value': 4825.5,
                'transactionsNeededToTop10': 7,
              },
              'calculatedAt': '2026-09-23T12:00:00Z',
              'cachedUntil': '2026-09-23T12:01:00Z',
            },
          }),
          200,
        );
      }),
    );

    var refreshVersion = 0;
    late StateSetter refreshParent;
    await tester.pumpWidget(MaterialApp(
      home: StatefulBuilder(
        builder: (context, setState) {
          refreshParent = setState;
          return Scaffold(
            body: SingleChildScrollView(
              child: CustomerChampionsDashboardEntry(
                refreshVersion: refreshVersion,
                api: api,
              ),
            ),
          );
        },
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('SERVICEPAY CHAMPIONS'), findsNothing);

    refreshParent(() => refreshVersion++);
    await tester.pumpAndSettle();
    expect(find.text('SERVICEPAY CHAMPIONS'), findsOneWidget);
    expect(find.text('Most Transactions'), findsOneWidget);
    expect(find.text('Highest Transaction Value'), findsOneWidget);
    expect(find.text('Successful services'), findsOneWidget);
    expect(find.text('₦4,825.50'), findsOneWidget);
    expect(find.textContaining('7 extra qualifying purchases'), findsOneWidget);
    expect(find.text('Open full monthly report'), findsOneWidget);
    await tester
        .ensureVisible(find.byKey(const ValueKey('champions-count-list')));
    await tester.pumpAndSettle();
    expect(find.text('C*** 01'), findsOneWidget);

    await tester.drag(find.byKey(const ValueKey('champions-count-list')),
        const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('C*** 10'), findsOneWidget);

    await tester.tap(find.text('Highest Transaction Value'));
    await tester.pumpAndSettle();
    final valueList = find.byKey(const ValueKey('champions-value-list'));
    expect(valueList, findsOneWidget);
    expect(find.text('C*** 01'), findsOneWidget);
    await tester.ensureVisible(valueList);
    await tester.pumpAndSettle();
    await tester.drag(valueList, const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('C*** 10'), findsOneWidget);
  });

  test('uses SessionStore auth and requests only the requested month',
      () async {
    SharedPreferences.setMockInitialValues({'auth_token': 'champion-session'});
    http.Request? captured;
    final api = CustomerLeaderboardApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'enabled': false,
              'period': {'month': '2026-09', 'timeZone': 'Africa/Lagos'},
              'countTop': [],
              'valueTop': [],
              'me': {
                'countRank': null,
                'valueRank': null,
                'count': 0,
                'value': 0,
                'transactionsNeededToTop10': 0
              },
              'calculatedAt': '2026-09-23T12:00:00Z',
              'cachedUntil': '2026-09-23T12:01:00Z',
            },
          }),
          200,
        );
      }),
    );
    final result = await api.load('2026-09');
    expect(result.enabled, isFalse);
    expect(captured!.url.path, '/api/customer-leaderboard');
    expect(captured!.url.queryParameters, {'month': '2026-09'});
    expect(captured!.headers['authorization'], 'Bearer champion-session');
  });
}
