import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/referral_attribution_service.dart';
import 'package:servicepay_app/secure_registration_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/widgets/registration_details_fields.dart';
import 'package:shared_preferences/shared_preferences.dart';

const orderedKeys = [
  'reg-fullName',
  'reg-phone',
  'reg-email',
  'reg-state',
  'reg-lga',
  'reg-password',
  'reg-confirmPassword',
  'reg-pin',
  'reg-confirmPin',
  'reg-identity',
];

Finder byKeyPrefix(String k) => find.byWidgetPredicate((w) {
      final key = w.key;
      if (key is ValueKey<String>) {
        return key.value == k || (k == 'reg-lga' && key.value.startsWith('reg-lga-'));
      }
      return false;
    });

void main() {
  late List<http.Request> requests;

  Future<void> pump(WidgetTester tester, {int status = 201}) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(800, 6000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    requests = [];
    final client = MockClient((req) async {
      requests.add(req);
      if (req.url.path.endsWith('/auth/register')) {
        return http.Response(jsonEncode({'success': status < 300}), status);
      }
      return http.Response(jsonEncode({'success': false}), 404);
    });
    await tester.pumpWidget(MaterialApp(
      theme: ServicePayTheme.customer(),
      home: SecureRegistrationScreen(
        client: client,
        referralService: ReferralAttributionService(client: client),
      ),
    ));
    await tester.pumpAndSettle();
  }

  Future<void> selectDropdown(WidgetTester t, String key, String item) async {
    await t.tap(byKeyPrefix(key));
    await t.pumpAndSettle();
    await t.tap(find.text(item).last);
    await t.pumpAndSettle();
  }

  Future<void> fillValid(WidgetTester t,
      {String phone = '+234 803 123 4567'}) async {
    await t.enterText(byKeyPrefix('reg-fullName'), 'Ada Okafor');
    await t.enterText(byKeyPrefix('reg-phone'), phone);
    await t.enterText(byKeyPrefix('reg-email'), 'Ada@Example.com');
    await selectDropdown(t, 'reg-state', 'Lagos');
    await selectDropdown(t, 'reg-lga', 'Ikeja');
    await t.enterText(byKeyPrefix('reg-password'), 'StrongPass1!');
    await t.enterText(byKeyPrefix('reg-confirmPassword'), 'StrongPass1!');
    await t.enterText(byKeyPrefix('reg-pin'), '2580');
    await t.enterText(byKeyPrefix('reg-confirmPin'), '2580');
    await t.enterText(byKeyPrefix('reg-identity'), '12345678901');
    final state = t.state(find.byType(SecureRegistrationScreen)) as dynamic;
    state.dobController.text = '1990-01-01';
    await selectDropdown(t, 'reg-gender', 'Female');
    await t.enterText(byKeyPrefix('reg-address'), '1 Test Street');
    await t.tap(byKeyPrefix('reg-terms'));
    await t.tap(byKeyPrefix('reg-kyc'));
    await t.pumpAndSettle();
  }

  testWidgets('ten fields render on one page in exact order, no pagination',
      (t) async {
    await pump(t);
    expect(find.byType(PageView), findsNothing);
    expect(find.text('Continue'), findsNothing);
    double lastY = -1;
    for (final k in orderedKeys) {
      final f = byKeyPrefix(k);
      expect(f, findsOneWidget, reason: k);
      final y = t.getTopLeft(f).dy;
      expect(y, greaterThan(lastY), reason: '$k out of order');
      lastY = y;
    }
    // Retained backend fields sit below the ten.
    expect(t.getTopLeft(byKeyPrefix('reg-dob')).dy, greaterThan(lastY));
    expect(find.byKey(const Key('reg-submit')), findsOneWidget);
  });

  testWidgets('changing state resets LGA', (t) async {
    await pump(t);
    await selectDropdown(t, 'reg-state', 'Lagos');
    await selectDropdown(t, 'reg-lga', 'Ikeja');
    expect(find.text('Ikeja'), findsOneWidget);
    await selectDropdown(t, 'reg-state', 'FCT');
    expect(find.text('Ikeja'), findsNothing);
    expect(find.text('Select Local Government'), findsOneWidget);
  });

  testWidgets('secrets obscured, toggle, no autocorrect or suggestions',
      (t) async {
    await pump(t);
    for (final k in ['password', 'confirmPassword', 'pin', 'confirmPin', 'identity']) {
      EditableText edit() => t.widget<EditableText>(find.descendant(
          of: byKeyPrefix('reg-$k'), matching: find.byType(EditableText)));
      expect(edit().obscureText, isTrue, reason: k);
      expect(edit().autocorrect, isFalse, reason: k);
      expect(edit().enableSuggestions, isFalse, reason: k);
      await t.tap(find.byKey(Key('toggle-$k')));
      await t.pump();
      expect(edit().obscureText, isFalse, reason: k);
      await t.tap(find.byKey(Key('toggle-$k')));
      await t.pump();
      expect(edit().obscureText, isTrue, reason: k);
    }
  });

  testWidgets('validation blocks submission and shows inline errors',
      (t) async {
    await pump(t);
    await t.enterText(byKeyPrefix('reg-fullName'), 'Ada');
    await t.enterText(byKeyPrefix('reg-phone'), '0801234');
    await t.enterText(byKeyPrefix('reg-email'), 'bad@');
    await t.enterText(byKeyPrefix('reg-password'), 'weak');
    await t.enterText(byKeyPrefix('reg-confirmPassword'), 'other');
    await t.enterText(byKeyPrefix('reg-pin'), '1234');
    await t.enterText(byKeyPrefix('reg-confirmPin'), '9999');
    await t.enterText(byKeyPrefix('reg-identity'), '123');
    await t.tap(find.byKey(const Key('reg-submit')));
    await t.pumpAndSettle();
    expect(find.text('Enter your first and last name.'), findsOneWidget);
    expect(find.textContaining('valid Nigerian number'), findsOneWidget);
    expect(find.text('Enter a valid email address.'), findsOneWidget);
    expect(find.text('Passwords do not match.'), findsOneWidget);
    expect(find.text('Transaction PINs do not match.'), findsOneWidget);
    expect(find.text('Enter a valid 11-digit NIN.'), findsOneWidget);
    expect(requests.where((r) => r.url.path.endsWith('/auth/register')),
        isEmpty);
  });

  test('phone normalisation', () {
    expect(normalizeNigerianPhone('08031234567'), '08031234567');
    expect(normalizeNigerianPhone('+2348031234567'), '08031234567');
    expect(normalizeNigerianPhone('2348031234567'), '08031234567');
    expect(normalizeNigerianPhone('8031234567'), isNull);
    expect(normalizeNigerianPhone('05031234567'), isNull);
    expect(normalizeNigerianPhone('+23480312345'), isNull);
  });

  test('payload defaults to NIN and BVN sends bvn only', () {
    Map<String, dynamic> build([RegistrationIdentityType? type]) =>
        buildRegistrationPayload(
          fullName: 'Ada Okafor', phone: '08012345678', email: 'a@b.ng',
          password: 'StrongPass1!', transactionPin: '2580',
          confirmTransactionPin: '2580', dateOfBirth: '1990-01-01',
          gender: 'FEMALE', residentialAddress: '1 Test Street',
          state: 'Lagos', lga: 'Ikeja', nin: '12345678901',
          identityType: type ?? RegistrationIdentityType.nin,
        );
    final nin = build();
    expect(nin['nin'], '12345678901');
    expect(nin['identityType'], 'NIN');
    expect(nin.containsKey('bvn'), isFalse);
    final bvn = build(RegistrationIdentityType.bvn);
    expect(bvn['bvn'], '12345678901');
    expect(bvn['identityType'], 'BVN');
    expect(bvn.containsKey('nin'), isFalse);
  });

  for (final invalid in <String, String>{
    'reg-confirmPassword': 'DifferentPass1!',
    'reg-email': 'not-an-email',
    'reg-confirmPin': '2581',
  }.entries) {
    testWidgets('phone-height submit rejects offscreen ${invalid.key}', (t) async {
      await pump(t);
      await fillValid(t);
      await t.enterText(byKeyPrefix(invalid.key), invalid.value);
      FocusManager.instance.primaryFocus?.unfocus();
      t.view.physicalSize = const Size(390, 844);
      await t.pumpAndSettle();
      final pageScroll = find.descendant(
          of: find.byKey(const Key('registration-scroll')),
          matching: find.byType(Scrollable)).first;
      await t.scrollUntilVisible(find.byKey(const Key('reg-submit')), 400,
          scrollable: pageScroll);
      await t.tap(find.byKey(const Key('reg-submit')));
      await t.pumpAndSettle();
      expect(requests.where((r) => r.url.path.endsWith('/auth/register')), isEmpty);
      expect(find.text('Please correct the highlighted fields.'), findsOneWidget);
      expect(find.byKey(const Key('reg-confirmPassword')), findsOneWidget);
      expect(t.takeException(), isNull);
    });
  }

  testWidgets('valid NIN submission posts normalised payload', (t) async {
    await pump(t);
    await fillValid(t);
    await t.tap(find.byKey(const Key('reg-submit')));
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    final reg = requests.singleWhere((r) => r.url.path.endsWith('/auth/register'));
    final body = jsonDecode(reg.body) as Map<String, dynamic>;
    expect(body['phone'], '08031234567');
    expect(body['email'], 'ada@example.com');
    expect(body['state'], 'Lagos');
    expect(body['lga'], 'Ikeja');
    expect(body['nin'], '12345678901');
    expect(body['identityType'], 'NIN');
    expect(body['transactionPin'], '2580');
    expect(find.text('Account Created'), findsOneWidget);
    for (final key in [
      'reg-password', 'reg-confirmPassword', 'reg-pin', 'reg-confirmPin',
      'reg-identity',
    ]) {
      final field = t.widget<TextField>(find.descendant(
        of: byKeyPrefix(key), matching: find.byType(TextField)));
      expect(field.controller!.text, isEmpty);
    }
    await t.tap(find.text('Continue'));
    await t.pump(const Duration(milliseconds: 400));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  testWidgets('BVN selection submits bvn not nin', (t) async {
    await pump(t);
    await t.tap(find.text('BVN').first);
    await t.pumpAndSettle();
    await fillValid(t, phone: '07061234567');
    await t.tap(find.byKey(const Key('reg-submit')));
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    final reg = requests.singleWhere((r) => r.url.path.endsWith('/auth/register'));
    final body = jsonDecode(reg.body) as Map<String, dynamic>;
    expect(body['bvn'], '12345678901');
    expect(body['identityType'], 'BVN');
    expect(body.containsKey('nin'), isFalse);
  });

  testWidgets('shared grouped fields render for manager forms', (t) async {
    final c = List.generate(5, (_) => TextEditingController());
    await t.pumpWidget(MaterialApp(
      theme: ServicePayTheme.customer(),
      home: Scaffold(
        body: Form(
          child: RegistrationDetailsFields(
            fullNameController: c[0],
            phoneController: c[1],
            emailController: c[2],
            passwordController: c[3],
            confirmPasswordController: c[4],
          ),
        ),
      ),
    ));
    for (final l in ['Full Name', 'Phone Number', 'Email', 'Password',
        'Confirm Password']) {
      expect(find.text(l), findsOneWidget);
    }
    expect(find.text('PIN (4 digits)'), findsNothing);
  });
}
