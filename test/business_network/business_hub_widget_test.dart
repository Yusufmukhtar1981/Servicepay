import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/business_network/business_hub_screen.dart';
import 'package:servicepay_app/business_network/business_network_api.dart';
import 'package:servicepay_app/business_network/business_transaction_record_screen.dart';

Future<void> _scrollTo(WidgetTester tester, Finder target) async {
  final verticalScrollable = find
      .byWidgetPredicate(
        (widget) =>
            widget is Scrollable && widget.axisDirection == AxisDirection.down,
      )
      .first;
  if (target.evaluate().isNotEmpty) {
    final viewportHeight =
        tester.view.physicalSize.height / tester.view.devicePixelRatio;
    for (var attempt = 0; attempt < 8; attempt++) {
      final y = tester.getCenter(target).dy;
      if (y >= 64 && y <= viewportHeight - 40) return;
      await tester.drag(
        verticalScrollable,
        Offset(0, y > viewportHeight / 2 ? -240 : 240),
      );
      await tester.pumpAndSettle();
    }
    return;
  }
  await tester.scrollUntilVisible(
    target,
    320,
    maxScrolls: 20,
    scrollable: verticalScrollable,
  );
}

void main() {
  testWidgets('hub exposes both independent application paths', (tester) async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/business-network/me');
      return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {
                'fullName': 'Ada Okafor',
                'phone': '08000000000',
                'email': 'ada@example.test'
              },
              'applications': [],
              'memberships': [],
              'features': {},
            },
          }),
          200);
    });
    await tester.pumpWidget(MaterialApp(
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://test.servicepay.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Business Hub'), findsOneWidget);
    expect(find.text('Become an Agent'), findsOneWidget);
    expect(find.text('Register as a Merchant'), findsOneWidget);
    await _scrollTo(tester, find.text('Business Applications'));
    expect(find.text('Business Applications'), findsOneWidget);
    client.close();
  });

  testWidgets('merchant form uses server-configured categories and services',
      (tester) async {
    final client = MockClient((_) async => http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada'},
              'applications': [],
              'memberships': [],
              'categories': ['Market retail', 'Food services'],
              'supportedServices': [
                'AIRTIME',
                'DATA',
                'ELECTRICITY',
                'CABLE',
                'EXAM_PIN',
              ],
            },
          }),
          200,
        ));
    await tester.pumpWidget(MaterialApp(
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://test.servicepay.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Register as a Merchant'));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Business category'));
    await tester.tap(find.text('Business category'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Market retail').last);
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Airtime'));
    expect(find.text('Airtime'), findsOneWidget);
    await _scrollTo(tester, find.text('Exam PIN'));
    expect(find.text('Exam PIN'), findsOneWidget);
    client.close();
  });

  testWidgets('support retries reuse one idempotency key until accepted',
      (tester) async {
    final submitted = <Map<String, dynamic>>[];
    var supportAttempt = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada'},
              'applications': [],
              'memberships': [],
              'features': {},
            },
          }),
          200,
        );
      }
      if (request.url.path.endsWith('/support')) {
        submitted.add(jsonDecode(request.body) as Map<String, dynamic>);
        supportAttempt++;
        if (supportAttempt == 1) {
          return http.Response(
            jsonEncode({'success': false, 'message': 'Try again'}),
            503,
          );
        }
        return http.Response(jsonEncode({'success': true, 'data': {}}), 200);
      }
      return http.Response(
        jsonEncode({'success': false, 'message': 'Unexpected request'}),
        404,
      );
    });
    await tester.pumpWidget(MaterialApp(
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://test.servicepay.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Business Support'));
    await tester.tap(find.text('Business Support'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byType(TextFormField).at(0), 'Account question');
    await tester.enterText(find.byType(TextFormField).at(1),
        'Please review my business account status.');
    await _scrollTo(tester, find.text('Send message'));
    await tester.tap(find.text('Send message'));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Send message'));
    await tester.tap(find.text('Send message'));
    await tester.pumpAndSettle();
    expect(submitted, hasLength(2));
    expect(submitted[0]['idempotencyKey'], isNotEmpty);
    expect(submitted[0]['idempotencyKey'], submitted[1]['idempotencyKey']);
    expect(submitted[0]['idempotencyKey'].toString().length,
        lessThanOrEqualTo(90));
    client.close();
  });

  testWidgets('business record preserves actual API status and disclaimer',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: BusinessTransactionRecordScreen(transaction: {
        '_id': 'tx-1',
        'reference': 'SP-REF-7',
        'serviceType': 'Airtime',
        'status': 'PENDING',
        'amountKobo': 25000,
        'createdAt': '2026-08-26T10:20:00Z',
      }),
    ));
    await _scrollTo(tester, find.text('Share record'));
    expect(find.text('PENDING'), findsOneWidget);
    expect(find.textContaining('not a provider receipt'), findsOneWidget);
    expect(find.text('Download record'), findsOneWidget);
    expect(find.text('Share record'), findsOneWidget);
  });

  testWidgets('suspended owner can read history without dashboard privileges',
      (tester) async {
    var dashboardRequested = false;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada', '_id': 'owner-1'},
              'applications': [],
              'memberships': [
                {
                  'kind': 'AGENT',
                  'profileId': 'agent-1',
                  'status': 'SUSPENDED',
                  'isOwner': true,
                  'networkId': 'SP-AG-1',
                }
              ],
              'categories': [],
              'supportedServices': [],
            },
          }),
          200,
        );
      }
      if (request.url.path.endsWith('/dashboard/agent')) {
        dashboardRequested = true;
        return http.Response(
          jsonEncode({'success': true, 'data': {}}),
          200,
        );
      }
      if (request.url.path.endsWith('/transactions/agent')) {
        expect(request.url.queryParameters['profileId'], 'agent-1');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'items': [], 'page': 1, 'total': 0}
          }),
          200,
        );
      }
      if (request.url.path.endsWith('/commissions/agent')) {
        expect(request.url.queryParameters['profileId'], 'agent-1');
        expect(request.url.queryParameters['page'], '1');
        expect(request.url.queryParameters['limit'], '50');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [],
              'total': 0,
              'totals': {
                'earnedKobo': 8900,
                'pendingKobo': 0,
                'paidKobo': 0,
                'reversedKobo': 0,
                'recoveryKobo': 0,
              },
            },
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({'success': false, 'message': 'Unexpected route'}),
        404,
      );
    });
    await tester.pumpWidget(MaterialApp(
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://test.servicepay.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('My Agent Dashboard'));
    await tester.pumpAndSettle();
    expect(dashboardRequested, isFalse);
    expect(find.text('SUSPENDED'), findsOneWidget);
    await _scrollTo(tester, find.textContaining('Earned  ₦89.00'));
    expect(find.textContaining('Earned  ₦89.00'), findsOneWidget);
    await _scrollTo(tester, find.text('Existing transaction history'));
    expect(find.text('Existing transaction history'), findsOneWidget);
    expect(find.textContaining('new transaction attribution are unavailable'),
        findsOneWidget);
    client.close();
  });

  testWidgets('merchant owner can pause branches and reinvite staff safely',
      (tester) async {
    var branchStatus = 'ACTIVE';
    final patchedRequests = <http.Request>[];
    final commissionPages = <String>[];
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada', '_id': 'owner-1'},
              'applications': [],
              'memberships': [
                {
                  'kind': 'MERCHANT',
                  'profileId': 'merchant-1',
                  'status': 'APPROVED',
                  'isOwner': true,
                }
              ],
              'categories': [],
              'supportedServices': [],
            },
          }),
          200,
        );
      }
      if (path.endsWith('/dashboard/merchant')) {
        expect(request.url.queryParameters['profileId'], 'merchant-1');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'profile': {'status': 'APPROVED', 'kind': 'MERCHANT'},
              'summary': {},
              'features': {},
            },
          }),
          200,
        );
      }
      if (path.endsWith('/transactions/merchant')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'items': [], 'total': 0},
          }),
          200,
        );
      }
      if (path.endsWith('/commissions/merchant')) {
        expect(request.url.queryParameters['profileId'], 'merchant-1');
        expect(request.url.queryParameters['limit'], '50');
        commissionPages.add(request.url.queryParameters['page'] ?? '');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [
                {
                  'transaction': 'mongo-transaction-secret',
                  'reference': 'BN-REF-4021',
                  'serviceType': 'AIRTIME',
                  'transactionStatus': 'SUCCESSFUL',
                  'event': 'SALE',
                  'amountKobo': 1250,
                }
              ],
              'total': 101,
              'page': int.parse(request.url.queryParameters['page'] ?? '1'),
              'limit': 50,
              'totals': {
                'earnedKobo': 12500,
                'pendingKobo': 0,
                'paidKobo': 0,
                'reversedKobo': 0,
                'recoveryKobo': 0,
              },
            },
          }),
          200,
        );
      }
      if (path.endsWith('/profiles/merchant-1/branches')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [
                {
                  '_id': 'branch-1',
                  'name': 'Central',
                  'address': 'Lagos',
                  'status': branchStatus,
                }
              ]
            },
          }),
          200,
        );
      }
      if (path.endsWith('/profiles/merchant-1/staff')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [
                {
                  '_id': 'staff-1',
                  'userId': 'staff-user',
                  'branchId': 'branch-1',
                  'status': 'ACTIVE',
                  'permissions': ['reports.view'],
                }
              ]
            },
          }),
          200,
        );
      }
      if (request.method == 'PATCH') {
        patchedRequests.add(request);
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (path.endsWith('/branches/branch-1')) {
          branchStatus = body['status'] as String;
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'updated': true}
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({'success': false, 'message': 'Unexpected route: $path'}),
        404,
      );
    });
    await tester.pumpWidget(MaterialApp(
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://test.servicepay.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('My Business Dashboard'));
    await tester.tap(find.text('My Business Dashboard'));
    await tester.pumpAndSettle();
    expect(find.textContaining('BN-REF-4021'), findsOneWidget);
    expect(find.textContaining('mongo-transaction-secret'), findsNothing);
    await _scrollTo(tester, find.text('Next'));
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(commissionPages, ['1', '2']);
    await _scrollTo(tester, find.text('Pause'));
    await tester.tap(find.text('Pause'));
    await tester.pumpAndSettle();
    expect(branchStatus, 'SUSPENDED');
    expect(patchedRequests.single.url.path,
        '/api/business-network/profiles/merchant-1/branches/branch-1');
    expect(jsonDecode(patchedRequests.single.body), {'status': 'SUSPENDED'});

    await _scrollTo(tester, find.byTooltip('Staff access actions'));
    await tester.tap(find.byTooltip('Staff access actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reinvite / change access'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use permitted payment features'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send invitation'));
    await tester.pumpAndSettle();
    final staffPatch = patchedRequests.last;
    expect(staffPatch.url.path, '/api/business-network/staff/staff-1');
    final staffBody = jsonDecode(staffPatch.body) as Map<String, dynamic>;
    expect(staffBody['status'], 'INVITED');
    expect(staffBody['branchId'], 'branch-1');
    expect(staffBody['permissions'],
        containsAll(['reports.view', 'payments.view']));
    expect(staffBody['status'], isNot('ACTIVE'));
    client.close();
  });
}
