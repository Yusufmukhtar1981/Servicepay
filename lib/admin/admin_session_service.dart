import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_permissions.dart';
import '../services/session_store.dart';

class AdminSessionExpiredException implements Exception {
  const AdminSessionExpiredException();
}

/// Refreshes the signed-in admin's profile before privileged UI is rendered.
class AdminSessionService {
  AdminSessionService({
    http.Client? client,
    this.baseUrl = const String.fromEnvironment(
      'SERVICEPAY_API_BASE_URL',
      defaultValue: 'https://api.servicepay.ng/api',
    ),
    this.preferencesLoader = SharedPreferences.getInstance,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() preferencesLoader;

  Future<AdminAccess> refresh() async {
    final SharedPreferences prefs = await preferencesLoader();
    final String token = (await SessionStore.readToken())?.trim() ?? '';
    if (token.isEmpty) throw const AdminSessionExpiredException();

    final http.Response response = await _client.get(
      Uri.parse('$baseUrl/auth/profile'),
      headers: <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );
    if (response.statusCode == 401 || response.statusCode == 403) {
      await _clearSession();
      throw const AdminSessionExpiredException();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Unable to refresh your admin session.');
    }

    final dynamic decoded = jsonDecode(response.body);
    final Map<String, dynamic> result = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    final Map<String, dynamic> data = result['data'] is Map
        ? Map<String, dynamic>.from(result['data'] as Map)
        : <String, dynamic>{};
    final Map<String, dynamic> user = result['user'] is Map
        ? Map<String, dynamic>.from(result['user'] as Map)
        : data['user'] is Map
            ? Map<String, dynamic>.from(data['user'] as Map)
            : data;
    final String status = user['status']?.toString().toUpperCase() ?? 'ACTIVE';
    AdminAccess access = AdminAccess.fromUser(user);
    if (user.isEmpty || status != 'ACTIVE' || access.role.isEmpty) {
      await _clearSession();
      throw const AdminSessionExpiredException();
    }

    // Older production profile projections omit role scope. Do not infer
    // GLOBAL from a job title or from missing branch information: the existing
    // workspace API independently enforces GLOBAL scope and capability.
    final String title = assignedStaffRoleName(user);
    final bool workspaceCandidate = access.role == 'STAFF' &&
        user['isStaff'] == true &&
        ((title == 'OPERATIONS_MANAGER' &&
                access.permissions.contains('operations.workspace.view')) ||
            (title == 'CUSTOMER_SUPPORT' &&
                access.permissions.contains('support.workspace.view')));
    if (workspaceCandidate &&
        !access.isGlobalOperationsStaff &&
        !access.isGlobalCustomerSupportStaff) {
      final http.Response authorization = await _client.get(
        Uri.parse('$baseUrl/admin/staff-workspace/overview'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 15));
      if (authorization.statusCode == 401) {
        await _clearSession();
        throw const AdminSessionExpiredException();
      }
      final dynamic evidence = authorization.statusCode == 200
          ? jsonDecode(authorization.body)
          : null;
      if (evidence is! Map || evidence['success'] != true) {
        throw Exception('Your operational workspace could not be authorized.');
      }
      user['accessScope'] = <String, dynamic>{'type': 'GLOBAL'};
      access = AdminAccess.fromUser(user);
    }

    await prefs.setString('user_role', access.role);
    await prefs.setString('user_status', status);
    await AdminSessionStore.saveAccess(access);
    return access;
  }

  Future<void> _clearSession() async {
    await SessionStore.clear();
    await AdminSessionStore.clearSession();
  }
}
