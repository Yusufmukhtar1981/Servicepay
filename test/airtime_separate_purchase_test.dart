import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/airtime_screen.dart';

class MemoryStorage implements AirtimePurchaseIntentStorage {
  final entries = <String, String>{};
  bool failWrites = false;
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> write(String key, String value) async {
    if (failWrites) throw StateError('durable write failed');
    entries[key] = value;
  }
  @override
  Future<void> delete(String key) async { entries.remove(key); }
}

void main() {
  Future<String> key(AirtimePurchaseIntent intent) => intent.keyForSubmission(
      network: 'MTN', phone: '08012345678', amount: '50');
  test('explicit separate purchase preserves old UNKNOWN key and creates a new one', () async {
    final storage = MemoryStorage();
    final intent = AirtimePurchaseIntent(storage: storage);
    final old = await key(intent);
    await intent.retainForSeparatePurchase();
    expect(await intent.pendingKey(), isNull);
    expect(await intent.retainedKeys(), [old]);
    final fresh = await key(intent);
    expect(fresh, isNot(old));
    final reopened = AirtimePurchaseIntent(storage: storage);
    expect(await reopened.retainedKeys(), containsAll([old, fresh]));
    await reopened.finish(old);
    expect(await reopened.pendingKey(), fresh);
    expect(await reopened.retainedKeys(), [fresh]);
  });
  test('retention failure never discards the old request or permits a new key', () async {
    final storage = MemoryStorage();
    final intent = AirtimePurchaseIntent(storage: storage);
    final old = await key(intent);
    storage.failWrites = true;
    await expectLater(intent.retainForSeparatePurchase(), throwsStateError);
    expect(await intent.pendingKey(), old);
    expect(await key(intent), old);
  });
  test('concurrent retention cannot lose or duplicate an earlier request', () async {
    final storage = MemoryStorage();
    final intent = AirtimePurchaseIntent(storage: storage);
    final old = await key(intent);
    await Future.wait([intent.retainForSeparatePurchase(), intent.retainForSeparatePurchase()]);
    expect(await intent.retainedKeys(), [old]);
    expect(await key(intent), isNot(old));
  });
}