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
  bool commissionCanRequest = false;
  bool failNextCommissionRequest = false;
  Map<String, dynamic>? lastCommissionWithdrawalPayload;
  final List<int> requestedWithdrawalPages = [];
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
  Future<Map<String, dynamic>> workspaceWithdrawals({
    int page = 1,
    int limit = 25,
  }) async {
    requestedWithdrawalPages.add(page);
    return {
        'summary': {
          'totalCommissionEarned': 1500,
          'futureSettledCommissionEarned': 95.75,
          'futureReversedCommission': 4.25,
          'recordedAvailableCommission': 300,
          'recordedWithdrawnCommission': 0,
          'availableCommission': 810.25,
          'totalWithdrawn': 200,
          'pendingWithdrawals': 1,
          'commissionRecoveryDebt': 12.50,
        },
        'readiness': {
          'ready': commissionCanRequest,
          'canRequest': commissionCanRequest,
          'code': commissionCanRequest ? 'READY' : 'COMMISSION_CUSTODY_UNVERIFIED',
          'message': commissionCanRequest
              ? 'Fixture commission custody is ready.'
              : 'Fixture payouts remain disabled pending reconciliation.',
        },
        'items': [
          {
            'id': 'fixture-commission-withdrawal-1',
            'reference': 'COM-FIXTURE-1',
            'amount': 75,
            'status': 'PENDING',
            'createdAt': '2025-02-12T08:00:00Z',
            'source': 'COMMISSION_CUSTODY',
          }
        ],
        'commissionHistory': [
          {
            'id': 'fixture-commission-journal-1',
            'kind': 'ACCRUAL',
            'reference': 'JRN-FIXTURE-1',
            'serviceType': 'AIRTIME',
            'createdAt': '2025-02-12T08:00:00Z',
            'amountKobo': 12345,
            'entries': [
              {'amountKobo': 12345, 'accountId': 'own-custody-account'}
            ],
          }
        ],
        'custodySource': 'FUTURE_PROFIT_SHARING_ONLY',
        'legacyWalletWithdrawals': [],
        'commissionTotal': 8,
        'legacyTotal': 17,
        'commissionHistoryTotal': 31,
        'page': page,
        'limit': limit,
        'totalPages': 2,
      };
  }

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
    lastCommissionWithdrawalPayload = Map<String, dynamic>.from(payload);
    if (failNextCommissionRequest) {
      failNextCommissionRequest = false;
      throw Exception('Fixture network timeout.');
    }
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
    expect(find.text('₦810.25'), findsOneWidget);
    expect(api.payoutRequests, 0);
    expect(find.textContaining('Legacy main-wallet commissions are not withdrawable here.'),
        findsNothing);
    expect(find.textContaining('Legacy main-wallet commissions are excluded.'),
        findsOneWidget);
    expect(find.textContaining('₦123.45'), findsWidgets);
    expect(find.text('Commission custody · 2025-02-12'), findsOneWidget);
  });

  testWidgets('commission withdrawal requires server readiness, fresh PIN and reuses retry key',
      (tester) async {
    final payload = base64Url
        .encode(utf8.encode(jsonEncode({'actorId': 'commission-manager-9'})))
        .replaceAll('=', '');
    final token = 'e30.$payload.signature';
    SharedPreferences.setMockInitialValues({'auth_token': token});
    FlutterSecureStorage.setMockInitialValues({});
    final api = _FixtureManagementApi()
      ..commissionCanRequest = true
      ..failNextCommissionRequest = true;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ManagementWorkspacePanel(api: api, section: 'Withdrawals'),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('₦12.50'), findsOneWidget);
    expect(find.text('Future profit-sharing commission earned'), findsOneWidget);
    expect(find.text('Future profit-sharing commission reversed'), findsOneWidget);
    expect(find.text('Legacy commission earned · recorded lifetime'), findsOneWidget);
    expect(find.textContaining('Legacy main-wallet commissions are not withdrawable here.'),
        findsOneWidget);
    final amountField = find.widgetWithText(TextField, 'Amount (₦)');
    final bankField = find.widgetWithText(TextField, 'Bank');
    final accountNameField = find.widgetWithText(TextField, 'Account name');
    final accountNumberField = find.widgetWithText(TextField, 'Account number');
    await tester.ensureVisible(amountField);
    await tester.enterText(amountField, '125.50');
    await tester.ensureVisible(bankField);
    await tester.enterText(bankField, 'Fixture Bank');
    await tester.ensureVisible(accountNameField);
    await tester.enterText(accountNameField, 'Synthetic Manager');
    await tester.ensureVisible(accountNumberField);
    await tester.enterText(accountNumberField, '0123456789');
    await tester.ensureVisible(find.text('Submit request'));
    await tester.tap(find.text('Submit request'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm commission withdrawal'), findsOneWidget);
    final pinField = tester.widget<TextField>(
      find.widgetWithText(TextField, 'Transaction PIN'),
    );
    expect(pinField.obscureText, isTrue);
    final submitPin = find.text('Submit withdrawal request');
    expect(
      tester.widget<FilledButton>(
        find.ancestor(of: submitPin, matching: find.byType(FilledButton)).first,
      ).onPressed,
      isNull,
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Transaction PIN'),
      '1234',
    );
    await tester.pump();
    await tester.ensureVisible(submitPin);
    await tester.tap(submitPin);
    await tester.pumpAndSettle();
    expect(api.payoutRequests, 1);
    final firstPayload = api.lastCommissionWithdrawalPayload!;
    expect(firstPayload['amount'], 125.5);
    expect(firstPayload['bankName'], 'Fixture Bank');
    expect(firstPayload['accountName'], 'Synthetic Manager');
    expect(firstPayload['accountNumber'], '0123456789');
    expect(firstPayload['transactionPin'], '1234');
    expect(firstPayload['idempotencyKey'], isNotEmpty);
    expect(find.text('Retry same request'), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    final intentKey = prefs
        .getKeys()
        .singleWhere((key) => key.startsWith('management_workspace_intent_'));
    final savedIntent = jsonDecode(prefs.getString(intentKey)!) as Map;
    expect(savedIntent.containsKey('transactionPin'), isFalse);
    expect(savedIntent.values, isNot(contains('1234')));

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ManagementWorkspacePanel(api: api, section: 'Withdrawals'),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.widgetWithText(TextField, 'Amount (₦)'))
        .controller!
        .text, '125.50');
    await tester.ensureVisible(find.text('Retry same request'));
    await tester.tap(find.text('Retry same request'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Transaction PIN'),
      '5678',
    );
    final pinSubmit = find.text('Submit withdrawal request');
    await tester.pump();
    await tester.ensureVisible(pinSubmit);
    await tester.tap(pinSubmit);
    await tester.pumpAndSettle();
    expect(api.payoutRequests, 2);
    expect(api.lastCommissionWithdrawalPayload!['idempotencyKey'],
        firstPayload['idempotencyKey']);
    expect(api.lastCommissionWithdrawalPayload!['transactionPin'], '5678');
    expect(prefs.getKeys().where((key) => key.contains('commission_withdrawal')),
        isEmpty);
  });

  testWidgets('failed intent persistence blocks POST and retries the same saved key',
      (tester) async {
    final payload = base64Url
        .encode(utf8.encode(jsonEncode({'actorId': 'commission-manager-write-3'})))
        .replaceAll('=', '');
    SharedPreferences.setMockInitialValues({
      'auth_token': 'e30.$payload.signature',
    });
    FlutterSecureStorage.setMockInitialValues({});
    final api = _FixtureManagementApi()
      ..commissionCanRequest = true
      ..failNextCommissionRequest = true;
    final List<String> storedIntents = [];
    var writeCount = 0;

    Future<bool> writeIntent(String key, String value) async {
      writeCount++;
      storedIntents.add(value);
      if (writeCount == 1) return false;
      final prefs = await SharedPreferences.getInstance();
      return prefs.setString(key, value);
    }

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ManagementWorkspacePanel(
            api: api,
            section: 'Withdrawals',
            commissionIntentWriter: writeIntent,
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    final amountField = find.widgetWithText(TextField, 'Amount (₦)');
    final bankField = find.widgetWithText(TextField, 'Bank');
    final nameField = find.widgetWithText(TextField, 'Account name');
    final accountField = find.widgetWithText(TextField, 'Account number');
    await tester.ensureVisible(amountField);
    await tester.enterText(amountField, '90');
    await tester.ensureVisible(bankField);
    await tester.enterText(bankField, 'Fixture Bank');
    await tester.ensureVisible(nameField);
    await tester.enterText(nameField, 'Manager');
    await tester.ensureVisible(accountField);
    await tester.enterText(accountField, '0123456789');

    Future<void> submitPinAttempt(String pin) async {
      final Finder submit =
          find.text(writeCount == 0 ? 'Submit request' : 'Retry same request');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Transaction PIN'),
        pin,
      );
      final pinSubmit = find.text('Submit withdrawal request');
      await tester.pump();
      await tester.ensureVisible(pinSubmit);
      await tester.tap(pinSubmit);
      await tester.pumpAndSettle();
    }

    await submitPinAttempt('1111');
    expect(api.payoutRequests, 0, reason: 'A failed durable write must block POST.');
    expect(writeCount, 1);
    expect(find.text('Retry same request'), findsOneWidget);

    await submitPinAttempt('2222');
    expect(api.payoutRequests, 1);
    expect(writeCount, 2);
    final firstKey =
        (jsonDecode(storedIntents.first) as Map)['idempotencyKey'];
    expect((jsonDecode(storedIntents[1]) as Map)['idempotencyKey'], firstKey);

    await submitPinAttempt('3333');
    expect(api.payoutRequests, 2);
    expect(writeCount, 3);
    expect(
      (jsonDecode(storedIntents[2]) as Map)['idempotencyKey'],
      firstKey,
    );
    expect(api.lastCommissionWithdrawalPayload!['idempotencyKey'], firstKey);
  });

  testWidgets('withdrawal pager browses the combined commission, legacy and journal pages',
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
    expect(find.text('Commission-custody withdrawal requests · 8 records'),
        findsOneWidget);
    expect(find.text('Future profit-sharing custody history · 31 records'),
        findsOneWidget);
    expect(find.textContaining('17 records'), findsOneWidget);
    expect(find.text('Page 1 of 2'), findsOneWidget);
    await tester.ensureVisible(find.byTooltip('Next page'));
    await tester.tap(find.byTooltip('Next page'));
    await tester.pumpAndSettle();
    expect(api.requestedWithdrawalPages, [1, 2]);
    expect(find.text('Page 2 of 2'), findsOneWidget);
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
