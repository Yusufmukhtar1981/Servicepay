import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/create_agent_screen.dart';
import 'package:servicepay_app/create_state_manager_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';
import 'package:servicepay_app/widgets/registration_details_fields.dart';

void main() {
  for (final screen in <String, Widget>{
    'Aggregator': const CreateAgentScreen(),
    'State Manager': const CreateStateManagerScreen(),
  }.entries) {
    testWidgets('${screen.key} reuses secure registration inputs', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
          theme: ServicePayTheme.customer(), home: screen.value));
      expect(find.byType(FullNameField), findsOneWidget);
      expect(find.byType(NigerianPhoneField), findsOneWidget);
      await tester.ensureVisible(find.byType(ConfirmPasswordField));
      expect(find.byType(PasswordField), findsOneWidget);
      expect(find.byType(ConfirmPasswordField), findsOneWidget);
      final confirmation = tester.widget<TextField>(
          find.descendant(of: find.byType(ConfirmPasswordField),
              matching: find.byType(TextField)));
      expect(confirmation.obscureText, isTrue);
      expect(confirmation.enableSuggestions, isFalse);
      expect(confirmation.autocorrect, isFalse);
      expect(tester.takeException(), isNull);
    });
  }
  test('password confirmation compares exact characters including whitespace', () {
    final password = TextEditingController(text: 'StrongPassword1! ');
    addTearDown(password.dispose);
    final validator = RegistrationValidators.matches(password, 'Mismatch');
    expect(validator('StrongPassword1!'), 'Mismatch');
    expect(validator('StrongPassword1! '), isNull);
  });
}
