import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_permissions.dart';

class AdminSessionExpiredException implements Exception {
  const AdminSessionExpiredException();
}

/// Refreshes the signed-in admin's profile before privileged UI is rendered.
class AdminSessionService {
  AdminSessionService({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.preferencesLoader = SharedPreferences.getInstance,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() preferencesLoader;

  Future<AdminAccess> refresh() async {
    final SharedPreferences prefs = await preferencesLoader();
    final String token = prefs.getString('auth_token')?.trim() ?? '';
    if (token.isEmpty) throw const AdminSessionExpiredException();

    final http.Response response = await _client.get(
      Uri.parse('$baseUrl/auth/profile'),
      headers: <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );
    if (response.statusCode == 401 || response.statusCode == 403) {
      await AdminSessionStore.clearSession();
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
    final AdminAccess access = AdminAccess.fromUser(user);
    if (user.isEmpty || status != 'ACTIVE' || access.role.isEmpty) {
      await AdminSessionStore.clearSession();
      throw const AdminSessionExpiredException();
    }

    await prefs.setString('user_role', access.role);
    await prefs.setString('user_status', status);
    await AdminSessionStore.saveAccess(access);
    return access;
  }
}
