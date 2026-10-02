import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/services/saved_numbers_cache.dart';
import 'package:servicepay_app/widgets/saved_beneficiaries.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';
import 'package:servicepay_app/airtime_screen.dart';

class EmptyIntentStorage implements DataPurchaseIntentStorage, AirtimePurchaseIntentStorage {
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> write(String key, String value) async {}
  @override
  Future<void> delete(String key) async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });
  test('cache namespace is identity only, never the token or another customer',
      () {
    String token(String id) =>
        'header.${base64Url.encode(utf8.encode(jsonEncode({
              'id': id
            })))}.signature';
    expect(SavedNumbersCache.ownerForToken(token('a' * 24)), 'a' * 24);
    expect(SavedNumbersCache.ownerForToken(token('b' * 24)), 'b' * 24);
    expect(SavedNumbersCache.ownerForToken('invalid'), isNull);
    expect(
        SavedNumbersCache.sanitize([
          {
            '_id': 'x',
            'phone': '08012345678',
            'pin': '1234',
            'token': 'secret',
            'balance': 9
          }
        ]).single.keys,
        unorderedEquals(['_id', 'phone']));
  });
  test(
      'encrypted persistent cache survives memory reconstruction and keeps owners apart',
      () async {
    final owner = 'c' * 24;
    await SavedNumbersCache.write(owner, [
      {'_id': 'x', 'phone': '08012345678', 'name': 'Home'}
    ]);
    expect((await SavedNumbersCache.read(owner)).single['name'], 'Home');
    expect(await SavedNumbersCache.read('d' * 24), isEmpty);
    await SavedNumbersCache.invalidate(owner);
    expect(await SavedNumbersCache.read(owner), isEmpty);
  });
  testWidgets(
      'never-ending saved numbers stop spinning; manual entry and Retry stay usable',
      (tester) async {
    final pending = Completer<List<Map<String, dynamic>>>();
    final phone = TextEditingController();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: Column(children: [
      TextField(controller: phone),
      SavedBeneficiaries(
          phoneController: phone,
          network: 'MTN',
          serviceType: 'DATA',
          loadBeneficiaries: () => pending.future,
          loadTimeout: const Duration(seconds: 4)),
    ])))));
    await tester.enterText(find.byType(TextField).first, '08012345678');
    expect(phone.text, '08012345678');
    await tester.pump(const Duration(seconds: 4));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(
        find.text(
            "Saved numbers couldn't load. You can still enter a number manually."),
        findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    pending.complete([]);
    await tester.pumpWidget(const SizedBox());
    phone.dispose();
  });
  testWidgets(
      'cached numbers render while revalidation is pending and remain selectable on failure',
      (tester) async {
    final pending = Completer<List<Map<String, dynamic>>>();
    final phone = TextEditingController();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: SavedBeneficiaries(
                    phoneController: phone,
                    network: 'MTN',
                    serviceType: 'AIRTIME',
                    loadBeneficiaries: () => pending.future,
                    loadCachedBeneficiaries: () async => [
                          {'_id': 'one', 'phone': '08012345678', 'name': 'Home'}
                        ])))));
    await tester.pump();
    expect(find.text('Home'), findsOneWidget);
    await tester.tap(find.text('Home'));
    expect(phone.text, '08012345678');
    await tester.pump(const Duration(seconds: 4));
    await tester.pump();
    expect(find.text('Home'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    pending.complete([]);
    await tester.pumpWidget(const SizedBox());
    phone.dispose();
  });
  testWidgets('Data phone and network controls work before catalogue returns',
      (tester) async {
    final pending = Completer<Map<String, dynamic>>();
    await tester.pumpWidget(
        MaterialApp(home: DataScreen(
          purchaseIntent: DataPurchaseIntent(storage: EmptyIntentStorage(),
            accountId: () async => 'a' * 24),
          loadBeneficiaries: () async => [],
          loadPlans: (_) => pending.future)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    final field = tester.widget<TextField>(find.byType(TextField).first);
    expect(field.enabled, isTrue);
    expect(tester.widget<ChoiceChip>(find.byType(ChoiceChip).first).onSelected,
        isNotNull);
    await tester.enterText(find.byType(TextField).first, '08012345678');
    expect(field.controller!.text, '08012345678');
    pending.complete({'success': true, 'plans': []});
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('Airtime phone, amount and network stay usable while secondary APIs hang', (tester) async {
    final networks = Completer<Map<String, dynamic>>();
    final saved = Completer<List<Map<String, dynamic>>>();
    await tester.pumpWidget(MaterialApp(home: AirtimeScreen(
      purchaseIntent: AirtimePurchaseIntent(storage: EmptyIntentStorage()),
      loadNetworks: () => networks.future,
      loadBeneficiaries: () => saved.future,
    )));
    await tester.pump();await tester.pump(const Duration(milliseconds:100));
    expect(tester.widget<DropdownButtonFormField<String>>(find.byType(DropdownButtonFormField<String>)).onChanged,isNotNull);
    await tester.enterText(find.byType(TextField).first,'08012345678');
    final amount = find.byType(TextField).last;
    await tester.ensureVisible(amount);
    await tester.enterText(amount,'50');
    expect(tester.widget<TextField>(amount).controller!.text,'50');
    await tester.pump(const Duration(seconds:4));await tester.pump();
    expect(find.text("Saved numbers couldn't load. You can still enter a number manually."),findsOneWidget);
    expect(find.byType(CircularProgressIndicator),findsNothing);
    networks.complete({'success':true,'data':[]});saved.complete([]);
    await tester.pumpWidget(const SizedBox());
  });
}
