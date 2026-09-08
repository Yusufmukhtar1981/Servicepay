import 'package:flutter/material.dart';

import 'secure_registration_screen.dart';

/// Compatibility wrapper.
/// Existing navigation can continue opening RegisterScreen.
class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SecureRegistrationScreen();
  }
}
