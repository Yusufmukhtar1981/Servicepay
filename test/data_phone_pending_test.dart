import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/airtime_screen.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_phone.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';
import 'package:servicepay_app/widgets/bill_purchase_recovery.dart';

class IntentStorage implements DataPurchaseIntentStorage {
  final entries = <String, String>{};
  bool failArchive = false;
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> write(String key, String value) async {
    if (failArchive && key.endsWith('.retained')) throw StateError('disk full');
    entries[key] = value;
  }

  @override
  Future<void> delete(String key) async => entries.remove(key);
}

class TestAirtimeStorage implements AirtimePurchaseIntentStorage {
  final entries = <String, String>{};
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> write(String key, String value) async {
    entries[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    entries.remove(key);
  }
}

void main() {
  setUp(() => TestWidgetsFlutterBinding.ensureInitialized()
      .handleAppLifecycleStateChanged(AppLifecycleState.resumed));
  testWidgets('Buy DATA stays clean and does not query a historical request',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    tester.view.physicalSize = const Size(1000, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final intent = DataPurchaseIntent(
        storage: IntentStorage(), accountId: () async => 'poll-test');
    final key = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    int purchases = 0;
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      pendingContext: (_) async => {'success': true, 'pendingCount': 0},
      purchaseIntent: intent,
      loadBeneficiaries: () async => [],
      loadPlans: (_) async => {'success': true, 'plans': []},
      purchase: (_) async {
        purchases++;
        return {};
      },
    )));
    await tester.pumpAndSettle();
    expect(find.textContaining('Earlier purchase'), findsNothing);
    expect(find.text('Check Status'), findsNothing);
    expect(find.text('Start a separate purchase'), findsNothing);
    expect(purchases, 0);
    expect((await intent.pending())!['key'], key);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(seconds: 30));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpWidget(const SizedBox());
  });

  test('normalizes all requested Nigerian mobile formats safely', () {
    for (final number in [
      '08012345678',
      '07012345678',
      '08112345678',
      '09012345678',
      '09112345678'
    ]) {
      expect(normalizeDataPhone(number), number);
      expect(normalizeDataPhone('+234${number.substring(1)}'), number);
      expect(normalizeDataPhone('234${number.substring(1)}'), number);
    }
    expect(normalizeDataPhone('+234 801 234 5678'), '08012345678');
    expect(normalizeDataPhone('abc08012345678'), contains('abc'));
  });

  test(
      'explicit separate purchase retains old key and fails closed on storage failure',
      () async {
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    storage.failArchive = true;
    await expectLater(intent.retainForSeparatePurchase(old), throwsStateError);
    expect((await intent.pending())!['key'], old);
    storage.failArchive = false;
    await intent.retainForSeparatePurchase(old);
    expect(await intent.pending(), isNull);
    expect((await intent.retained()).single['key'], old);
    final fresh = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    expect(fresh, isNot(old));
    expect((await intent.retained()).single['key'], old);
    await intent.finishRetained(old);
    expect(await intent.retained(), isEmpty);
    expect((await intent.pending())!['key'], fresh);
  });

  testWidgets(
      'phone remains focusable and editable during catalogue load and pending recovery',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    final plans = Completer<Map<String, dynamic>>();
    int purchases = 0;
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      pendingContext: (_) async => {'success': true, 'pendingCount': 0},
      purchaseIntent: intent,
      loadBeneficiaries: () async => [],
      loadPlans: (_) => plans.future,
      purchase: (_) async {
        purchases++;
        return {};
      },
    )));
    await tester.pump(const Duration(milliseconds: 50));
    final input = find.byType(TextField).first;
    await tester.tap(input);
    await tester.pump();
    expect(tester.testTextInput.isVisible, true);
    await tester.enterText(input, '+2348012345678');
    expect(tester.widget<TextField>(input).controller!.text, '+2348012345678');
    await tester.enterText(input, '0801234567');
    expect(tester.widget<TextField>(input).controller!.text, '0801234567');
    plans.complete({
      'success': true,
      'plans': [
        {'code': 'x', 'name': '1GB SME', 'price': 100}
      ]
    });
    await tester.pumpAndSettle();
    expect(purchases, 0);
    expect((await intent.pending())!['key'], isNotEmpty);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Buy').first)
            .onPressed,
        isNotNull);
  });

  testWidgets(
      'historical DATA uncertainty does not clutter Buy or trigger old status calls',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    int submits = 0;
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      pendingContext: (_) async => {'success': true, 'pendingCount': 0},
      purchaseIntent: intent,
      loadBeneficiaries: () async => [],
      loadPlans: (_) async => {
        'success': true,
        'plans': [
          {'code': 'x', 'name': '1GB SME', 'price': 100}
        ]
      },
      purchase: (_) async {
        submits++;
        return {};
      },
    )));
    await tester.pumpAndSettle();
    expect(find.textContaining('Earlier purchase'), findsNothing);
    expect(find.text('Check Status'), findsNothing);
    expect(find.text('Start a separate purchase'), findsNothing);
    expect(find.textContaining('Your transaction is being processed'),
        findsNothing);
    expect(await intent.pending(), isNotNull);
    expect((await intent.pending())!['key'], old);
    expect(submits, 0, reason: 'acknowledgement never buys or resends');
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'History checks a durable DATA reference without producing a receipt',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    final key = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    await intent.rememberReference(key, 'DATA-original-reference');
    var checked = 0;
    var purchases = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: BillPurchaseRecovery(
      isActive: true,
      dataIntent: intent,
      airtimeIntent: AirtimePurchaseIntent(storage: TestAirtimeStorage()),
      dataStatusQuery: (reference) async {
        expect(reference, 'DATA-original-reference');
        checked++;
        return checked == 1
            ? {'status': 'PENDING', 'pending': true}
            : {
                'success': false,
                'status': 'FAILED',
                'dispatchStatus': 'REFUNDED',
                'pending': false,
                'reference': reference,
                'message': 'Data purchase failed. Wallet refund confirmed.'
              };
      },
    ))));
    await tester.pumpAndSettle();
    expect(find.text('Purchase verification'), findsOneWidget);
    expect(find.textContaining('Still verifying'), findsOneWidget);
    await tester.tap(find.byTooltip('Check request').first);
    await tester.pumpAndSettle();
    expect(checked, 2);
    expect(purchases, 0);
    expect(await intent.pending(), isNull);
    expect(find.textContaining('Data Purchase Successful'), findsNothing);
    expect(find.text('Check Status'), findsNothing);
  });

  testWidgets(
      'History recovery is inactive off-screen and checks AIRTIME when active',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final airtimeIntent = AirtimePurchaseIntent(storage: TestAirtimeStorage());
    final key = await airtimeIntent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      amount: '50',
    );
    var checks = 0;
    Widget recovery(bool active) => MaterialApp(
          home: Scaffold(
            body: BillPurchaseRecovery(
              isActive: active,
              dataIntent: DataPurchaseIntent(
                  storage: IntentStorage(), accountId: () async => 'empty'),
              airtimeIntent: airtimeIntent,
              airtimeStatusQuery: (request) async {
                expect(request, key);
                checks++;
                return {
                  'success': false,
                  'status': 'PENDING',
                  'httpStatus': 202,
                };
              },
            ),
          ),
        );

    await tester.pumpWidget(recovery(false));
    await tester.pumpAndSettle();
    expect(checks, 0);
    await tester.pumpWidget(recovery(true));
    await tester.pumpAndSettle();
    expect(checks, 1);
    expect(await airtimeIntent.pendingKey(), key);
    expect(find.textContaining('Still verifying'), findsOneWidget);
    expect(find.textContaining('Successful'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('History ignores status results after becoming inactive',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final intent = DataPurchaseIntent(
      storage: IntentStorage(),
      accountId: () async => 'inactive-query',
    );
    final key = await intent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      planCode: 'x',
      price: 100,
    );
    final status = Completer<Map<String, dynamic>>();
    Widget recovery(bool active) => MaterialApp(
          home: Scaffold(
            body: BillPurchaseRecovery(
              isActive: active,
              dataIntent: intent,
              airtimeIntent:
                  AirtimePurchaseIntent(storage: TestAirtimeStorage()),
              dataStatusQuery: (_) => status.future,
            ),
          ),
        );
    await tester.pumpWidget(recovery(true));
    await tester.pump();
    await tester.pumpWidget(recovery(false));
    status.complete({
      'success': true,
      'status': 'SUCCESSFUL',
      'reference': 'DATA-inactive',
    });
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], key);
    expect(find.textContaining('confirmed'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  for (final status in ['PENDING', 'SUCCESSFUL']) {
    testWidgets(
        'History refreshes the financial list only for $status evidence',
        (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final intent = DataPurchaseIntent(
        storage: IntentStorage(),
        accountId: () async => 'terminal-refresh-$status',
      );
      await intent.keyForSubmission(
        network: 'MTN',
        phone: '08012345678',
        planCode: 'x',
        price: 100,
      );
      int refreshes = 0;
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(
        body: BillPurchaseRecovery(
          isActive: true,
          dataIntent: intent,
          airtimeIntent: AirtimePurchaseIntent(storage: TestAirtimeStorage()),
          dataStatusQuery: (_) async => {
            'success': status == 'SUCCESSFUL',
            'status': status,
            'reference': 'DATA-verified-refresh',
          },
          onTerminalStatusConfirmed: () => refreshes++,
        ),
      )));
      await tester.pumpAndSettle();
      expect(refreshes, status == 'SUCCESSFUL' ? 1 : 0);
      await tester.pumpWidget(const SizedBox());
    });
  }

  testWidgets(
      'History stops background lookups and checks immediately on resume',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final intent = DataPurchaseIntent(
      storage: IntentStorage(),
      accountId: () async => 'lifecycle-recovery',
    );
    await intent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      planCode: 'x',
      price: 100,
    );
    int checks = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
      body: BillPurchaseRecovery(
        isActive: true,
        dataIntent: intent,
        airtimeIntent: AirtimePurchaseIntent(storage: TestAirtimeStorage()),
        dataStatusQuery: (_) async {
          checks++;
          return {'success': false, 'status': 'PENDING', 'pending': true};
        },
      ),
    )));
    await tester.pumpAndSettle();
    expect(checks, 1);
    for (final state in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
    }
    await tester.pump(const Duration(seconds: 30));
    expect(checks, 1);
    for (final state in [
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
    }
    await tester.pumpAndSettle();
    expect(checks, 2);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('History ignores status results after disposal', (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final intent = DataPurchaseIntent(
      storage: IntentStorage(),
      accountId: () async => 'disposed-query',
    );
    final key = await intent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      planCode: 'x',
      price: 100,
    );
    final status = Completer<Map<String, dynamic>>();
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: BillPurchaseRecovery(
          isActive: true,
          dataIntent: intent,
          airtimeIntent: AirtimePurchaseIntent(storage: TestAirtimeStorage()),
          dataStatusQuery: (_) => status.future,
        ),
      ),
    ));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    status.complete({
      'success': true,
      'status': 'SUCCESSFUL',
      'reference': 'DATA-disposed',
    });
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], key);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unconfirmed lookup errors never retire as DATA failure',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final intent = DataPurchaseIntent(
      storage: IntentStorage(),
      accountId: () async => 'lookup-404',
    );
    final key = await intent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      planCode: 'x',
      price: 100,
    );
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: BillPurchaseRecovery(
          isActive: true,
          dataIntent: intent,
          airtimeIntent: AirtimePurchaseIntent(storage: TestAirtimeStorage()),
          dataStatusQuery: (_) async => {
            'success': false,
            'status': 'FAILED',
            'httpStatus': 404,
          },
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], key);
    expect(find.textContaining('not fulfilled'), findsNothing);
    expect(
        find.textContaining('Status could not be confirmed'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'History retirement refusal retains key; only server confirmation retires it',
      (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final intent = DataPurchaseIntent(
      storage: IntentStorage(),
      accountId: () async => 'retirement',
    );
    final key = await intent.keyForSubmission(
      network: 'MTN',
      phone: '08012345678',
      planCode: 'x',
      price: 100,
    );
    final refusal = Completer<Map<String, dynamic>>();
    var retireCalls = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: BillPurchaseRecovery(
          isActive: true,
          dataIntent: intent,
          airtimeIntent: AirtimePurchaseIntent(storage: TestAirtimeStorage()),
          dataStatusQuery: (_) async => {
            'success': false,
            'status': 'UNKNOWN',
            'pending': true,
            'canRetireUnrecordedRequest': true,
          },
          dataRetireRequest: (_) {
            retireCalls++;
            return retireCalls == 1
                ? refusal.future
                : Future.value({
                    'requestRetired': true,
                    'status': 'FAILED',
                    'message': 'The server confirmed no purchase was admitted.',
                  });
          },
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resolve unrecorded request'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resolve request'));
    await tester.pump();
    expect(retireCalls, 1);
    expect(find.text('Resolving request…'), findsOneWidget);
    await tester.tap(find.text('Resolving request…'), warnIfMissed: false);
    await tester.pump();
    expect(retireCalls, 1, reason: 'retirement requests must not overlap');

    refusal.complete({
      'requestRetired': false,
      'status': 'UNKNOWN',
      'message': 'Still uncertain',
    });
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], key);
    expect(find.textContaining('did not confirm retirement'), findsOneWidget);

    await tester.tap(find.text('Resolve unrecorded request'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resolve request'));
    await tester.pumpAndSettle();
    expect(retireCalls, 2);
    expect(await intent.pending(), isNull);
    expect(find.text('The server confirmed no purchase was admitted.'),
        findsOneWidget);
  });
}
