import 'package:flutter/material.dart';

import 'login_screen.dart';

void main() {
  runApp(const ServicepayAdminApp());
}

class ServicepayAdminApp extends StatelessWidget {
  const ServicepayAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Servicepay Admin',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.green,
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
      ),
      home: const AdminLoginScreen(),
    );
  }
}