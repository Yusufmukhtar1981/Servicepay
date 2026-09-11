import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/organizations/organization_owner_dashboard.dart';
import 'package:servicepay_app/organizations/organizations_api.dart';

class _TreasuryClient extends http.BaseClient {
  final requests = <String>[];
  final bodies = <String>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add('${request.method} ${request.url.path}');
    bodies.add(await request.finalize().bytesToString());
    final path = request.url.path;
    final body = path.endsWith('/treasury')
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

  testWidgets('mobile treasury wallet shows balance labels and safe controls', (
    tester,
  ) async {
    Map<String, dynamic>? actionPayload;
    final input = DashboardInput(
      data: {
        'wallet': {
          'availableBalance': 1200,
          'ledgerBalance': 1500,
          'heldBalance': 300,
          'pendingWithdrawals': 0,
        },
        'summary': {
          'totalMoneyIn': 5000,
          'totalWithdrawn': 3800,
          'totalFees': 20,
        },
        'settlementAccounts': [
          {
            'id': 'account-1',
            'bankName': 'Test Bank',
            'accountName': 'Org Account',
            'status': 'VERIFIED',
          },
        ],
        'withdrawals': <Map<String, dynamic>>[],
        'ledger': <Map<String, dynamic>>[],
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
        home: Scaffold(body: OwnerWalletSection(input: input)),
      ),
    );
    expect(find.textContaining('Available:'), findsOneWidget);
    expect(find.textContaining('Ledger:'), findsOneWidget);
    expect(find.textContaining('Held:'), findsOneWidget);
    expect(find.textContaining('Money in:'), findsOneWidget);
    expect(find.text('Withdraw funds'), findsOneWidget);
    expect(find.text('Settlement accounts'), findsOneWidget);
    expect(find.text('Withdrawal history'), findsOneWidget);
    await tester.tap(find.text('Withdraw funds'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '100');
    await tester.enterText(fields.at(1), 'Payroll');
    await tester.enterText(fields.at(2), '1234');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm withdrawal'), findsOneWidget);
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(actionPayload?['settlementAccountId'], 'account-1');
    expect(actionPayload?['narration'], 'Payroll');
    expect(actionPayload?['transactionPin'], '1234');
    await tester.binding.setSurfaceSize(null);
  });
}
