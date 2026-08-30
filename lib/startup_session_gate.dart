import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'login_routing.dart';
import 'login_screen.dart';

enum StartupSessionState {
  checking,
  loggedOut,
  authenticated,
  recoverableError,
}

class StartupSessionGate extends StatefulWidget {
  const StartupSessionGate({
    super.key,
    this.client,
    this.preferencesLoader = SharedPreferences.getInstance,
    this.requestTimeout = const Duration(seconds: 10),
  });

  static const String baseUrl = 'https://api.servicepay.ng/api';

  final http.Client? client;
  final Future<SharedPreferences> Function() preferencesLoader;
  final Duration requestTimeout;

  @override
  State<StartupSessionGate> createState() => _StartupSessionGateState();
}

class _StartupSessionGateState extends State<StartupSessionGate> {
  static const Set<String> _adminRoles = <String>{
    'ADMIN',
    'SUPER_ADMIN',
    'HEAD_OFFICE',
    'HEAD_OFFICE_ADMIN',
  };
  static const List<String> _sessionKeys = <String>[
    'auth_token',
    'token',
    'access_token',
    'accessToken',
    'jwt_token',
    'jwt',
    'user_id',
    'user_name',
    'user_phone',
    'user_email',
    'user_role',
    'user_status',
    'wallet_balance',
  ];

  late final http.Client _client;
  late final bool _ownsClient;
  StartupSessionState _state = StartupSessionState.checking;
  Widget? _authenticatedHome;
  bool _requestInFlight = false;
  int _requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    unawaited(_restoreSession());
  }

  @override
  void dispose() {
    _requestGeneration += 1;
    if (_ownsClient) _client.close();
    super.dispose();
  }

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  Map<String, dynamic> _profileFrom(Map<String, dynamic> response) {
    final Map<String, dynamic> direct = _asMap(response['user']);
    if (direct.isNotEmpty) return direct;
    final Map<String, dynamic> data = _asMap(response['data']);
    final Map<String, dynamic> nested = _asMap(data['user']);
    return nested.isNotEmpty ? nested : data;
  }

  Future<void> _clearLocalSession(SharedPreferences preferences) async {
    for (final String key in _sessionKeys) {
      await preferences.remove(key);
    }
  }

  void _showLoggedOut() {
    if (!mounted) return;
    setState(() {
      _authenticatedHome = null;
      _state = StartupSessionState.loggedOut;
    });
  }

  void _showRecoverableError() {
    if (!mounted) return;
    setState(() {
      _authenticatedHome = null;
      _state = StartupSessionState.recoverableError;
    });
  }

  Future<void> _restoreSession() async {
    if (_requestInFlight) return;
    _requestInFlight = true;
    final int generation = ++_requestGeneration;

    try {
      final SharedPreferences preferences =
          await widget.preferencesLoader().timeout(widget.requestTimeout);
      final String token = preferences.getString('auth_token')?.trim() ?? '';
      if (token.isEmpty) {
        _showLoggedOut();
        return;
      }

      final http.Response response = await _client.get(
        Uri.parse('${StartupSessionGate.baseUrl}/auth/profile'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(widget.requestTimeout);

      if (generation != _requestGeneration || !mounted) return;
      if (response.statusCode == 401 || response.statusCode == 403) {
        await _clearLocalSession(preferences);
        _showLoggedOut();
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        _showRecoverableError();
        return;
      }

      final dynamic decoded = jsonDecode(response.body);
      final Map<String, dynamic> result = _asMap(decoded);
      final Map<String, dynamic> profile = _profileFrom(result);
      if (profile.isEmpty) {
        _showRecoverableError();
        return;
      }

      final String role = loginRoleFromResponse(result, profile);
      final String status =
          profile['status']?.toString().trim().toUpperCase() ?? 'ACTIVE';
      if (_adminRoles.contains(role) || status != 'ACTIVE') {
        await _clearLocalSession(preferences);
        _showLoggedOut();
        return;
      }

      await preferences.setString('user_role', role);
      await preferences.setString('user_status', status);
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _authenticatedHome = authenticatedHomeForRole(role);
        _state = StartupSessionState.authenticated;
      });
    } on TimeoutException {
      _showRecoverableError();
    } on http.ClientException {
      _showRecoverableError();
    } on FormatException {
      _showRecoverableError();
    } catch (error) {
      debugPrint('Session restoration failed: $error');
      _showRecoverableError();
    } finally {
      _requestInFlight = false;
    }
  }

  Future<void> _retry() async {
    if (_requestInFlight) return;
    setState(() {
      _state = StartupSessionState.checking;
    });
    await _restoreSession();
  }

  Future<void> _signOut() async {
    _requestGeneration += 1;
    try {
      final SharedPreferences preferences =
          await widget.preferencesLoader().timeout(widget.requestTimeout);
      await _clearLocalSession(preferences);
    } catch (error) {
      debugPrint('Local session cleanup failed: $error');
    }
    _showLoggedOut();
  }

  @override
  Widget build(BuildContext context) {
    switch (_state) {
      case StartupSessionState.loggedOut:
        return const LoginScreen();
      case StartupSessionState.authenticated:
        return _authenticatedHome ?? const LoginScreen();
      case StartupSessionState.recoverableError:
        return _StartupRecoveryScreen(
          onRetry: _retry,
          onSignOut: _signOut,
        );
      case StartupSessionState.checking:
        return const _StartupSessionLoadingScreen();
    }
  }
}

class _StartupSessionLoadingScreen extends StatelessWidget {
  const _StartupSessionLoadingScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      body: const Center(
        child: SizedBox(
          width: 32,
          height: 32,
          child: CircularProgressIndicator(
            strokeWidth: 3,
            color: Color(0xFF0F766E),
            semanticsLabel: 'Checking your saved ServicePay session',
          ),
        ),
      ),
    );
  }
}

class _StartupRecoveryScreen extends StatelessWidget {
  const _StartupRecoveryScreen({
    required this.onRetry,
    required this.onSignOut,
  });

  final Future<void> Function() onRetry;
  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Icon(
                    Icons.cloud_off_outlined,
                    size: 48,
                    color: Color(0xFF0F766E),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    "We couldn't prepare your account right now.",
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Check your connection and try again. Your saved session has not been changed.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFF52605D)),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: const Key('startup-retry'),
                      onPressed: onRetry,
                      child: const Text('Retry'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      key: const Key('startup-sign-out'),
                      onPressed: onSignOut,
                      child: const Text('Sign Out'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
