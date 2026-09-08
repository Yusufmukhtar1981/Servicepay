import 'package:flutter/material.dart';

import 'login_screen.dart';
import 'main_navigation.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
          seedColor: const Color(0xFF007C78),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF3F7F6),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF73D3BF),
          brightness: Brightness.dark,
          surface: const Color(0xFF102D3A),
        ),
        scaffoldBackgroundColor: const Color(0xFF0B2029),
      ),
      themeMode: ThemeMode.system,
      home: const AdminStartupSessionGate(),
    );
  }
}

class AdminStartupSessionGate extends StatelessWidget {
  const AdminStartupSessionGate({super.key});

  Future<bool> _hasSession() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    return (preferences.getString('auth_token') ?? '').trim().isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _hasSession(),
      builder: (BuildContext context, AsyncSnapshot<bool> snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return snapshot.data == true
            ? const AdminMainNavigation()
            : const AdminLoginScreen();
      },
    );
  }
}
