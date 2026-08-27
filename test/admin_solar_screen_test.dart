import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/admin/admin_solar_screen.dart';

class _RequestRecord {
  const _RequestRecord(this.method, this.path, this.body);

  final String method;
  final String path;
  final Map<String, dynamic> body;
}


class _FakeSolarAdminApi implements SolarAdminApiClient {
  _FakeSolarAdminApi({
    List<Map<String, dynamic>>? packages,
    List<Map<String, dynamic>>? applications,
  })  : packages = packages ?? <Map<String, dynamic>>[],
        applications = applications ?? <Map<String, dynamic>>[];

  final List<Map<String, dynamic>> packages;
  final List<Map<String, dynamic>> applications;
  final List<_RequestRecord> requests = <_RequestRecord>[];
  int packageLoads = 0;
  int applicationLoads = 0;

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
  }) async {
    switch (path) {
      case '/packages':
        packageLoads += 1;
        return <String, dynamic>{'packages': packages};
      case '/applications':
        applicationLoads += 1;
        return <String, dynamic>{'applications': applications};
      case '/reports':
        return <String, dynamic>{'report': <Map<String, dynamic>>[]};
      case '/finance':
      case '/overdue':
        return <String, dynamic>{'finance': <Map<String, dynamic>>[]};
      case '/repayments':
        return <String, dynamic>{'payments': <Map<String, dynamic>>[]};
      case '/officers':
        return <String, dynamic>{'officers': <Map<String, dynamic>>[]};
      case '/withdrawals':
        return <String, dynamic>{'withdrawals': <Map<String, dynamic>>[]};
      case '/settings':
        return <String, dynamic>{'settings': <String, dynamic>{}};
      default:
        return <String, dynamic>{'dashboard': <String, dynamic>{}};
    }
  }

  @override
  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) async {
    requests.add(_RequestRecord('PATCH', path, body));
    if (path.endsWith('/approve')) {
      applications.firstWhere(
        (Map<String, dynamic> item) => path.contains('${item['_id']}'),
      )['status'] = 'AWAITING_DEPOSIT';
      return <String, dynamic>{
        'success': true,
        'application': applications.first,
      };
    }
    return <String, dynamic>{'success': true};
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) async {
    requests.add(_RequestRecord('POST', path, body));
    if (path == '/packages') {
      final Map<String, dynamic> created = <String, dynamic>{
        ...body,
        '_id': 'package-${packages.length + 1}',
      };
      packages.add(created);
      return <String, dynamic>{'success': true, 'package': created};
    }
    return <String, dynamic>{'success': true};
  }

  @override
  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) async {
    requests.add(_RequestRecord('PUT', path, body));
    return <String, dynamic>{'success': true};
  }
}

Finder _field(String label) => find.widgetWithText(TextField, label);

void main() {
  testWidgets(
    'admin keeps multiple packages and approves through the canonical PATCH route',
    (WidgetTester tester) async {
      final _FakeSolarAdminApi api = _FakeSolarAdminApi(
        packages: <Map<String, dynamic>>[
          <String, dynamic>{
            '_id': 'homelite',
            'name': 'ServicePay HomeLite 1KW',
            'capacityKw': 1,
            'cashPrice': 450000,
            'financedPrice': 500000,
            'stockQuantity': 4,
            'active': true,
          },
          <String, dynamic>{
            '_id': 'homeplus',
            'name': 'ServicePay HomePlus 2KW',
            'capacityKw': 2,
            'cashPrice': 700000,
            'financedPrice': 760000,
            'stockQuantity': 3,
            'active': true,
          },
        ],
        applications: <Map<String, dynamic>>[
          <String, dynamic>{
            '_id': 'application-1',
            'status': 'UNDER_REVIEW',
            'financedPrice': 500000,
            'cashPrice': 450000,
            'packageSnapshot': <String, dynamic>{
              'name': 'ServicePay HomeLite 1KW',
              'capacityKw': 1,
            },
            'profileSnapshot': <String, dynamic>{
              'fullName': 'Amina Customer',
              'phone': '08030000000',
            },
            'statusHistory': <Map<String, dynamic>>[],
            'paymentSchedule': <Map<String, dynamic>>[],
          },
        ],
      );
      final _FakeSolarAdminApi officerApi = _FakeSolarAdminApi();
      tester.view.physicalSize = const Size(1200, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: AdminSolarScreen(api: api, officerApi: officerApi),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Packages'));
      await tester.pumpAndSettle();
      expect(find.text('ServicePay HomeLite 1KW'), findsOneWidget);
      expect(find.text('ServicePay HomePlus 2KW'), findsOneWidget);

      await tester.tap(find.text('New package'));
      await tester.pumpAndSettle();
      await tester.enterText(
          _field('Package name'), 'ServicePay HomePro 3.5KW');
      await tester.enterText(_field('Cash price (₦)'), '1100000');
      await tester.enterText(_field('Financed price (₦)'), '1200000');
      await tester.enterText(_field('Stock quantity'), '2');
      await tester.tap(find.text('Create package'));
      await tester.pumpAndSettle();

      expect(find.text('ServicePay HomeLite 1KW'), findsOneWidget);
      expect(find.text('ServicePay HomePlus 2KW'), findsOneWidget);
      expect(find.text('ServicePay HomePro 3.5KW'), findsOneWidget);
      expect(api.packageLoads, greaterThanOrEqualTo(2));
      expect(
        api.requests.where(
          (_RequestRecord request) =>
              request.method == 'POST' && request.path == '/packages',
        ),
        hasLength(1),
      );

      await tester.tap(find.text('Applications'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Approve'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Approve'));
      await tester.pumpAndSettle();
      await tester.enterText(_field('Approval note'), 'Approved for HomeLite');
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.widgetWithText(FilledButton, 'Approve'),
        ),
      );
      await tester.pumpAndSettle();

      final List<_RequestRecord> approvals = api.requests
          .where(
            (_RequestRecord request) =>
                request.path == '/applications/application-1/approve',
          )
          .toList();
      expect(approvals, hasLength(1));
      expect(approvals.single.method, 'PATCH');
      expect(approvals.single.body, <String, dynamic>{
        'approvedPrice': '500000',
        'note': 'Approved for HomeLite',
      });
      expect(api.applicationLoads, greaterThanOrEqualTo(2));
    },
  );
}