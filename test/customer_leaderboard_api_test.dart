import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/services/customer_leaderboard_api.dart';
import 'package:servicepay_app/customer_leaderboard_screen.dart';
import 'package:servicepay_app/customer_champions_dashboard_entry.dart';
import 'package:servicepay_app/customer_leaderboard_privacy_preference.dart';
import 'package:servicepay_app/customer_leaderboard_report_panel.dart';
import 'package:servicepay_app/profile_screen.dart';

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
    expect(find.text('Successful Transactions'), findsOneWidget);
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

    customerLeaderboardPrivacyChanged.value++;
    await tester.pumpAndSettle();
    expect(requestCount, 3);
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

  test('privacy API uses authenticated GET and exact PATCH payload', () async {
    SharedPreferences.setMockInitialValues({'auth_token': 'champion-session'});
    final requests = <http.Request>[];
    var serverPreference = false;
    final api = CustomerLeaderboardApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async {
        requests.add(request);
        if (request.method == 'PATCH') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          expect(body.keys.toList(), ['showFullName']);
          serverPreference = body['showFullName'] as bool;
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'showFullName': serverPreference},
          }),
          200,
        );
      }),
    );

    expect(await api.loadShowFullName(), isFalse);
    expect(await api.updateShowFullName(true), isTrue);
    expect(requests.map((request) => request.method), ['GET', 'PATCH']);
    for (final request in requests) {
      expect(request.url.path, '/api/customer-leaderboard/privacy');
      expect(request.headers['authorization'], 'Bearer champion-session');
    }
    expect(jsonDecode(requests.last.body), {'showFullName': true});
  });

  testWidgets(
      'privacy preference defaults off, reports failures without local save, and persists opt in and out',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'champion-session'});
    var serverPreference = false;
    var failNextPatch = true;
    var patchCount = 0;
    var reportRefreshes = 0;
    final api = CustomerLeaderboardApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async {
        if (request.method == 'PATCH') {
          patchCount++;
          if (failNextPatch) {
            failNextPatch = false;
            return http.Response(
              jsonEncode({'success': false, 'message': 'Save unavailable'}),
              503,
            );
          }
          serverPreference =
              (jsonDecode(request.body) as Map)['showFullName'] as bool;
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'showFullName': serverPreference},
          }),
          200,
        );
      }),
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CustomerLeaderboardPrivacyPreference(
          api: api,
          onChanged: () async {
            reportRefreshes++;
          },
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Show My Full Name on Champions Leaderboard'),
        findsOneWidget);
    var toggle = tester
        .widget<Switch>(find.byKey(const Key('champions-full-name-switch')));
    expect(toggle.value, isFalse);

    await tester.tap(find.byKey(const Key('champions-full-name-switch')));
    await tester.pumpAndSettle();
    expect(find.text('Save unavailable'), findsOneWidget);
    toggle = tester
        .widget<Switch>(find.byKey(const Key('champions-full-name-switch')));
    expect(toggle.value, isFalse);
    expect(serverPreference, isFalse);
    expect(reportRefreshes, 0);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('champions-full-name-switch')));
    await tester.pumpAndSettle();
    toggle = tester
        .widget<Switch>(find.byKey(const Key('champions-full-name-switch')));
    expect(toggle.value, isTrue);
    expect(serverPreference, isTrue);
    expect(reportRefreshes, 1);

    await tester.tap(find.byKey(const Key('champions-full-name-switch')));
    await tester.pumpAndSettle();
    toggle = tester
        .widget<Switch>(find.byKey(const Key('champions-full-name-switch')));
    expect(toggle.value, isFalse);
    expect(serverPreference, isFalse);
    expect(reportRefreshes, 2);
    expect(patchCount, 3);
  });

  testWidgets(
      'profile settings expose privacy preference when Champions is off',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'champion-session'});
    final client = MockClient((request) async {
      if (request.url.path == '/api/auth/profile') {
        return http.Response(
          jsonEncode({
            'success': true,
            'user': {
              'fullName': 'Ada Customer',
              'phone': '08000000000',
              'email': 'ada@example.test',
              'role': 'CUSTOMER',
              'status': 'ACTIVE',
              'transactionPinSet': false,
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/kyc/status') {
        return http.Response(
          jsonEncode({
            'success': true,
            'kyc': <String, dynamic>{},
            'servicepayLimits': <String, dynamic>{},
          }),
          200,
        );
      }
      if (request.url.path == '/api/customer-leaderboard/privacy') {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'showFullName': false},
          }),
          200,
        );
      }
      return http.Response(jsonEncode({'success': true}), 200);
    });
    addTearDown(client.close);
    await tester.pumpWidget(MaterialApp(home: ProfileScreen(client: client)));
    await tester.pumpAndSettle();
    for (var attempt = 0;
        attempt < 6 &&
            find
                .text('Show My Full Name on Champions Leaderboard')
                .evaluate()
                .isEmpty;
        attempt++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -650));
      await tester.pumpAndSettle();
    }
    await tester
        .ensureVisible(find.text('Show My Full Name on Champions Leaderboard'));
    await tester.pumpAndSettle();
    expect(find.text('Show My Full Name on Champions Leaderboard'),
        findsOneWidget);
    expect(
      tester
          .widget<Switch>(find.byKey(const Key('champions-full-name-switch')))
          .value,
      isFalse,
    );
  });

  testWidgets('transactions labels, NGN grouping and long names wrap on mobile',
      (tester) async {
    tester.view.physicalSize = const Size(320, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const longName =
        'A very long registered customer name that should wrap gracefully on mobile';
    final report = CustomerLeaderboardReport.fromJson({
      'success': true,
      'data': {
        'enabled': true,
        'period': {'month': '2026-09', 'timeZone': 'Africa/Lagos'},
        'countTop': [
          {
            'rank': 1,
            'displayName': longName,
            'count': 113,
            'value': 250000,
            'isMe': false,
          },
        ],
        'valueTop': [
          {
            'rank': 1,
            'displayName': longName,
            'count': 113,
            'value': 250000.5,
            'isMe': false,
          },
          {
            'rank': 2,
            'displayName': 'Another customer',
            'count': 4,
            'value': 250000,
            'isMe': false,
          },
        ],
        'me': {
          'countRank': 4,
          'valueRank': 3,
          'count': 2,
          'value': 250000.5,
          'transactionsNeededToTop10': 0,
        },
      },
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: CustomerLeaderboardReportPanel(report: report, compact: true),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Successful Transactions'), findsOneWidget);
    expect(find.text('₦250,000.50'), findsOneWidget);
    final countList = find.byKey(const ValueKey('champions-count-list'));
    await tester.ensureVisible(countList);
    await tester.pumpAndSettle();
    expect(find.text(longName), findsOneWidget);
    expect(find.text('113 Transactions'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Highest Transaction Value'));
    await tester.pumpAndSettle();
    final valueList = find.byKey(const ValueKey('champions-value-list'));
    await tester.ensureVisible(valueList);
    await tester.pumpAndSettle();
    expect(find.text(longName), findsOneWidget);
    expect(find.text('₦250,000'), findsOneWidget);
    expect(find.text('₦250,000.50'), findsNWidgets(2));
    final longNameWidget = tester.widget<Text>(find.text(longName));
    expect(longNameWidget.softWrap, isTrue);
    expect(longNameWidget.maxLines, isNull);
    expect(tester.takeException(), isNull);
  });

  test('Naira formatting rounds decimal carries before grouping', () {
    expect(formatLeaderboardNaira(999.999), '₦1,000.00');
    expect(formatLeaderboardNaira(250000.5), '₦250,000.50');
    expect(formatLeaderboardNaira(250000), '₦250,000');
  });
}
