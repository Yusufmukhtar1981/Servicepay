import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/branch_manager/branch_counter_api.dart';
import 'package:servicepay_app/branch_manager/branch_counter_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues(<String, Object>{});

  late _FakeCounterApi api;
  late CounterPendingIntentStore store;

  setUp(() async {
    api = _FakeCounterApi();
    store = CounterPendingIntentStore(
      preferencesLoader: SharedPreferences.getInstance,
      tokenReader: () async => 'test-branch-account',
    );
    await store.clear();
  });

  testWidgets('counter list searches branch orders and status filters',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: BranchCounterScreen(api: api, pendingStore: store),
    ));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.text('SPDL-20260603-000018'),
      find.byType(Scrollable).first,
      const Offset(0, -260),
    );
    expect(find.text('SPDL-20260603-000018'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('counter-search')), 'Mina');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(api.lastSearch, 'Mina');

    await tester.tap(find.byKey(const Key('counter-status-IN_TRANSIT')));
    await tester.pumpAndSettle();
    expect(api.lastStatus, 'IN_TRANSIT');
  });

  testWidgets('ambiguous submit reuses durable key and reaches success',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 1;
    api.failFirstCreate = true;
    await tester.pumpWidget(MaterialApp(
      home: BranchCounterCreateScreen(
        key: const ValueKey<String>('reopened-counter-form'),
        api: api,
        pendingStore: store,
        config: _config,
      ),
    ));
    await tester.pumpAndSettle();
    await _fillCounterForm(tester);
    await tester.tap(find.byKey(const Key('counter-get-quote')));
    await tester.pumpAndSettle();
    expect(find.text('₦2,500'), findsOneWidget);
    expect(find.text('Delivery fee'), findsOneWidget);
    expect(find.text('Handling'), findsOneWidget);
    expect(find.text('Wallet'), findsNothing);
    await tester.dragUntilVisible(
      find.textContaining('customer must complete payment'),
      find.byType(Scrollable).first,
      const Offset(0, -250),
    );

    await tester.tap(find.byKey(const Key('counter-submit-order')));
    await tester.pumpAndSettle();
    expect(find.textContaining('response timeout'), findsOneWidget);
    final Map<String, dynamic>? pending = await store.read();
    expect(pending, isNotNull);
    final String requestKey = '${pending!['idempotencyKey']}';

    await tester.pumpWidget(MaterialApp(
      home: BranchCounterCreateScreen(
        api: api,
        pendingStore: store,
        config: _config,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.textContaining('saved order attempt is unresolved'),
      find.byType(Scrollable).first,
      const Offset(0, -250),
    );
    expect(find.textContaining('saved order attempt is unresolved'),
        findsOneWidget);
    await tester.tap(find.byKey(const Key('counter-submit-order')));
    await tester.pumpAndSettle();
    expect(api.idempotencyKeys, <String>[requestKey, requestKey]);
    expect(find.text('Parcel registered'), findsOneWidget);
    expect(find.text('SPDL-20260603-000018'), findsOneWidget);
    expect(await store.read(), isNull);
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  testWidgets('interstate orders require and submit prohibited-items ack',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 1;
    await tester.pumpWidget(MaterialApp(
      home: BranchCounterCreateScreen(
        api: api,
        pendingStore: store,
        config: _interstateConfig,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('counter-choice-INTERSTATE')));
    await tester.pumpAndSettle();
    expect(
        find.byKey(const Key('counter-prohibited-items-ack')), findsOneWidget);
    await tester.dragUntilVisible(
      find.byKey(const Key('counter-route')),
      find.byType(Scrollable).first,
      const Offset(0, -250),
    );
    await tester.tap(find.byKey(const Key('counter-route')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lagos → Ogun · Lagos to Abeokuta').last);
    await tester.pumpAndSettle();
    const Map<String, String> values = <String, String>{
      'senderName': 'Mina Okafor',
      'senderPhone': '08031234567',
      'senderAddress': '14 Market Road',
      'senderLga': 'Ikeja',
      'receiverName': 'Tunde Bello',
      'receiverPhone': '08039876543',
      'receiverAddress': '6 Park Lane',
      'description': 'Books and stationery',
      'quantity': '2',
      'weightKg': '2.4',
    };
    for (final MapEntry<String, String> entry in values.entries) {
      await tester.enterText(find.byKey(Key('counter-field-${entry.key}')),
          entry.value);
    }
    await tester.tap(find.byKey(const Key('counter-get-quote')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Acknowledge the prohibited-items'),
        findsOneWidget);
    expect(api.quoteCalls, 0);

    final Finder acknowledgement =
        find.byKey(const Key('counter-prohibited-items-ack'));
    await tester.ensureVisible(acknowledgement);
    await tester.tap(acknowledgement);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('counter-get-quote')));
    await tester.tap(find.byKey(const Key('counter-get-quote')));
    await tester.pumpAndSettle();
    expect(api.lastQuoteDraft?['prohibitedItemsAcknowledged'], isTrue);
    await tester.ensureVisible(find.byKey(const Key('counter-submit-order')));
    await tester.tap(find.byKey(const Key('counter-submit-order')));
    await tester.pumpAndSettle();
    expect(api.lastCreatedDraft?['prohibitedItemsAcknowledged'], isTrue);
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  testWidgets('legacy wallet retry without linked customer is not submitted',
      (WidgetTester tester) async {
    final Map<String, dynamic> draft = <String, dynamic>{
      'kind': 'DELIVERY',
      'sender': <String, dynamic>{
        'name': 'Mina Okafor',
        'phone': '08031234567',
        'address': '14 Market Road',
        'state': 'Lagos',
        'lga': 'Ikeja',
      },
      'receiver': <String, dynamic>{
        'name': 'Tunde Bello',
        'phone': '08039876543',
        'address': '6 Park Lane',
        'state': 'Lagos',
        'lga': 'Ikeja',
      },
      'parcel': <String, dynamic>{
        'description': 'Books',
        'quantity': 1,
        'category': 'PARCEL',
      },
      'paymentMethod': 'WALLET',
    };
    await store.write(<String, dynamic>{
      'draft': draft,
      'quote': <String, dynamic>{'quoteToken': 'bound-old-quote', 'total': 2500},
      'quoteToken': 'bound-old-quote',
      'idempotencyKey': 'legacy-wallet-request',
      'fingerprint': jsonEncode(draft),
    });
    await tester.pumpWidget(MaterialApp(
      home: BranchCounterCreateScreen(
        api: api,
        pendingStore: store,
        config: _config,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.textContaining('no linked customer ID'),
      find.byType(Scrollable).first,
      const Offset(0, -250),
    );
    expect(find.text('Confirmed delivery quote'), findsOneWidget);
    await tester.dragUntilVisible(
      find.byKey(const Key('counter-submit-order')),
      find.byType(Scrollable).first,
      const Offset(0, -250),
    );
    final FilledButton retry = tester.widget<FilledButton>(
        find.byKey(const Key('counter-submit-order')));
    expect(retry.onPressed, isNull);
    expect(api.idempotencyKeys, isEmpty);
    expect(api.quoteCalls, 0);
    expect(await store.read(), isNotNull);
  });

  testWidgets('order exposes manager approval only when server allows it',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: BranchCounterOrderScreen(
        api: api,
        order: _order,
        config: <String, dynamic>{
          ..._config,
          'canConfirmPayments': true,
        },
        receiptOpener: (String html) async => true,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.text('Handling'),
      find.byType(Scrollable).first,
      const Offset(0, -220),
    );
    expect(find.text('Delivery fee'), findsOneWidget);
    expect(find.text('₦2,000'), findsOneWidget);
    expect(find.text('Handling'), findsOneWidget);
    expect(find.text('₦500'), findsOneWidget);
    final Finder approval =
        find.byKey(const Key('counter-manager-approve-payment'));
    await tester.dragUntilVisible(
      approval,
      find.byType(Scrollable).first,
      const Offset(0, -250),
    );
    expect(approval, findsOneWidget);
    expect(find.text('UNPAID'), findsWidgets);

    await tester.pumpWidget(MaterialApp(
      home: BranchCounterOrderScreen(
        api: api,
        order: _order,
        config: _config,
      ),
    ));
    await tester.pumpAndSettle();
    expect(
        find.byKey(const Key('counter-manager-approve-payment')), findsNothing);
    expect(find.byKey(const Key('counter-payment-evidence')), findsOneWidget);
  });

  testWidgets('responsive screen fits phone, tablet, desktop widths',
      (WidgetTester tester) async {
    for (final Size size in <Size>[
      const Size(320, 720),
      const Size(800, 900),
      const Size(1366, 900),
    ]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(MaterialApp(
        home: BranchCounterScreen(api: api, pendingStore: store),
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  testWidgets('receipt request fetches securely and records print intent',
      (WidgetTester tester) async {
    bool opened = false;
    await tester.pumpWidget(MaterialApp(
      home: BranchCounterOrderScreen(
        api: api,
        order: _order,
        config: _config,
        receiptOpener: (String html) async {
          opened = html.contains('ServicePay');
          return true;
        },
      ),
    ));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
        find.text('A4'), find.byType(Scrollable).first, const Offset(0, -250));
    await tester.tap(find.text('A4'));
    await tester.pumpAndSettle();
    expect(opened, isTrue);
    expect(api.receiptLayout, 'A4');
    expect(api.printEvents, <String>['true:A4']);
  });
}

Future<void> _fillCounterForm(WidgetTester tester) async {
  const Map<String, String> values = <String, String>{
    'senderName': 'Mina Okafor',
    'senderPhone': '08031234567',
    'senderAddress': '14 Market Road',
    'senderLga': 'Ikeja',
    'receiverName': 'Tunde Bello',
    'receiverPhone': '08039876543',
    'receiverAddress': '6 Park Lane',
    'receiverLga': 'Ikeja',
    'description': 'Books and stationery',
    'quantity': '2',
  };
  for (final MapEntry<String, String> entry in values.entries) {
    final Finder field = find.byKey(Key('counter-field-${entry.key}'));
    await tester.enterText(field, entry.value);
  }
}

const Map<String, dynamic> _config = <String, dynamic>{
  'success': true,
  'canConfirmPayments': false,
  'branch': <String, dynamic>{
    '_id': 'branch-1',
    'name': 'Ikeja Central',
    'state': 'Lagos',
    'lga': 'Ikeja',
    'address': '14 Market Road',
  },
  'routes': <Map<String, dynamic>>[],
  'standardDeliveryFee': 2000,
};

final Map<String, dynamic> _order = <String, dynamic>{
  '_id': 'order-1',
  'kind': 'DELIVERY',
  'trackingNumber': 'SPDL-20260603-000018',
  'receiptNumber': 'SPRC-000018',
  'status': 'PENDING_PICKUP',
  'paymentStatus': 'UNPAID',
  'total': 2500,
  'deliveryFee': 2000,
  'charges': <Map<String, dynamic>>[
    <String, dynamic>{'name': 'Handling', 'amount': 500}
  ],
  'sender': <String, dynamic>{
    'name': 'Mina Okafor',
    'phone': '08031234567',
    'address': '14 Market Road',
  },
  'receiver': <String, dynamic>{
    'name': 'Tunde Bello',
    'phone': '08039876543',
    'address': '6 Park Lane',
    'lga': 'Ikeja',
    'state': 'Lagos',
  },
  'parcel': <String, dynamic>{
    'description': 'Books',
    'category': 'PARCEL',
    'quantity': 2,
  },
  'payment': <String, dynamic>{
    'method': 'CASH',
    'reference': '',
    'note': '',
  },
};

final Map<String, dynamic> _interstateConfig = <String, dynamic>{
  ..._config,
  'routes': <Map<String, dynamic>>[
    <String, dynamic>{
      '_id': 'route-lagos-ogun',
      'originBranchId': 'branch-1',
      'originState': 'Lagos',
      'destinationState': 'Ogun',
      'destinationLga': 'Abeokuta',
      'name': 'Lagos to Abeokuta',
    }
  ],
};

class _FakeCounterApi implements BranchCounterApi {
  String lastStatus = 'ALL';
  String lastSearch = '';
  bool failFirstCreate = false;
  int _createCount = 0;
  final List<String> idempotencyKeys = <String>[];
  int quoteCalls = 0;
  Map<String, dynamic>? lastQuoteDraft;
  Map<String, dynamic>? lastCreatedDraft;
  String? receiptLayout;
  final List<String> printEvents = <String>[];

  @override
  Future<Map<String, dynamic>> loadConfig() async => _config;

  @override
  Future<Map<String, dynamic>> listOrders({
    required String status,
    required String search,
    required int page,
  }) async {
    lastStatus = status;
    lastSearch = search;
    return <String, dynamic>{
      'success': true,
      'orders': <Map<String, dynamic>>[_order],
      'stats': <String, dynamic>{
        'todayOrders': 3,
        'todayRevenue': 4500,
        'pendingPickup': 1,
        'inTransit': 1,
        'delivered': 1,
      },
      'page': page,
      'total': 1,
    };
  }

  @override
  Future<Map<String, dynamic>> quote(Map<String, dynamic> draft) async {
    quoteCalls++;
    lastQuoteDraft = draft;
    return <String, dynamic>{
        'success': true,
        'quote': <String, dynamic>{
          'deliveryFee': 2000,
          'charges': <Map<String, dynamic>>[
            <String, dynamic>{'name': 'Handling', 'amount': 500}
          ],
          'total': 2500,
          'quoteToken': 'quote-one',
          'expiresAt': '2026-06-03T12:30:00Z',
        },
      };
  }

  @override
  Future<Map<String, dynamic>> createOrder(
    Map<String, dynamic> draft, {
    required String quoteToken,
    required String idempotencyKey,
  }) async {
    lastCreatedDraft = draft;
    idempotencyKeys.add(idempotencyKey);
    _createCount++;
    if (failFirstCreate && _createCount == 1) {
      throw const CounterApiException('response timeout');
    }
    return <String, dynamic>{'success': true, 'order': _order};
  }

  @override
  Future<Map<String, dynamic>> getOrder(String kind, String id) async =>
      <String, dynamic>{'order': _order};

  @override
  Future<Map<String, dynamic>> submitPaymentEvidence(String kind, String id,
          {required String reference, required String note}) async =>
      <String, dynamic>{'order': _order};

  @override
  Future<Map<String, dynamic>> confirmPayment(String kind, String id,
          {required String reference, required String note}) async =>
      <String, dynamic>{'order': _order};

  @override
  Future<Map<String, dynamic>> cancelOrder(String kind, String id) async =>
      <String, dynamic>{'order': _order};

  @override
  Future<Map<String, dynamic>> getReceipt(String kind, String id,
      {required String layout}) async {
    receiptLayout = layout;
    return <String, dynamic>{
      'html': '<html><title>ServicePay</title></html>',
      'trackingNumber': _order['trackingNumber'],
    };
  }

  @override
  Future<void> recordPrintEvent(String kind, String id,
      {required bool reprint, required String layout}) async {
    printEvents.add('$reprint:$layout');
  }
}
