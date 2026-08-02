import 'package:flutter/material.dart';

import 'login_screen.dart';
import 'reset_password_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  runApp(
    const ServicePayApp(),
  );
}

class ServicePayApp extends StatelessWidget {
  const ServicePayApp({
    super.key,
  });

  Widget getInitialScreen() {
    final Uri currentUri = Uri.base;

    final String path = currentUri.path.toLowerCase();

    final String resetMode =
        currentUri.queryParameters['reset-password']?.toLowerCase() ?? '';

    final String mode = currentUri.queryParameters['mode']?.toLowerCase() ?? '';

    final String token = currentUri.queryParameters['token']?.trim() ?? '';

    final bool isResetPasswordLink = path == '/reset-password' ||
        path.endsWith('/reset-password/') ||
        resetMode == 'true' ||
        mode == 'reset-password';

    if (isResetPasswordLink) {
      return ResetPasswordScreen(
        token: token,
      );
    }

    return const LoginScreen();
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return MaterialApp(
      title: 'Servicepay',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(
            0xFF159447,
          ),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF7F9F8),
      ),
      home: getInitialScreen(),
    );
  }
}
