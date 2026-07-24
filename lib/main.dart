import 'package:flutter/material.dart';

import 'login_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ServicePayApp());
}

class ServicePayApp extends StatelessWidget {
  const ServicePayApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Servicepay',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF159447),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF7F9F8),
      ),
      home: const LoginScreen(),
    );
  }
}