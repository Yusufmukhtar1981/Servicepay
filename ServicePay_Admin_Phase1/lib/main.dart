import 'package:flutter/material.dart';
import 'admin_dashboard_screen.dart';

void main() {
  runApp(const ServicePayAdminApp());
}

class ServicePayAdminApp extends StatelessWidget {
  const ServicePayAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'ServicePay Admin',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF087F5B),
        ),
        useMaterial3: true,
      ),
      home: AdminDashboardScreen(),
    );
  }
}
