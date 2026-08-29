import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/business_partner/business_partner_officers_screen.dart';
import 'package:servicepay_app/services/business_partner_api_service.dart';

class _OfficerApi extends BusinessPartnerApiService {
  _OfficerApi({this.permissions = const <String>[]});

  final List<String> permissions;
  int detailCalls = 0;
  int statusCalls = 0;
  int resetCalls = 0;
  String? createdType;
  Map<String, dynamic>? createdOfficer;

  @override
  Future<Map<String, dynamic>> officers({Map<String, String>? filters}) async {
    return <String, dynamic>{
      'officers': <String, dynamic>{
        'solar': <Map<String, dynamic>>[
          if (createdOfficer?['type'] == 'SOLAR') createdOfficer!,
          <String, dynamic>{
            'id': 'solar-1',
            'type': 'SOLAR',
            'officerCode': 'SP-S-104',
            'fullName': 'Amina Bello',
            'phone': '08012345678',
            'email': 'amina@example.com',
            'state': 'Lagos',
            'lga': 'Ikeja',
            'address': '12 Allen Avenue',
            'status': 'ACTIVE',
            'createdAt': '2025-01-02T00:00:00Z',
            'metrics': <String, dynamic>{
              'assignedApplications': 14,
              'assignedCustomers': 22,
              'completedWork': 9,
              'commissionTotal': 87500,
            },
            'permissions': <String>['DO_NOT_RENDER'],
            '_internalNote': 'never render',
          },
        ],
        'phone': <Map<String, dynamic>>[
          if (createdOfficer?['type'] == 'PHONE') createdOfficer!,
        ],
      },
    };
  }

  @override
  Future<Map<String, dynamic>> getOfficer({
    required String type,
    required String id,
  }) async {
    detailCalls++;
    return <String, dynamic>{
      'officer': <String, dynamic>{
        'id': id,
        'type': type,
        'fullName': 'Amina Bello',
        'phone': '08012345678',
        'email': 'amina@example.com',
        'state': 'Lagos',
        'lga': 'Ikeja',
        'address': '12 Allen Avenue',
        'status': 'ACTIVE',
      },
    };
  }

  @override
  Future<Map<String, dynamic>> createOfficer({
    required String type,
    required String fullName,
    required String phone,
    required String email,
    required String password,
    required String state,
    required String lga,
    required String address,
  }) async {
    createdType = type;
    createdOfficer = <String, dynamic>{
      'id': 'created-1',
      'type': type,
      'fullName': fullName,
      'phone': phone,
      'email': email,
      'state': state,
      'lga': lga,
      'address': address,
      'status': 'ACTIVE',
    };
    return <String, dynamic>{'success': true};
  }

  @override
  Future<Map<String, dynamic>> updateOfficer({
    required String type,
    required String id,
    required Map<String, dynamic> fields,
  }) async =>
      <String, dynamic>{'success': true};

  @override
  Future<Map<String, dynamic>> updateOfficerStatus({
    required String type,
    required String id,
    required String status,
  }) async {
    statusCalls++;
    return <String, dynamic>{'success': true};
  }

  @override
  Future<Map<String, dynamic>> resetOfficerAccess({
    required String type,
    required String id,
    required String password,
  }) async {
    resetCalls++;
    return <String, dynamic>{'success': true};
  }
}

Widget _app(_OfficerApi api) => MaterialApp(
      home: Scaffold(
        body: BusinessPartnerOfficersScreen(
          api: api,
          profile: <String, dynamic>{
            'permissions': api.permissions,
            'services': const <String>['SOLAR', 'PHONE'],
          },
        ),
      ),
    );

void main() {
  testWidgets('renders safe officer fields responsively and opens detail',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final _OfficerApi api = _OfficerApi(permissions: const <String>[
      'OFFICER_MANAGEMENT',
      'SOLAR_ASSIGNMENT',
      'PHONE_ASSIGNMENT',
    ]);

    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();

    expect(find.text('Amina Bello'), findsOneWidget);
    expect(find.textContaining('SP-S-104'), findsOneWidget);
    expect(find.text('Applications'), findsOneWidget);
    expect(find.text('14'), findsOneWidget);
    for (final String unsafe in <String>[
      'permissions',
      'DO_NOT_RENDER',
      '_internalNote',
      'solar-1',
      'createdAt',
    ]) {
      expect(find.textContaining(unsafe), findsNothing);
    }

    await tester.tap(find.text('Amina Bello'));
    await tester.pumpAndSettle();
    expect(api.detailCalls, 1);
    expect(find.text('Edit'), findsOneWidget);
    expect(find.text('Reset access'), findsOneWidget);
    expect(find.text('Suspend'), findsOneWidget);
    await tester.tap(find.byKey(const Key('edit-officer')));
    await tester.pumpAndSettle();
    expect(find.text('Save changes'), findsOneWidget);
    await tester.tap(find.text('Cancel').last);
    await tester.pumpAndSettle();
    tester.view.physicalSize = const Size(1200, 900);
    await tester.pumpAndSettle();
    expect(find.text('My Officers'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('hides lifecycle and create controls without permission',
      (WidgetTester tester) async {
    final _OfficerApi api =
        _OfficerApi(permissions: const <String>['OFFICERS']);
    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();

    expect(find.text('My Officers'), findsOneWidget);
    expect(find.text('Amina Bello'), findsOneWidget);
    expect(find.byKey(const Key('create-officer')), findsNothing);
    await tester.tap(find.text('Amina Bello'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('edit-officer')), findsNothing);
    expect(find.byKey(const Key('reset-access')), findsNothing);
    expect(find.byKey(const Key('toggle-officer-status')), findsNothing);
  });

  testWidgets('validates create form and sends selected service type',
      (WidgetTester tester) async {
    final _OfficerApi api = _OfficerApi(permissions: const <String>[
      'SOLAR_ASSIGNMENT',
      'PHONE_ASSIGNMENT',
    ]);
    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('create-officer')));
    await tester.pumpAndSettle();

    expect(find.text('Create Officer'), findsWidgets);
    expect(find.text('ServicePay Solar Officer'), findsOneWidget);
    await tester.tap(find.byKey(const Key('save-officer')));
    await tester.pump();
    expect(find.text('Required'), findsWidgets);

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Phone Financing Officer').last);
    const List<String> values = <String>[
      'Ibrahim Musa',
      '08000000000',
      'ibrahim@example.com',
      'Kano',
      'Nassarawa',
      '4 Market Road',
      'secure-pass',
    ];
    final Finder textFields = find.byType(TextFormField);
    for (int index = 0; index < values.length; index++) {
      await tester.enterText(textFields.at(index), values[index]);
    }
    await tester.tap(find.byKey(const Key('save-officer')));
    await tester.pumpAndSettle();
    expect(api.createdType, 'PHONE');
    expect(find.text('Officer created successfully.'), findsOneWidget);
    expect(find.text('Ibrahim Musa'), findsOneWidget);
  });

  testWidgets('supports suspend and reset access controls',
      (WidgetTester tester) async {
    final _OfficerApi api = _OfficerApi(permissions: const <String>[
      'OFFICER_MANAGEMENT',
      'SOLAR_ASSIGNMENT',
      'PHONE_ASSIGNMENT',
    ]);
    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Amina Bello'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('toggle-officer-status')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-status')));
    await tester.pumpAndSettle();
    expect(api.statusCalls, 1);

    await tester.tap(find.text('Amina Bello'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('reset-access')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'another-pass');
    await tester.tap(find.byKey(const Key('confirm-reset')));
    await tester.pumpAndSettle();
    expect(api.resetCalls, 1);
  });
}
