import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_business_partners_api.dart';
import 'package:servicepay_app/admin/admin_business_partners_screen.dart';
import 'package:servicepay_app/admin/business_partner_access_catalog.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'head-office-token',
      'user_role': 'HEAD_OFFICE',
    });
  });

  test('lists filtered partners with the authenticated admin request',
      () async {
    late http.Request sent;
    final api = AdminBusinessPartnersApi(
      baseUrl: 'https://example.test/api/business-partner/admin/partners',
      client: MockClient((request) async {
        sent = request;
        return http.Response('{"success":true,"partners":[]}', 200);
      }),
    );

    await api.list(search: ' North Hub ', status: 'active');

    expect(sent.method, 'GET');
    expect(sent.url.path, '/api/business-partner/admin/partners');
    expect(sent.url.queryParameters, <String, String>{
      'q': 'North Hub',
      'status': 'ACTIVE',
    });
    expect(sent.headers['authorization'], 'Bearer head-office-token');
    api.close();
  });

  test('status transition sends only status and operational note', () async {
    late http.Request sent;
    final api = AdminBusinessPartnersApi(
      baseUrl: 'https://example.test/api/business-partner/admin/partners',
      client: MockClient((request) async {
        sent = request;
        return http.Response(
            jsonEncode(<String, Object>{'success': true}), 200);
      }),
    );

    await api.setStatus('partner-1', 'suspended', note: 'Review required');

    expect(sent.method, 'PATCH');
    expect(
        sent.url.path, '/api/business-partner/admin/partners/partner-1/status');
    expect(jsonDecode(sent.body), <String, String>{
      'status': 'SUSPENDED',
      'note': 'Review required',
    });
    api.close();
  });

  test('list omits blank filters and uses canonical count/detail endpoints',
      () async {
    final requests = <http.Request>[];
    final api = AdminBusinessPartnersApi(
      baseUrl: 'https://example.test/api/business-partner/admin/partners',
      client: MockClient((request) async {
        requests.add(request);
        return http.Response('{"success":true,"partners":[]}', 200);
      }),
    );

    await api.list();
    await api.counts();
    await api.detail('partner-1');

    expect(requests[0].url.queryParameters, isEmpty);
    expect(requests[1].url.path, '/api/business-partner/admin/partners/count');
    expect(
        requests[2].url.path, '/api/business-partner/admin/partners/partner-1');
    api.close();
  });

  test('creates the canonical business-partner payload without API secrets',
      () async {
    late Map<String, dynamic> payload;
    final api = AdminBusinessPartnersApi(
      baseUrl: 'https://example.test/api/business-partner/admin/partners',
      client: MockClient((request) async {
        payload = Map<String, dynamic>.from(jsonDecode(request.body) as Map);
        return http.Response('{"success":true}', 201);
      }),
    );
    final body = <String, dynamic>{
      'fullName': 'Ada Partner',
      'password': 'temporary123',
      'companyName': 'Ada Stores',
      'businessName': 'Ada Stores',
      'email': 'ada@example.test',
      'phone': '08000000000',
      'address': '1 ServicePay Way',
      'state': 'Lagos',
      'lga': 'Ikeja',
      'territory': <String, dynamic>{
        'states': <String>['Lagos'],
        'lgas': <String>['Ikeja'],
      },
      ...businessPartnerAccessForServices(<String>['SOLAR', 'PHONE']),
    };

    await api.create(body);

    expect(payload, body);
    expect(payload.containsKey('apiSecret'), isFalse);
    expect(payload['services'], <String>['PHONE', 'SOLAR']);
    expect(payload['permissions'], <String>[
      'DASHBOARD',
      'OFFICERS',
      'CUSTOMERS',
      'APPLICATIONS',
      'REPAYMENTS',
      'REPORTS',
      'OFFICER_MANAGEMENT',
      'PHONE_ASSIGNMENT',
      'SOLAR_ASSIGNMENT',
    ]);
    api.close();
  });

  test('Solar service produces only canonical Solar access permissions', () {
    final access = businessPartnerAccessForServices(<String>['SOLAR']);

    expect(access['services'], <String>['SOLAR']);
    expect(access['permissions'], contains('SOLAR_ASSIGNMENT'));
    expect(access['permissions'], contains('OFFICER_MANAGEMENT'));
    expect(access['permissions'], isNot(contains('SOLAR')));
    expect(
      access['permissions']!.every(businessPartnerPermissionCatalog.contains),
      isTrue,
    );
  });

  test('Phone Financing service produces only canonical Phone permissions', () {
    final access =
        businessPartnerAccessForServices(<String>['PHONE_FINANCING']);

    expect(access['services'], <String>['PHONE']);
    expect(access['permissions'], contains('PHONE_ASSIGNMENT'));
    expect(access['permissions'], contains('OFFICER_MANAGEMENT'));
    expect(access['permissions'], isNot(contains('PHONE')));
    expect(
      access['permissions']!.every(businessPartnerPermissionCatalog.contains),
      isTrue,
    );
  });

  test('Solar and Phone services never become permission values', () {
    final access = businessPartnerAccessForServices(<String>['SOLAR', 'PHONE']);

    expect(access['services'], <String>['PHONE', 'SOLAR']);
    expect(
        access['permissions'],
        containsAll(<String>[
          'SOLAR_ASSIGNMENT',
          'PHONE_ASSIGNMENT',
        ]));
    expect(access['permissions'], isNot(contains('SOLAR')));
    expect(access['permissions'], isNot(contains('PHONE')));
    expect(
      access['permissions']!.every(businessPartnerPermissionCatalog.contains),
      isTrue,
    );
  });

  testWidgets('detail renders scoped Solar, Phone, and repayment sections',
      (tester) async {
    final api = _DetailApi();
    await tester
        .pumpWidget(MaterialApp(home: AdminBusinessPartnersScreen(api: api)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('North Hub'));
    await tester.pumpAndSettle();

    expect(find.text('08000000000'), findsOneWidget);
    expect(find.text('north@example.test'), findsOneWidget);

    await tester.ensureVisible(find.text('Officers'));
    await tester.tap(find.text('Officers'));
    await tester.pumpAndSettle();
    expect(find.text('Solar Officer'), findsOneWidget);
    expect(find.text('Phone Officer'), findsOneWidget);

    await tester.ensureVisible(find.text('Solar'));
    await tester.tap(find.text('Solar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('SUBMITTED'), findsOneWidget);

    await tester.ensureVisible(find.text('Phone'));
    await tester.tap(find.text('Phone'));
    await tester.pumpAndSettle();
    expect(find.textContaining('UNDER_REVIEW'), findsOneWidget);

    await tester.ensureVisible(find.text('Repayments'));
    await tester.tap(find.text('Repayments'));
    await tester.pumpAndSettle();
    expect(find.textContaining('amountPaid: 5000'), findsOneWidget);
    expect(find.textContaining('outstandingBalance: 1500'), findsOneWidget);
  });
}

class _DetailApi extends AdminBusinessPartnersApi {
  _DetailApi()
      : super(
          baseUrl: 'https://example.test/api/business-partner/admin/partners',
          client:
              MockClient((_) async => http.Response('{"success":true}', 200)),
        );

  @override
  Future<Map<String, dynamic>> list(
          {String search = '', String status = ''}) async =>
      <String, dynamic>{
        'success': true,
        'partners': <Map<String, dynamic>>[
          <String, dynamic>{
            '_id': 'partner-1',
            'businessName': 'North Hub',
            'status': 'ACTIVE',
          },
        ],
      };

  @override
  Future<Map<String, dynamic>> counts() async =>
      <String, dynamic>{'success': true, 'counts': <String, dynamic>{}};

  @override
  Future<Map<String, dynamic>> detail(String id) async => <String, dynamic>{
        'success': true,
        'partner': <String, dynamic>{
          '_id': id,
          'businessName': 'North Hub',
          'contactName': 'North Contact',
          'status': 'ACTIVE',
          'user': <String, dynamic>{
            'fullName': 'North Contact',
            'phone': '08000000000',
            'email': 'north@example.test',
          },
        },
        'officers': <String, dynamic>{
          'solar': <Map<String, dynamic>>[
            <String, dynamic>{
              'user': <String, dynamic>{'fullName': 'Solar Officer'},
              'status': 'ACTIVE',
            },
          ],
          'phone': <Map<String, dynamic>>[
            <String, dynamic>{
              'fullName': 'Phone Officer',
              'status': 'ACTIVE',
            },
          ],
        },
        'applications': <String, dynamic>{
          'solar': <Map<String, dynamic>>[
            <String, dynamic>{'status': 'SUBMITTED'},
          ],
          'phone': <Map<String, dynamic>>[
            <String, dynamic>{'reference': 'PHONE-1', 'status': 'UNDER_REVIEW'},
          ],
        },
        'repayments': <String, dynamic>{
          'solar': <Map<String, dynamic>>[
            <String, dynamic>{'amountPaid': 5000, 'outstandingBalance': 1500},
          ],
          'phone': <Map<String, dynamic>>[
            <String, dynamic>{'outstandingBalance': 2000},
          ],
        },
      };
}
