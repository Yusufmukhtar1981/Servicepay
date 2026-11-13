import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/phone_network_suggestion.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('flutter_native_contact_picker');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('native package selects the specific number, not the first contact number',
      () async {
    final calls = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      return {
        'phoneNumbers': ['08031234567', '+234 802 123 4567'],
        'selectedPhoneNumber': '+234 802 123 4567',
      };
    });
    expect(await ContactPhonePicker(supported: true).pickPhoneNumber(),
        '08021234567');
    expect(calls, ['selectPhoneNumber']);
  });

  test('cancelling the native package picker leaves beneficiary untouched',
      () async {
    messenger.setMockMethodCallHandler(channel, (_) async => null);
    expect(
        await ContactPhonePicker(supported: true).pickPhoneNumber(), isNull);
  });

  test('selected contact with multiple numbers requires an explicit choice',
      () async {
    messenger.setMockMethodCallHandler(channel, (_) async => {
          'phoneNumbers': ['08031234567', '+234 802 123 4567'],
        });
    final picker = ContactPhonePicker(supported: true);
    expect(await picker.pickPhoneNumber(), isNull);
    expect(
      await picker.pickPhoneNumber(chooseNumber: (numbers) async {
        expect(numbers, ['08031234567', '08021234567']);
        return numbers.last;
      }),
      '08021234567',
    );
  });

  test('native package denial remains an explicit safe manual-entry failure',
      () async {
    messenger.setMockMethodCallHandler(channel,
        (_) async => throw PlatformException(code: 'permission_denied'));
    await expectLater(
      ContactPhonePicker(supported: true).pickPhoneNumber(),
      throwsA(isA<ContactPickerException>().having(
          (error) => error.failure,
          'failure',
          ContactPickerFailure.permissionDenied)),
    );
  });
}
