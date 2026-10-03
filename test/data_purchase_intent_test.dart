import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';

class _MemoryIntentStorage implements DataPurchaseIntentStorage {
  final Map<String, String> entries = <String, String>{};

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

class _SlowIntentStorage extends _MemoryIntentStorage {
  @override
  Future<String?> read(String key) async {
    await Future<void>.delayed(const Duration(milliseconds: 5));
    return super.read(key);
  }
}

void main() {
  final storage = _MemoryIntentStorage();
  DataPurchaseIntent tracker([String account = 'customer-a']) =>
      DataPurchaseIntent(
        storage: storage,
        accountId: () async => account,
      );

  Future<String> buy(
    DataPurchaseIntent intent, {
    String network = 'MTN',
    String phone = '08012345678',
    String plan = 'plan-a',
    double price = 100,
    String quote = 'signed-quote-a',
  }) =>
      intent.keyForSubmission(
        network: network,
        phone: phone,
        planCode: plan,
        price: price,
        productQuote: quote,
      );

  test(
      'new MTN plan A, MTN plan B, Airtel plan and repeated plan get distinct keys',
      () async {
    final intent = tracker();
    final a = await buy(intent);
    await intent.finish(a); // Server-confirmed terminal result.
    final b = await buy(intent, plan: 'plan-b', quote: 'signed-quote-b');
    await intent.finish(b);
    final airtel = await buy(
      intent,
      network: 'Airtel',
      plan: 'airtel-plan',
      quote: 'signed-quote-c',
    );
    await intent.finish(airtel);
    final repeatedA = await buy(intent);
    expect({a, b, airtel, repeatedA}.length, 4);
    for (final key in [a, b, airtel, repeatedA]) {
      expect(key, matches(RegExp(r'^data-[A-Za-z0-9_-]{32}$')));
    }
  });

  test('double submission and retransmission retain one stored key', () async {
    final intent = tracker();
    final keys = await Future.wait([buy(intent), buy(intent)]);
    expect(keys[0], keys[1]);
    expect(await buy(tracker()), keys[0],
        reason: 'a screen restart must recover the key');
    expect(storage.entries.length, 1);
    await intent.finish(keys[0]);
    expect(await buy(tracker()), isNot(keys[0]));
  });

  test(
      'PIN preparation persists one key and cancellation never discards a submitted intent',
      () async {
    final isolated = _MemoryIntentStorage();
    final intent = DataPurchaseIntent(
        storage: isolated, accountId: () async => 'pin-customer');
    Future<String> prepare() => intent.keyForSubmission(
        network: 'MTN',
        phone: '08012345678',
        planCode: 'plan-a',
        price: 100,
        preparedOnly: true);
    final first = await prepare();
    expect(await intent.pending(), isNull);
    expect(await prepare(), first);
    await intent.cancelPreparation(first);
    expect(isolated.entries, isEmpty);
    final next = await prepare();
    expect(next, isNot(first));
    await intent.markSubmitted(next);
    await intent.cancelPreparation(next);
    expect((await intent.pending())!['key'], next);
    expect(await prepare(), next);
    await intent.finish(next);
    expect(await prepare(), isNot(next));
  });

  test('two simultaneous screens cannot issue two keys for one intent',
      () async {
    final slowStorage = _SlowIntentStorage();
    final keys = await Future.wait([
      buy(DataPurchaseIntent(
        storage: slowStorage,
        accountId: () async => 'simultaneous-customer',
      )),
      buy(DataPurchaseIntent(
        storage: slowStorage,
        accountId: () async => 'simultaneous-customer',
      )),
    ]);
    expect(keys[0], keys[1]);
  });

  test('unresolved purchase blocks different phone, plan, network or quote',
      () async {
    final intent = tracker();
    final key = await buy(intent);
    for (final changed in [
      () => buy(intent, phone: '08098765432'),
      () => buy(intent, plan: 'plan-b'),
      () => buy(intent, network: 'Airtel'),
      () => buy(intent, price: 150),
      () => buy(intent, quote: 'different-quote'),
    ]) {
      await expectLater(changed(), throwsStateError);
    }
    expect(await buy(intent), key);
    expect(storage.entries.length, 1);
  });

  test('pending keys are scoped to the signed-in customer', () async {
    final a = await buy(tracker('customer-a'));
    final b = await buy(tracker('customer-b'));
    expect(a, isNot(b));
    expect(await buy(tracker('customer-a')), a);
  });
}
