import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_control_center_screen.dart';
import 'admin_phone_financing_screen.dart';
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
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.green),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
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
      home: const AdminLoginScreen(),
      routes: <String, WidgetBuilder>{
        '/phone-financing': (_) => const _PhoneFinancingRouteGate(),
        '/control-center/audit-logs': (_) =>
            const _ControlCenterRouteGate(moduleId: 'audit-logs'),
        '/control-center/security-events': (_) =>
            const _ControlCenterRouteGate(moduleId: 'security-events'),
        '/control-center/access-logs': (_) =>
            const _ControlCenterRouteGate(moduleId: 'access-logs'),
        '/control-center/data-exports': (_) =>
            const _ControlCenterRouteGate(moduleId: 'data-exports'),
        '/control-center/backups': (_) =>
            const _ControlCenterRouteGate(moduleId: 'backups'),
        '/control-center/privacy-controls': (_) =>
            const _ControlCenterRouteGate(moduleId: 'privacy-controls'),
        '/control-center/executive-dashboard': (_) =>
            const _ControlCenterRouteGate(moduleId: 'executive-dashboard'),
        '/control-center/service-performance': (_) =>
            const _ControlCenterRouteGate(moduleId: 'service-performance'),
        '/control-center/transaction-analytics': (_) =>
            const _ControlCenterRouteGate(moduleId: 'transaction-analytics'),
        '/control-center/customer-analytics': (_) =>
            const _ControlCenterRouteGate(moduleId: 'customer-analytics'),
      },
    );
  }
}

class _PhoneFinancingRouteGate extends StatefulWidget {
  const _PhoneFinancingRouteGate();

  @override
  State<_PhoneFinancingRouteGate> createState() =>
      _PhoneFinancingRouteGateState();
}

class _PhoneFinancingRouteGateState extends State<_PhoneFinancingRouteGate> {
  late final Future<bool> _isAuthorized = _checkAuthorization();

  Future<bool> _checkAuthorization() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final String token = preferences.getString('auth_token')?.trim() ?? '';
    final String role =
        preferences.getString('user_role')?.trim().toUpperCase() ?? '';

    return token.isNotEmpty && role == 'HEAD_OFFICE';
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _isAuthorized,
      builder: (BuildContext context, AsyncSnapshot<bool> snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshot.data == true) {
          return const AdminPhoneFinancingScreen();
        }

        return const AdminLoginScreen();
      },
    );
  }
}

class _ControlCenterRouteGate extends StatefulWidget {
  const _ControlCenterRouteGate({required this.moduleId});

  final String moduleId;

  @override
  State<_ControlCenterRouteGate> createState() =>
      _ControlCenterRouteGateState();
}

class _ControlCenterRouteGateState extends State<_ControlCenterRouteGate> {
  late final Future<String> _access = _checkAccess();

  Future<String> _checkAccess() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final String token = preferences.getString('auth_token')?.trim() ?? '';
    final String role =
        preferences.getString('user_role')?.trim().toUpperCase() ?? '';
    if (token.isEmpty) return 'UNAUTHENTICATED';
    if (role == 'HEAD_OFFICE') return 'AUTHORIZED';
    return 'FORBIDDEN';
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: _access,
      builder: (BuildContext context, AsyncSnapshot<String> snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.data == 'AUTHORIZED') {
          return AdminControlCenterScreen(initialModuleId: widget.moduleId);
        }
        if (snapshot.data == 'UNAUTHENTICATED') {
          return const AdminLoginScreen();
        }
        return Scaffold(
          appBar: AppBar(title: const Text('Access denied')),
          body: const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                '403 — This Control Center workspace requires a HEAD_OFFICE account.',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        );
      },
    );
  }
}
