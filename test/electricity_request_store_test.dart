import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../lib/services/electricity_request_store.dart';

void main() {
  final token = 'header.${base64Url.encode(utf8.encode(jsonEncode({'id':'012345678901234567890123'})))}.signature';
  final intent = {'meterNumber':'62130123456', 'amount':'1000.00'};
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test('same request survives reload and is not regenerated', () async {
    final key = await ElectricityRequestStore.persist(token, intent);
    expect(await ElectricityRequestStore.persist(token, intent), key);
    await ElectricityRequestStore.markSubmitted(token);
    await ElectricityRequestStore.rememberResult(token, {'transactionId':'unit-transaction'});
    expect((await ElectricityRequestStore.read(token))?['key'], key);
    expect((await ElectricityRequestStore.read(token))?['phase'], 'SUBMITTED');
    expect((await ElectricityRequestStore.read(token))?['transactionId'], 'unit-transaction');
  });
  test('unresolved request cannot silently become a different payment', () async {
    await ElectricityRequestStore.persist(token, intent);
    await ElectricityRequestStore.markSubmitted(token);
    await expectLater(ElectricityRequestStore.persist(token, {'meterNumber':'62130987654','amount':'1000.00'}), throwsStateError);
  });
  test('only explicit completion removes a stored key', () async {
    await ElectricityRequestStore.persist(token, intent);
    await ElectricityRequestStore.complete(token);
    expect(await ElectricityRequestStore.read(token), isNull);
  });
  test('invalid sessions cannot cache an unscoped payment', () async {
    await expectLater(ElectricityRequestStore.persist('invalid', intent), throwsStateError);
  });
}