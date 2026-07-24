import 'package:flutter/material.dart';

import '../login_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ServicePayAdminApp());
}

class ServicePayAdminApp extends StatelessWidget {
  const ServicePayAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ServicePay Admin',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.green,
        ),
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}