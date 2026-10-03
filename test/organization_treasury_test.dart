import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/organizations/organization_owner_dashboard.dart';
import 'package:servicepay_app/organizations/organizations_api.dart';
import 'package:servicepay_app/services/session_store.dart';

class _TreasuryClient extends http.BaseClient {
  final requests = <String>[];
  final bodies = <String>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add('${request.method} ${request.url.path}');
    bodies.add(await request.finalize().bytesToString());
    final path = request.url.path;
    final body = path.endsWith('/mine')
        ? '{"success":true,"organizations":[{"_id":"org-owner","name":"Owned"}],"memberships":[{"role":"STAFF","organization":{"_id":"org-staff","name":"Staff org"}}]}'
        : path.endsWith('/treasury')
            ? '{"success":true,"data":{"wallet":{"availableBalance":1200,"ledgerBalance":1500,"heldBalance":300}}}'
            : path.endsWith('/settlement-accounts')
                ? '{"success":true,"settlementAccounts":[]}'
                : '{"success":true,"withdrawals":[]}';
    return http.StreamedResponse(
      Stream.value(body.codeUnits),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'treasury-test'});
  });

  test('owner treasury methods use dedicated route contract', () async {
    final client = _TreasuryClient();
    final api = OrganizationsApi(
      client: client,
      baseUrl: 'https://test/api/organizations',
    );
    await api.walletDetails('org/1');
    await api.settlementAccounts('org/1');
    await api.withdrawals('org/1');
    await api.createWithdrawal('org/1', {
      'amount': 100,
      'settlementAccountId': 'account-1',
      'narration': 'Rent',
      'transactionPin': '••••',
    });
    await api.withdrawalDetail('org/1', 'withdrawal-1');
    await api.approveWithdrawal('org/1', 'withdrawal-1');
    await api.rejectWithdrawal('org/1', 'withdrawal-1', reason: 'Review');
    expect(
      client.requests,
      contains('GET /api/organizations/org%2F1/treasury'),
    );
    expect(
      client.requests,
      contains('GET /api/organizations/org%2F1/settlement-accounts'),
    );
    expect(
      client.requests,
      contains('GET /api/organizations/org%2F1/withdrawals'),
    );
    expect(
      client.requests,
      contains('POST /api/organizations/org%2F1/withdrawals'),
    );
    expect(
      client.requests,
      contains('GET /api/organizations/org%2F1/withdrawals/withdrawal-1'),
    );
    expect(
      client.requests,
      contains(
        'POST /api/organizations/org%2F1/withdrawals/withdrawal-1/approve',
      ),
    );
    expect(
      client.requests,
      contains(
        'POST /api/organizations/org%2F1/withdrawals/withdrawal-1/reject',
      ),
    );
    expect(
      client.bodies.any(
        (body) =>
            body.contains('"narration":"Rent"') && !body.contains('"purpose"'),
      ),
      isTrue,
    );
  });

  test('manual owner routes use only the three bank fields', () async {
    final client = _TreasuryClient();
    final api = OrganizationsApi(
      client: client,
      baseUrl: 'https://test/api/organizations',
    );
    await api.manualBankAccount('org-1');
    await api.manualWallet('org-1');
    await api.manualWithdrawals('org-1', status: 'PENDING', page: 3);
    await api.saveManualBankAccount('org-1', {
      'accountName': 'Lola Foods',
      'accountNumber': '0102030405',
      'bankName': 'Cedar Bank',
      'bankCode': 'must-not-send',
    });
    expect(
      client.requests,
      contains('GET /api/organizations/org-1/bank-account'),
    );
    expect(
      client.requests,
      contains('GET /api/organizations/org-1/manual-wallet'),
    );
    expect(
      client.requests,
      contains('GET /api/organizations/org-1/manual-withdrawals'),
    );
    expect(
      client.requests,
      contains('PUT /api/organizations/org-1/bank-account'),
    );
    expect(jsonDecode(client.bodies.last), {
      'accountName': 'Lola Foods',
      'accountNumber': '0102030405',
      'bankName': 'Cedar Bank',
    });
  });

  test('manual withdrawal requests retain one durable key for retries',
      () async {
    final client = _TreasuryClient();
    final api = OrganizationsApi(
      client: client,
      baseUrl: 'https://test/api/organizations',
    );
    final first = await api.manualWithdrawalIdempotencyKey('org-a', 142.5);
    final retry = await api.manualWithdrawalIdempotencyKey('org-a', 142.5);
    expect(retry, first);
    await api.createManualWithdrawal('org-a', {
      'amount': 142.5,
      'transactionPin': '1234',
      'idempotencyKey': first,
    });
    await api.createManualWithdrawal('org-a', {
      'amount': 142.5,
      'transactionPin': '1234',
      'idempotencyKey': retry,
    });
    expect(
      client.requests.where(
        (request) =>
            request == 'POST /api/organizations/org-a/manual-withdrawals',
      ),
      hasLength(2),
    );
    expect(
      client.bodies.where((body) => body.contains('"amount":142.5')),
      hasLength(2),
    );
    final firstBody = jsonDecode(client.bodies[0]) as Map<String, dynamic>;
    final secondBody = jsonDecode(client.bodies[1]) as Map<String, dynamic>;
    expect(firstBody['idempotencyKey'], secondBody['idempotencyKey']);
    expect(
      client.bodies.every(
        (body) => !body.contains('accountId') && !body.contains('narration'),
      ),
      isTrue,
    );
  });

  test('failed identity persistence blocks submission and retry reuses key',
      () async {
    await SessionStore.writeToken('manual-idempotency-test-session');
    final preferences = await SharedPreferences.getInstance();
    var shouldFail = true;
    String? attempted;
    var sessionFingerprint = 'session-one';
    final api = OrganizationsApi(
      client: _TreasuryClient(),
      baseUrl: 'https://test/api/organizations',
      manualSessionFingerprint: () async => sessionFingerprint,
      manualKeyPersistence: (storageKey, value) async {
        if (sessionFingerprint == 'session-one') {
          attempted ??= value;
          expect(value, attempted);
        }
        await preferences.setString(storageKey, value);
        if (shouldFail) return false;
        return true;
      },
    );
    await expectLater(
      api.manualWithdrawalIdempotencyKey('org-persist-test', 88.25),
      throwsException,
    );
    shouldFail = false;
    final retry = await api.manualWithdrawalIdempotencyKey(
      'org-persist-test',
      88.25,
    );
    expect(retry, attempted);
    expect(retry, startsWith('org-withdrawal-'));
    sessionFingerprint = 'session-two';
    final otherSessionKey = await api.manualWithdrawalIdempotencyKey(
      'org-persist-test',
      88.25,
    );
    expect(otherSessionKey, isNot(retry));
  });

  test('organization role grants manual-wallet capability only to owner',
      () async {
    final api = OrganizationsApi(
      client: _TreasuryClient(),
      baseUrl: 'https://test/api/organizations',
    );
    final organizations = await api.mine();
    expect(
      organizations.firstWhere((item) => item.id == 'org-owner').isOwner,
      isTrue,
    );
    expect(
      organizations.firstWhere((item) => item.id == 'org-staff').isOwner,
      isFalse,
    );
  });

  testWidgets('manual owner wallet shows masked history and amount-only form', (
    tester,
  ) async {
    Map<String, dynamic>? actionPayload;
    Map<String, dynamic>? bankPayload;
    final input = DashboardInput(
      data: {
        'availableBalance': 1200,
        'ledgerBalance': 1500,
        'heldBalance': 300,
        'totalBalance': 1500,
        'pendingWithdrawals': 1,
        'bankAccount': {
          'accountName': 'Org Account',
          'accountNumber': '0123456789',
          'bankName': 'Test Bank',
        },
        'withdrawals': [
          {
            'reference': 'ORG-WD-19',
            'amount': 150,
            'status': 'PENDING',
            'createdAt': '2025-01-01',
            'destinationSnapshot': {
              'bankName': 'Test Bank',
              'maskedAccountNumber': '••••6789',
            },
          },
        ],
        'wallet': {
          'availableBalance': 1200,
          'ledgerBalance': 1500,
          'heldBalance': 300,
          'pendingWithdrawals': 1,
        },
      },
      page: 1,
      search: '',
      status: '',
      loading: false,
      onRetry: () {},
      onPage: (_) {},
      onSearch: (_) {},
      onStatus: (_) {},
      filter: (_, __) {},
      action: (action, payload) async {
        if (action == 'withdraw') actionPayload = payload;
      },
      detail: (_) async {},
      memberMessage: (_) async {},
      memberPayments: (_) async {},
      memberCard: (_) async {},
      filters: const {},
      openFiltered: (_, __) {},
      memberEdit: (_) async {},
      branchAdmin: (_) async {},
    );
    await tester.binding.setSurfaceSize(const Size(390, 800));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OwnerWalletSection(
            input: input,
            onBankSave: (values) async => bankPayload = values,
          ),
        ),
      ),
    );
    expect(find.textContaining('Available balance:'), findsOneWidget);
    expect(find.textContaining('Ledger balance:'), findsOneWidget);
    expect(find.textContaining('Held withdrawals:'), findsOneWidget);
    expect(find.text('Withdrawal bank account'), findsOneWidget);
    expect(find.text('Withdrawal history'), findsOneWidget);
    expect(find.textContaining('••••6789'), findsOneWidget);
    await tester.tap(find.text('Withdraw'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    expect(fields, findsOneWidget);
    expect(find.textContaining('0123456789'), findsWidgets);
    await tester.enterText(fields, '100');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm destination'), findsWidgets);
    await tester.tap(find.widgetWithText(FilledButton, 'Confirm destination'));
    await tester.pumpAndSettle();
    expect(actionPayload, {'amount': 100});
    expect(bankPayload, isNull);
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('missing account redirects to exactly three bank fields', (
    tester,
  ) async {
    Map<String, dynamic>? saved;
    final input = _walletInput(
      data: {'availableBalance': 900, 'withdrawals': <dynamic>[]},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OwnerWalletSection(
            input: input,
            onBankSave: (values) async => saved = values,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Withdraw'));
    await tester.pumpAndSettle();
    expect(find.text('Add withdrawal bank account'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(3));
    await tester.enterText(find.byType(TextFormField).at(0), 'Lola Holdings');
    await tester.enterText(find.byType(TextFormField).at(1), '0192837465');
    await tester.enterText(find.byType(TextFormField).at(2), 'Cedar Bank');
    await tester.tap(find.text('Save account'));
    await tester.pumpAndSettle();
    expect(saved, {
      'accountName': 'Lola Holdings',
      'accountNumber': '0192837465',
      'bankName': 'Cedar Bank',
    });
  });

  testWidgets('saved destination form supports editing the same three fields', (
    tester,
  ) async {
    Map<String, dynamic>? saved;
    final input = _walletInput(
      data: {
        'availableBalance': 900,
        'bankAccount': {
          'accountName': 'Old Name',
          'accountNumber': '0192837465',
          'bankName': 'Cedar Bank',
        },
        'withdrawals': <dynamic>[],
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OwnerWalletSection(
            input: input,
            onBankSave: (values) async => saved = values,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Edit bank account'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNWidgets(3));
    await tester.enterText(find.byType(TextFormField).at(0), 'New Name');
    await tester.tap(find.text('Save account'));
    await tester.pumpAndSettle();
    expect(saved?['accountName'], 'New Name');
    expect(saved?['accountNumber'], '0192837465');
  });
}

DashboardInput _walletInput({required Map<String, dynamic> data}) =>
    DashboardInput(
      data: data,
      page: 1,
      search: '',
      status: '',
      loading: false,
      onRetry: () {},
      onPage: (_) {},
      onSearch: (_) {},
      onStatus: (_) {},
      filter: (_, __) {},
      action: (_, __) async {},
      detail: (_) async {},
      memberMessage: (_) async {},
      memberPayments: (_) async {},
      memberCard: (_) async {},
      filters: const {},
      openFiltered: (_, __) {},
      memberEdit: (_) async {},
      branchAdmin: (_) async {},
    );
