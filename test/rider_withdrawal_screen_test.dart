import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/rider/rider_withdrawal_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const String keyOne = 'withdrawal-request-key-000001';
  const String keyTwo = 'withdrawal-request-key-000002';

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'rider-token',
    });
  });

  testWidgets('sends the withdrawal payload and idempotency header once',
      (WidgetTester tester) async {
    final List<http.Request> requests = <http.Request>[];
    final MockClient client = MockClient((http.Request request) async {
      requests.add(request);
      return _responseFor(request);
    });

    await _pumpScreen(tester, client, () => keyOne);
    await _fillValidWithdrawal(tester);

    // The submit control is brought into view on the mobile-sized surface.
    final Finder requestButton = find.text('Request Withdrawal');
    await _showRequestButton(tester, requestButton);
    await tester.tap(requestButton);
    await tester.pump();
    expect(find.text('Confirm Withdrawal'), findsOneWidget);

    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();

    final List<http.Request> posts = requests
        .where((http.Request request) => request.method == 'POST')
        .toList();
    expect(posts, hasLength(1));
    expect(posts.single.headers['idempotency-key'], keyOne);
    expect(jsonDecode(posts.single.body), <String, dynamic>{
      'amount': 1000.0,
      'bankCode': '044',
      'bankName': 'Access Bank',
      'accountNumber': '0123456789',
      'accountName': 'Jane Rider',
      'transactionPin': '1234',
      'narration': 'ServicePay Rider commission withdrawal',
    });
    expect(
        find.text('Withdrawal request submitted successfully'), findsOneWidget);
    // Two summary fetches verify that the displayed balance is refreshed.
    expect(
      requests.where((http.Request request) =>
          request.url.path.endsWith('/commission-summary')),
      hasLength(2),
    );
    expect(
      requests.where((http.Request request) =>
          request.url.path.endsWith('/rider/withdrawals')),
      hasLength(3),
    );
  });

  testWidgets('keeps the key after a timeout and retries it safely',
      (WidgetTester tester) async {
    final List<http.Request> posts = <http.Request>[];
    var attempt = 0;
    final MockClient client = MockClient((http.Request request) {
      if (request.method == 'POST') {
        posts.add(request);
        attempt++;
        if (attempt == 1) {
          return Completer<http.Response>().future;
        }
      }
      return Future<http.Response>.value(_responseFor(request));
    });

    await _pumpScreen(tester, client, () => keyOne,
        timeout: const Duration(milliseconds: 10));
    await _fillValidWithdrawal(tester);
    await _confirm(tester);
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'The request timed out and may still be pending. Retry safely to check its status.',
      ),
      findsOneWidget,
    );

    await _confirm(tester);
    await tester.pumpAndSettle();
    expect(posts, hasLength(2));
    expect(posts[0].headers['idempotency-key'], keyOne);
    expect(posts[1].headers['idempotency-key'], keyOne);
  });

  testWidgets('shows a wrong PIN error and unlocks submission',
      (WidgetTester tester) async {
    var keys = <String>[keyOne, keyTwo].iterator;
    var postCount = 0;
    final MockClient client = MockClient((http.Request request) async {
      if (request.method == 'POST') {
        postCount++;
        return http.Response('{"message":"Incorrect transaction PIN"}', 400);
      }
      return _responseFor(request);
    });

    await _pumpScreen(tester, client, () {
      keys.moveNext();
      return keys.current;
    });
    await _fillValidWithdrawal(tester);
    await _confirm(tester);
    await tester.pumpAndSettle();

    expect(find.text('Incorrect transaction PIN'), findsOneWidget);
    await _confirm(tester);
    await tester.pumpAndSettle();
    expect(postCount, 2);
  });
}

Future<void> _pumpScreen(
  WidgetTester tester,
  http.Client client,
  String Function() keyGenerator, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  tester.view.physicalSize = const Size(430, 932);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: RiderWithdrawalScreen(
        httpClient: client,
        apiBaseUrl: 'https://example.test/api',
        withdrawalTimeout: timeout,
        idempotencyKeyGenerator: keyGenerator,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _fillValidWithdrawal(WidgetTester tester) async {
  final Finder fields = find.byType(TextFormField);
  await tester.ensureVisible(fields.at(0));
  await tester.enterText(fields.at(0), '1000');
  final Finder bankDropdown = find.byType(DropdownButtonFormField<String>);
  await tester.ensureVisible(bankDropdown);
  await tester.tap(bankDropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Access Bank').last);
  await tester.pump();
  await tester.ensureVisible(fields.at(1));
  await tester.enterText(fields.at(1), '0123456789');
  await tester.ensureVisible(fields.at(2));
  await tester.enterText(fields.at(2), 'Jane Rider');
  await tester.ensureVisible(fields.at(3));
  await tester.enterText(fields.at(3), '1234');
}

Future<void> _confirm(WidgetTester tester) async {
  final Finder requestButton = find.text('Request Withdrawal');
  await _showRequestButton(tester, requestButton);
  await tester.tap(requestButton);
  await tester.pump(const Duration(milliseconds: 250));
  await tester.tap(find.text('Confirm'));
  await tester.pump();
}

Future<void> _showRequestButton(
  WidgetTester tester,
  Finder requestButton,
) async {
  await _dismissKeyboard(tester);
  await tester.drag(find.byType(ListView).first, const Offset(0, -500));
  await tester.pump();
  await tester.ensureVisible(requestButton);
}

Future<void> _dismissKeyboard(WidgetTester tester) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pump();
}

http.Response _responseFor(http.Request request) {
  if (request.url.path.endsWith('/commission-summary')) {
    return http.Response(
      '{"data":{"summary":{"totalCommissionEarned":10000,'
      '"availableCommission":9000,"pendingWithdrawal":1000,'
      '"totalWithdrawn":0,"minimumWithdrawal":1000,'
      '"maximumWithdrawal":500000,"withdrawalFee":0}}}',
      200,
    );
  }
  if (request.url.path.endsWith('/rider/withdrawals') &&
      request.method == 'GET') {
    return http.Response(
      '{"data":{"withdrawals":[{"amount":1000,"status":"PENDING",'
      '"bankName":"Access Bank","accountNumber":"0123456789"}]}}',
      200,
    );
  }
  if (request.url.path.endsWith('/transfer/banks')) {
    return http.Response(
      '{"banks":[{"code":"044","name":"Access Bank"}]}',
      200,
    );
  }
  return http.Response(
      '{"message":"Withdrawal request submitted successfully"}', 201);
}
