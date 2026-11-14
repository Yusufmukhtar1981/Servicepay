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
      if (y >= 64 && y <= viewportHeight - 120) return;
      await tester.drag(
        verticalScrollable,
        Offset(0, y > viewportHeight / 2 ? -240 : 240),
      );
      await tester.pumpAndSettle();
    }
    await tester.ensureVisible(target.first);
    await tester.pumpAndSettle();
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

  testWidgets('Business Hub AppBar overrides inherited white foreground styles',
      (tester) async {
    const ink = Color(0xFF18372A);
    final client = MockClient((request) async => http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada'},
              'applications': [],
              'memberships': [],
              'categories': [],
              'supportedServices': [],
            },
          }),
          200,
        ));
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData(
        appBarTheme: const AppBarTheme(
          titleTextStyle: TextStyle(color: Colors.white),
          iconTheme: IconThemeData(color: Colors.white),
          actionsIconTheme: IconThemeData(color: Colors.white),
        ),
      ),
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://test.servicepay.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Become an Agent'));
    await tester.pumpAndSettle();

    final appBar = tester.widget<AppBar>(find.byType(AppBar));
    expect(appBar.titleTextStyle?.color, ink);
    expect(appBar.iconTheme?.color, ink);
    expect(appBar.actionsIconTheme?.color, ink);
    expect(
      tester.widget<Text>(find.text('Business application')).style?.color,
      ink,
    );
    expect(tester.widget<Icon>(find.byIcon(Icons.arrow_back)).color, ink);
    expect(tester.widget<Icon>(find.byIcon(Icons.refresh)).color, ink);
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

  testWidgets('application type switch preserves business field values',
      (tester) async {
    final client = MockClient((request) async => http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada'},
              'applications': [],
              'memberships': [],
              'categories': ['Market retail'],
              'serviceCatalogue': {
                'AGENT': [
                  {
                    'code': 'AIRTIME',
                    'label': 'Airtime',
                    'preferencesEnabled': true,
                    'processable': true,
                    'available': true,
                  }
                ],
                'MERCHANT': [
                  {
                    'code': 'MARKETPLACE',
                    'label': 'Marketplace',
                    'preferencesEnabled': true,
                    'processable': false,
                    'available': true,
                  }
                ],
              },
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
    await tester.tap(find.text('Become an Agent'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, 'Ada Mini Mart');
    await tester.tap(find.text('SME Merchant'));
    await tester.pumpAndSettle();

    expect(find.text('SME Merchant application'), findsOneWidget);
    expect(find.text('Business category'), findsOneWidget);
    expect(
      tester
          .widget<TextFormField>(find.byType(TextFormField).first)
          .controller!
          .text,
      'Ada Mini Mart',
    );
    await _scrollTo(tester, find.text('Marketplace'));
    expect(find.text('Marketplace'), findsOneWidget);
    expect(find.text('Airtime'), findsNothing);
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
    await tester.enterText(find.byType(TextFormField).at(2), 'SP-OWN-510');
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
    expect(submitted[0]['transactionReference'], 'SP-OWN-510');
    expect(submitted[1]['transactionReference'], 'SP-OWN-510');
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

  testWidgets(
      'payments-only Merchant staff sees own-wallet tools without report requests',
      (tester) async {
    final reportRequests = <String>[];
    var eligibleRequested = false;
    var attributionRequested = false;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Mina', '_id': 'customer-1'},
              'applications': [],
              'memberships': [
                {
                  '_id': 'staff-1',
                  'profile': {
                    '_id': 'merchant-1',
                    'networkId': 'MER-104',
                    'details': {'businessName': 'Mina Market'},
                    'status': 'APPROVED',
                  },
                  'branch': 'branch-1',
                  'permissions': ['payments'],
                  'status': 'ACTIVE',
                }
              ],
              'categories': [],
              'supportedServices': [],
            },
          }),
          200,
        );
      }
      if (path.endsWith('/dashboard/merchant') ||
          (path.endsWith('/transactions/merchant') &&
              request.method == 'GET') ||
          path.endsWith('/commissions/merchant')) {
        reportRequests.add(path);
        return http.Response(
          jsonEncode({'success': false, 'message': 'Reports not permitted'}),
          403,
        );
      }
      if (path.endsWith('/eligible-transactions/merchant')) {
        eligibleRequested = true;
        expect(request.url.queryParameters['profileId'], 'merchant-1');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [
                {
                  '_id': 'own-purchase-1',
                  'reference': 'SP-OWN-510',
                  'serviceType': 'AIRTIME',
                  'status': 'SUCCESSFUL',
                }
              ],
            },
          }),
          200,
        );
      }
      if (path.endsWith('/transactions/merchant') && request.method == 'POST') {
        attributionRequested = true;
        expect(request.url.queryParameters['profileId'], 'merchant-1');
        expect(
          jsonDecode(request.body),
          {'transactionId': 'own-purchase-1', 'consentAcknowledged': true},
        );
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'activity': {}}
          }),
          201,
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

    expect(reportRequests, isEmpty);
    expect(find.textContaining('does not include business reporting'),
        findsOneWidget);
    expect(find.text('Transaction history'), findsNothing);
    expect(find.text('Transactions'), findsNothing);
    await _scrollTo(tester, find.text('Find my eligible purchases'));
    await tester.tap(find.text('Find my eligible purchases'));
    await tester.pumpAndSettle();
    expect(eligibleRequested, isTrue);
    await _scrollTo(tester, find.text('Attribute'));
    await tester.tap(find.text('Attribute'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('I have consent'));
    await tester.pumpAndSettle();
    expect(attributionRequested, isTrue);
    expect(reportRequests, isEmpty);
    client.close();
  });

  testWidgets('reports-only Merchant staff cannot access payment tools',
      (tester) async {
    final requestedPaths = <String>[];
    final client = MockClient((request) async {
      final path = request.url.path;
      requestedPaths.add(path);
      if (path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Mina', '_id': 'customer-1'},
              'applications': [],
              'memberships': [
                {
                  '_id': 'staff-2',
                  'profile': {
                    '_id': 'merchant-2',
                    'networkId': 'MER-208',
                    'details': {'businessName': 'Kite Corner'},
                    'status': 'APPROVED',
                  },
                  'branch': 'branch-2',
                  'permissions': ['reports'],
                  'status': 'ACTIVE',
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
        expect(request.url.queryParameters['profileId'], 'merchant-2');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'profile': {
                '_id': 'merchant-2',
                'networkId': 'MER-208',
                'kind': 'MERCHANT',
                'status': 'APPROVED',
                'details': {'businessName': 'Kite Corner'},
              },
              'summary': {
                'total': 3,
                'successful': 2,
                'pending': 1,
                'failed': 0,
                'volumeKobo': 12000,
              },
              'features': {},
            },
          }),
          200,
        );
      }
      if (path.endsWith('/transactions/merchant')) {
        expect(request.url.queryParameters['profileId'], 'merchant-2');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'items': [], 'total': 0},
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

    expect(find.textContaining('Kite Corner'), findsOneWidget);
    await _scrollTo(tester, find.text('Transaction history'));
    expect(find.text('Transaction history'), findsOneWidget);
    expect(find.text('Link own purchase'), findsNothing);
    expect(find.text('Find my eligible purchases'), findsNothing);
    expect(find.text('Pay a bill from my account'), findsNothing);
    expect(
      requestedPaths
          .where((path) => path.endsWith('/eligible-transactions/merchant')),
      isEmpty,
    );
    expect(
        requestedPaths, contains('/api/business-network/dashboard/merchant'));
    expect(requestedPaths,
        contains('/api/business-network/transactions/merchant'));
    client.close();
  });

  testWidgets(
      'Agent draft saves incomplete data, advances revision, and retries submit',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    Map<String, dynamic>? profile;
    final putBodies = <Map<String, dynamic>>[];
    var submitAttempts = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {
                'fullName': 'Ada Okafor',
                'phone': '08000000000',
                'email': 'ada@example.test',
              },
              'applications': profile == null ? [] : [profile],
              'memberships': [],
              'categories': ['Market retail'],
              'serviceCatalogue': {
                'AGENT': [
                  {
                    'code': 'AIRTIME',
                    'label': 'Airtime',
                    'category': 'Bill payments',
                    'preferencesEnabled': true,
                    'processable': true,
                    'available': true,
                  }
                ],
                'MERCHANT': [],
              },
            },
          }),
          200,
        );
      }
      if (request.method == 'PUT') {
        expect(request.url.path, '/api/business-network/applications/AGENT');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        putBodies.add(body);
        final revision = (body['revision'] as num).toInt() + 1;
        profile = {
          'kind': 'AGENT',
          'status': 'DRAFT',
          'revision': revision,
          'networkId': 'BN-AG-774',
          'details': body,
        };
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'profile': profile}
          }),
          200,
        );
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/applications/AGENT/submit')) {
        submitAttempts++;
        if (submitAttempts == 1) {
          return http.Response(
              jsonEncode({'success': false, 'message': 'Review service busy'}),
              503);
        }
        profile = {
          ...?profile,
          'status': 'SUBMITTED',
          'networkId': 'BN-AG-774',
        };
        return http.Response(
            jsonEncode({
              'success': true,
              'data': {'profile': profile}
            }),
            200);
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
    await tester.tap(find.text('Become an Agent'));
    await tester.pumpAndSettle();

    expect(find.text('Retail Agent'), findsOneWidget);
    expect(find.text('SME Merchant'), findsOneWidget);
    await _scrollTo(tester, find.text('Save draft'));
    await tester.tap(find.text('Save draft'));
    await tester.pumpAndSettle();
    expect(putBodies.single['businessName'], '');
    expect(putBodies.single['kind'], 'AGENT');
    expect(putBodies.single['revision'], 0);

    // Saved drafts are reopened in the same kind and use the newest revision.
    await _scrollTo(tester, find.text('Save draft'));
    await tester.tap(find.text('Save draft'));
    await tester.pumpAndSettle();
    expect(putBodies[1]['revision'], 1);
    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Become an Agent'));
    await tester.pumpAndSettle();
    await _scrollTo(
        tester,
        find.text(
            'This application type is locked to your saved application.'));
    expect(
        find.text('This application type is locked to your saved application.'),
        findsOneWidget);
    expect(find.text('BN-AG-774'), findsNothing);

    Future<void> enterField(String label, String value) async {
      await _scrollTo(tester, find.text(label));
      await tester.enterText(
        find.ancestor(
          of: find.text(label),
          matching: find.byType(TextFormField),
        ),
        value,
      );
    }

    await enterField('Business / shop name', 'Ada Mini Mart');
    await enterField('Owner’s full name', 'Ada Okafor');
    await enterField('Phone number', '08000000000');
    await enterField('Email address', 'ada@example.test');
    await enterField('State', 'Lagos');
    await enterField('LGA', 'Ikeja');
    await enterField('Business address', '12 Market Road');
    await enterField('Business description', 'Neighbourhood retail shop');
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Submit for review'));
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    expect(submitAttempts, 0);
    expect(putBodies.length, 2);
    expect(
        find.text(
            'Choose at least one preferred service or business interest.'),
        findsOneWidget);

    await _scrollTo(tester, find.text('Airtime'));
    await tester.tap(find.byType(CheckboxListTile).first);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Submit for review'));
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    expect(submitAttempts, 1);
    expect(find.textContaining('Review service busy'), findsOneWidget);
    expect(putBodies.last['revision'], 2);
    expect(putBodies.last['preferredServices'], contains('AIRTIME'));

    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Submit for review'));
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    expect(submitAttempts, 2);
    expect(putBodies.last['revision'], 3);
    expect(putBodies.last['preferredServices'], contains('AIRTIME'));
    expect(find.textContaining('BN-AG-774'), findsOneWidget);
    client.close();
  });

  testWidgets('Merchant application posts the selected kind and service code',
      (tester) async {
    Map<String, dynamic>? profile = {
      'kind': 'MERCHANT',
      'status': 'DRAFT',
      'revision': 7,
      'networkId': 'BN-ME-311',
      'details': {
        'businessName': 'Mina Stores',
        'businessCategory': 'Market retail',
        'ownerName': 'Mina Yusuf',
        'phone': '08012345678',
        'email': 'mina@example.test',
        'state': 'Kano',
        'lga': 'Nassarawa',
        'address': '4 Central Market',
        'description': 'General goods retailer',
        'preferredServices': ['MARKETPLACE'],
      },
    };
    Map<String, dynamic>? submitted;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Mina Yusuf'},
              'applications': profile == null ? [] : [profile],
              'memberships': [],
              'categories': ['Market retail'],
              'serviceCatalogue': {
                'AGENT': [],
                'MERCHANT': [
                  {
                    'code': 'MARKETPLACE',
                    'label': 'Marketplace',
                    'category': 'Commerce',
                    'preferencesEnabled': true,
                    'processable': false,
                    'available': true,
                  }
                ],
              },
            },
          }),
          200,
        );
      }
      if (request.method == 'PUT') {
        expect(request.url.path, '/api/business-network/applications/MERCHANT');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['kind'], 'MERCHANT');
        expect(body['businessCategory'], 'Market retail');
        expect(body['preferredServices'], contains('MARKETPLACE'));
        expect(body['revision'], 7);
        profile = {
          'kind': 'MERCHANT',
          'status': 'DRAFT',
          'revision': 8,
          'networkId': 'BN-ME-311',
          'details': body,
        };
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'profile': profile}
          }),
          200,
        );
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/applications/MERCHANT/submit')) {
        submitted = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
            jsonEncode({
              'success': true,
              'data': {
                'profile': {
                  ...?profile,
                  'status': 'SUBMITTED',
                  'networkId': 'BN-ME-311',
                }
              }
            }),
            200);
      }
      return http.Response(
          jsonEncode({'success': false, 'message': 'Unexpected route'}), 404);
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
    await tester.tap(find.text('Register as a Merchant'));
    await tester.pumpAndSettle();
    expect(find.text('SME Merchant'), findsOneWidget);
    await _scrollTo(tester, find.text('Marketplace'));
    expect(find.textContaining('Interest only'), findsOneWidget);
    await _scrollTo(tester, find.text('Submit for review'));
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    expect(submitted?['revision'], 8);
    expect(find.textContaining('BN-ME-311'), findsOneWidget);
    client.close();
  });
}
