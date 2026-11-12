import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/airtime_screen.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_phone.dart';
import 'package:servicepay_app/services/phone_network_suggestion.dart';
import 'package:servicepay_app/widgets/beneficiary_phone_entry.dart';

class _Picker extends ContactPhonePicker {
  _Picker(this.result, {this.failure, bool supported = true})
      : super(supported: supported);

  final String? result;
  final ContactPickerFailure? failure;

  @override
  Future<String?> pickPhoneNumber() async {
    if (failure != null) throw ContactPickerException(failure!);
    return result;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('prefix-based network suggestions', () {
    test('normalizes supported Nigerian formats and detects all networks', () {
      expect(normalizeDataPhone('[0803]123.4567'), '08031234567');
      expect(normalizeDataPhone('0803+1234567'), '0803+1234567');
      expect(PhoneNetworkSuggestionController.suggestNetwork('080 3123 4567'),
          'MTN');
      expect(PhoneNetworkSuggestionController.suggestNetwork('[0803]123.4567'),
          'MTN');
      expect(PhoneNetworkSuggestionController.suggestNetwork('(0802) 123-4567'),
          'Airtel');
      expect(
          PhoneNetworkSuggestionController.suggestNetwork('+234 805 123 4567'),
          'Glo');
      expect(PhoneNetworkSuggestionController.suggestNetwork('2348091234567'),
          '9mobile');
      expect(PhoneNetworkSuggestionController.suggestNetwork('08001234567'),
          isNull);
      expect(PhoneNetworkSuggestionController.suggestNetwork('0802ABC4567'),
          isNull);
      expect(PhoneNetworkSuggestionController.suggestNetwork('0803+1234567'),
          isNull);
      expect(PhoneNetworkSuggestionController.suggestNetwork('0802123456'),
          isNull);
      expect(PhoneNetworkSuggestionController.suggestNetwork('2348021234567'),
          'Airtel');
    });

    test('debounces, cancels stale work and reapplies for a new number',
        () async {
      final phone = TextEditingController();
      final applied = <String>[];
      final suggestions = PhoneNetworkSuggestionController(
        phoneController: phone,
        debounceDuration: const Duration(milliseconds: 35),
        onSuggestion: (network) async {
          applied.add(network);
        },
      );
      addTearDown(() {
        suggestions.dispose();
        phone.dispose();
      });

      phone.text = '08031234567';
      await Future<void>.delayed(const Duration(milliseconds: 12));
      phone.text = '08021234567';
      await Future<void>.delayed(const Duration(milliseconds: 45));
      expect(applied, ['Airtel']);

      phone.text = '08051234567';
      await Future<void>.delayed(const Duration(milliseconds: 45));
      expect(applied, ['Airtel', 'Glo']);
    });

    test('manual choice survives formatting but resets on canonical change',
        () async {
      final phone = TextEditingController(text: '08031234567');
      final applied = <String>[];
      final suggestions = PhoneNetworkSuggestionController(
        phoneController: phone,
        debounceDuration: const Duration(milliseconds: 25),
        onSuggestion: (network) async {
          applied.add(network);
        },
      );
      addTearDown(() {
        suggestions.dispose();
        phone.dispose();
      });

      await Future<void>.delayed(const Duration(milliseconds: 35));
      expect(applied, ['MTN']);
      suggestions.markManualSelection();
      phone.text = '+234 803 123 4567';
      await Future<void>.delayed(const Duration(milliseconds: 35));
      expect(applied, ['MTN']);
      expect(suggestions.hasManualOverride, isTrue);

      phone.text = '08021234567';
      expect(suggestions.hasManualOverride, isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 35));
      expect(applied, ['MTN', 'Airtel']);
      phone.text = '08031234567';
      await Future<void>.delayed(const Duration(milliseconds: 35));
      expect(applied, ['MTN', 'Airtel', 'MTN']);
    });

    test('empty, invalid and unknown prefixes never suggest a network', () {
      expect(PhoneNetworkSuggestionController.suggestNetwork(''), isNull);
      expect(PhoneNetworkSuggestionController.suggestNetwork('08001234567'),
          isNull);
      expect(PhoneNetworkSuggestionController.suggestNetwork('0802 123 456'),
          isNull);
    });
  });

  group('contact picker channel', () {
    const channel = MethodChannel('test.servicepay/contacts');

    test('returns selected phone or null cancellation without extra calls',
        () async {
      final calls = <String>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return '+234 803 123 4567';
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null));

      expect(
        await ContactPhonePicker(channel: channel, supported: true)
            .pickPhoneNumber(),
        '+234 803 123 4567',
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => null);
      expect(
        await ContactPhonePicker(channel: channel, supported: true)
            .pickPhoneNumber(),
        isNull,
      );
      expect(calls, ['pickPhoneNumber']);
    });

    test('maps denial, picker unavailability and unsupported platforms',
        () async {
      Future<void> expectFailure(
        String? code,
        ContactPickerFailure expected,
      ) async {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (_) async {
          if (code == null) throw MissingPluginException();
          throw PlatformException(code: code);
        });
        try {
          await ContactPhonePicker(channel: channel, supported: true)
              .pickPhoneNumber();
          fail('Expected picker failure.');
        } on ContactPickerException catch (error) {
          expect(error.failure, expected);
        }
      }

      await expectFailure(
          'permission_denied', ContactPickerFailure.permissionDenied);
      await expectFailure('unavailable', ContactPickerFailure.unavailable);
      await expectFailure(null, ContactPickerFailure.unavailable);
      await expectLater(
        ContactPhonePicker(channel: channel, supported: false)
            .pickPhoneNumber(),
        throwsA(isA<ContactPickerException>().having(
          (error) => error.failure,
          'failure',
          ContactPickerFailure.unsupported,
        )),
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });
  });

  testWidgets('contact field populates number and handles denied access',
      (tester) async {
    final phone = TextEditingController();
    final suggestions = PhoneNetworkSuggestionController(
      phoneController: phone,
      debounceDuration: const Duration(milliseconds: 20),
      onSuggestion: (_) async {},
    );
    addTearDown(() {
      phone.dispose();
      suggestions.dispose();
    });
    final messages = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: BeneficiaryPhoneEntry(
          phoneController: phone,
          suggestions: suggestions,
          selectedNetwork: 'MTN',
          decoration: const InputDecoration(labelText: 'Phone'),
          enabled: true,
          picker: _Picker('+234 802 123 4567'),
          onMessage: messages.add,
        ),
      ),
    ));
    await tester.tap(find.text('Select Contact'));
    await tester.pump();
    expect(phone.text, '08021234567');
    await tester.pump(const Duration(milliseconds: 500));

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: BeneficiaryPhoneEntry(
          phoneController: phone,
          suggestions: suggestions,
          selectedNetwork: 'MTN',
          decoration: const InputDecoration(labelText: 'Phone'),
          enabled: true,
          picker: _Picker(null, failure: ContactPickerFailure.permissionDenied),
          onMessage: messages.add,
        ),
      ),
    ));
    await tester.tap(find.text('Select Contact'));
    await tester.pump();
    expect(messages.single, contains('enter the number manually'));
    await tester.pump(const Duration(milliseconds: 500));
  });

  testWidgets('Airtime and Data contact selection feeds automatic suggestion',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final picker = _Picker('+234 802 123 4567');

    await tester.pumpWidget(MaterialApp(
      home: AirtimeScreen(
        contactPicker: picker,
        loadNetworks: () async => {
          'success': true,
          'data': [
            {'displayName': 'MTN', 'networkId': 1},
            {'displayName': 'Airtel', 'networkId': 2},
            {'displayName': 'Glo', 'networkId': 3},
            {'displayName': '9mobile', 'networkId': 4},
          ],
        },
        loadBeneficiaries: () async => [],
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select Contact'));
    await tester.pump();
    expect(
        tester.widget<TextField>(find.byType(TextField).first).controller!.text,
        '08021234567');
    await tester.pump(const Duration(milliseconds: 500));
    final airtimeNetwork = tester.widget<DropdownButtonFormField<String>>(
        find.byType(DropdownButtonFormField<String>));
    expect(airtimeNetwork.initialValue, 'Airtel');
    await tester.pumpWidget(const SizedBox());

    final loadedNetworks = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: DataScreen(
        contactPicker: picker,
        loadPlans: (network) async {
          loadedNetworks.add(network);
          return {'success': true, 'plans': []};
        },
        loadBeneficiaries: () async => [],
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select Contact'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(loadedNetworks, containsAllInOrder(['MTN', 'Airtel']));
    expect(find.text('Airtel'), findsWidgets);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('unsupported platform keeps manual entry available',
      (tester) async {
    final phone = TextEditingController();
    final suggestions = PhoneNetworkSuggestionController(
      phoneController: phone,
      debounceDuration: const Duration(milliseconds: 300),
      onSuggestion: (_) async {},
    );
    addTearDown(() {
      phone.dispose();
      suggestions.dispose();
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: BeneficiaryPhoneEntry(
          phoneController: phone,
          suggestions: suggestions,
          selectedNetwork: 'MTN',
          decoration: const InputDecoration(labelText: 'Phone'),
          enabled: true,
          picker: _Picker(null, supported: false),
        ),
      ),
    ));
    expect(find.text('Select Contact'), findsNothing);
    expect(find.textContaining('Enter the number manually'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '08031234567');
    await tester.pump();
    expect(phone.text, '08031234567');
    expect(find.text('Checking number prefix…'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 301));
    expect(find.textContaining('Prefix-based suggestion: MTN'), findsOneWidget);
  });

  testWidgets('tapping the selected Data network cancels pending suggestion',
      (tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final loadedNetworks = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: DataScreen(
        loadPlans: (network) async {
          loadedNetworks.add(network);
          return {'success': true, 'plans': []};
        },
        loadBeneficiaries: () async => [],
      ),
    ));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '08021234567');
    await tester.pump(const Duration(milliseconds: 80));
    await tester.tap(find.widgetWithText(ChoiceChip, 'MTN'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(loadedNetworks, ['MTN']);
    expect(find.text('Network selected manually: MTN.'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('320px phone entry keeps contact action and suggestion visible',
      (tester) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final phone = TextEditingController();
    final suggestions = PhoneNetworkSuggestionController(
      phoneController: phone,
      debounceDuration: const Duration(milliseconds: 25),
      onSuggestion: (_) async {},
    );
    addTearDown(() {
      phone.dispose();
      suggestions.dispose();
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: BeneficiaryPhoneEntry(
            phoneController: phone,
            suggestions: suggestions,
            selectedNetwork: 'MTN',
            decoration: const InputDecoration(labelText: 'Phone'),
            enabled: true,
            picker: _Picker(null),
          ),
        ),
      ),
    ));
    await tester.enterText(find.byType(TextField), '08031234567');
    await tester.pump(const Duration(milliseconds: 30));
    expect(find.text('Select Contact'), findsOneWidget);
    expect(find.textContaining('Prefix-based suggestion: MTN'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
