import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/management/management_api.dart';
import 'package:servicepay_app/management/management_workspace.dart';

class _FixtureManagementApi extends ManagementApi {
  _FixtureManagementApi();

  String requestedActivity = '';
  int payoutRequests = 0;
  bool failCustomerSearch = false;
  bool complaintCreated = false;
  int complaintCreateCount = 0;
  String? submittedReply;

  @override
  Future<Map<String, dynamic>> workspaceCustomers({
    String activity = 'ALL',
    String search = '',
    String? registeredFrom,
    String? registeredTo,
    int page = 1,
    int limit = 25,
  }) async {
    requestedActivity = activity;
    if (search.isNotEmpty && failCustomerSearch) {
      throw const ManagementApiException(
          'Fixture customer search unavailable.');
    }
    return {
      'items': [
        {
          'id': 'fixture-customer-7',
          'fullName': 'Synthetic Customer',
          'phone': '08012345678',
          'email': 'fixture@example.test',
          'createdAt': '2025-02-01T10:00:00Z',
          'accountStatus': 'ACTIVE',
          'activityStatus': 'ACTIVE',
          'transactions': 2,
          'transactionVolume': 1250,
          'lastTransactionAt': '2025-02-12T08:00:00Z',
        }
      ],
      'total': 1,
      'page': page,
      'totalPages': 1,
    };
  }

  @override
  Future<Map<String, dynamic>> workspaceCustomerTransactions(
    String id, {
    String search = '',
    int page = 1,
    int limit = 25,
  }) async {
    return {
      'items': [
        {
          'id': 'fixture-transaction-$page',
          'reference': search.isEmpty ? 'TX-PAGE-$page' : search,
          'serviceType': 'AIRTIME',
          'amount': 320,
          'status': 'SUCCESSFUL',
          'createdAt': '2025-02-12T08:00:00Z',
        }
      ],
      'page': page,
      'limit': limit,
      'total': search.isEmpty ? 61 : 1,
      'totalPages': search.isEmpty ? 3 : 1,
      'search': search,
    };
  }

  @override
  Future<Map<String, dynamic>> workspaceCustomer(
    String id, {
    int page = 1,
    int limit = 25,
  }) async =>
      {
        'customer': {
          'id': id,
          'fullName': 'Synthetic Customer',
          'phone': '08012345678',
          'email': 'fixture@example.test',
          'createdAt': '2025-02-01T10:00:00Z',
          'accountStatus': 'ACTIVE',
          'activityStatus': 'ACTIVE',
          'transactions': 61,
          'transactionVolume': 9320,
          'lastTransactionAt': '2025-02-12T08:00:00Z',
        },
        'transactions': {
          'items': [
            {
              'id': 'fixture-transaction-1',
              'reference': 'TX-PAGE-1',
              'serviceType': 'AIRTIME',
              'amount': 320,
              'status': 'SUCCESSFUL',
              'createdAt': '2025-02-12T08:00:00Z',
            }
          ],
          'page': 1,
          'limit': limit,
          'total': 61,
          'totalPages': 3,
        },
        'legacyTransactionsExcluded': true,
      };

  @override
  Future<Map<String, dynamic>> workspaceWithdrawals() async => {
        'summary': {
          'totalCommissionEarned': 1500,
          'recordedAvailableCommission': 300,
          'recordedWithdrawnCommission': 0,
          'availableCommission': null,
          'totalWithdrawn': null,
          'pendingWithdrawals': null,
        },
        'readiness': {
          'enabled': false,
          'code': 'COMMISSION_CUSTODY_UNVERIFIED',
          'message': 'Fixture payouts remain disabled pending reconciliation.',
        },
        'items': [],
        'legacyWalletWithdrawals': [],
      };

  @override
  Future<Map<String, dynamic>> workspaceComplaints({
    String? status,
    int page = 1,
    int limit = 25,
  }) async =>
      {
        'items': complaintCreated
            ? [
                {
                  'id': 'fixture-case-41',
                  'caseReference': 'SP-FIXTURE-41',
                  'subject': 'Fixture complaint',
                  'description': 'Fixture complaint description',
                  'status': 'OPEN',
                  'category': 'OTHER',
                  'issueCategory': 'OTHER',
                  'customer': {
                    'id': 'fixture-customer-7',
                    'fullName': 'Synthetic Customer',
                    'phone': '08012345678',
                  },
                  'createdAt': '2025-02-12T08:00:00Z',
                },
              ]
            : [],
        'total': complaintCreated ? 1 : 0,
        'page': page,
        'limit': limit,
        'totalPages': 1,
      };

  @override
  Future<Map<String, dynamic>> createWorkspaceComplaint(
    Map<String, dynamic> payload,
  ) async {
    expect(payload['customerId'], 'fixture-customer-7');
    expect(payload['transactionId'], 'fixture-transaction-1');
    expect(payload['issueCategory'], 'OTHER');
    expect((payload['idempotencyKey'] as String).length, 64);
    complaintCreated = true;
    complaintCreateCount++;
    return {
      'ticket': {
        'id': 'fixture-case-41',
        'caseReference': 'SP-FIXTURE-41',
      },
    };
  }

  @override
  Future<Map<String, dynamic>> workspaceComplaint(String id) async => {
        'id': id,
        'caseReference': 'SP-FIXTURE-41',
        'subject': 'Fixture complaint',
        'description': 'Fixture complaint description',
        'status': 'OPEN',
        'category': 'OTHER',
        'customer': {
          'id': 'fixture-customer-7',
          'fullName': 'Synthetic Customer',
          'phone': '08012345678',
        },
        'transactionContext': {
          'reference': 'TX-FIXTURE-1',
          'transactionType': 'AIRTIME',
          'amount': 320,
          'status': 'SUCCESSFUL',
        },
        'replies': [
          {
            'message': submittedReply ?? 'Fixture support update',
            'authorName': 'Synthetic Support',
            'authorRole': 'ADMIN',
            'createdAt': '2025-02-12T09:00:00Z',
          },
        ],
        'attachments': const [],
      };

  @override
  Future<Map<String, dynamic>> replyWorkspaceComplaint(
    String id,
    Map<String, dynamic> payload,
  ) async {
    expect(id, 'fixture-case-41');
    submittedReply = payload['message'] as String;
    return workspaceComplaint(id);
  }

  @override
  Future<Map<String, dynamic>> requestCommissionWithdrawal(
      Map<String, dynamic> payload) async {
    payoutRequests++;
    return {};
  }
}

void main() {
  testWidgets('customer workspace remains usable at phone and desktop widths',
      (tester) async {
    final api = _FixtureManagementApi();
    for (final size in const [Size(390, 844), Size(1280, 900)]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: ManagementWorkspacePanel(
              api: api,
              section: 'My Customers',
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Synthetic Customer'), findsOneWidget);
      expect(find.byTooltip('Call customer'), findsOneWidget);
      expect(find.byTooltip('Message on WhatsApp'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
    expect(api.requestedActivity, 'ALL');
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  testWidgets('commission request is disabled until server enables readiness',
      (tester) async {
    final api = _FixtureManagementApi();
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ManagementWorkspacePanel(api: api, section: 'Withdrawals'),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Submit request'),
    );
    expect(button.onPressed, isNull);
    expect(find.text('Not verified'), findsWidgets);
    expect(api.payoutRequests, 0);
  });

  testWidgets(
      'customer detail searches transactions and pages beyond first page',
      (tester) async {
    final api = _FixtureManagementApi();
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ManagementWorkspacePanel(api: api, section: 'My Customers'),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();

    expect(find.text('TX-PAGE-1'), findsOneWidget);
    await tester.tap(find.byTooltip('Next transaction page'));
    await tester.pumpAndSettle();
    expect(find.text('TX-PAGE-2'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'TX-LOOKUP-9');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(
      find.widgetWithText(ListTile, 'TX-LOOKUP-9'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'complaint search errors recover, actual transaction submits, detail replies',
      (tester) async {
    final payload = base64Url
        .encode(utf8.encode(jsonEncode({'actorId': 'fixture-actor-7'})))
        .replaceAll('=', '');
    final token = 'e30.$payload.signature';
    SharedPreferences.setMockInitialValues({'auth_token': token});
    FlutterSecureStorage.setMockInitialValues({});
    final api = _FixtureManagementApi()..failCustomerSearch = true;

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ManagementWorkspacePanel(
            api: api,
            section: 'Customer Complaints',
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New complaint'));
    await tester.pumpAndSettle();

    final customerSearch = find.byType(TextField).first;
    await tester.enterText(customerSearch, 'Ada');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Fixture customer search unavailable.'), findsOneWidget);

    api.failCustomerSearch = false;
    await tester.enterText(customerSearch, 'Ada Okafor');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Fixture customer search unavailable.'), findsNothing);
    await tester.tap(find.text('Synthetic Customer'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'TX-PAGE-1'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byType(TextFormField).first, 'Fixture complaint details');
    await tester.tap(find.text('Submit complaint'));
    await tester.pumpAndSettle();

    expect(api.complaintCreateCount, 1);
    final caseReference = find.descendant(
      of: find.byType(ListTile),
      matching: find.textContaining('SP-FIXTURE-41'),
    );
    expect(caseReference, findsOneWidget);
    await tester.tap(
      caseReference,
    );
    await tester.pumpAndSettle();
    expect(find.text('Fixture support update'), findsOneWidget);

    await tester.enterText(
        find.byType(TextField).last, 'Customer replied with details.');
    await tester.tap(find.text('Send update'));
    await tester.pumpAndSettle();
    expect(api.submittedReply, 'Customer replied with details.');

    await tester.tap(
      find.descendant(
        of: find.byType(ListTile),
        matching: find.textContaining('SP-FIXTURE-41'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Customer replied with details.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
