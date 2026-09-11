import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

abstract class AdminOrganizationsApiClient {
  Future<Map<String, dynamic>> summary();
  Future<Map<String, dynamic>> list({String? status, String? search});
  Future<Map<String, dynamic>> details(String id);
  Future<Map<String, dynamic>> wallet(String id);
  Future<Map<String, dynamic>> members(String id);
  Future<Map<String, dynamic>> payments(String id);
  Future<Map<String, dynamic>> audit(String id);
  Future<void> updateStatus(String id, String status);
  Future<void> updateWalletFreeze(String id, bool frozen);
}

class AdminOrganizationsApi implements AdminOrganizationsApiClient {
  AdminOrganizationsApi({
    http.Client? client,
    String? baseUrl,
    this.authToken,
  })  : baseUrl = baseUrl ??
            const String.fromEnvironment('SERVICEPAY_API_BASE_URL',
                defaultValue: 'https://api.servicepay.ng/api'),
        _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final String? authToken;

  Future<Map<String, String>> _headers() async {
    final SharedPreferences? prefs =
        authToken == null ? await SharedPreferences.getInstance() : null;
    final String token = authToken ?? prefs?.getString('auth_token') ?? '';
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (token.isNotEmpty)
        'Authorization': token.startsWith('Bearer ') ? token : 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
  }) async {
    final Uri uri = Uri.parse('$baseUrl/admin/organizations$path')
        .replace(queryParameters: query?.isEmpty ?? true ? null : query);
    final Map<String, String> headers = await _headers();
    late http.Response response;
    if (method == 'PATCH') {
      response =
          await _client.patch(uri, headers: headers, body: jsonEncode(body));
    } else {
      response = await _client.get(uri, headers: headers);
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = <String, dynamic>{};
    }
    final Map<String, dynamic> result = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AdminOrganizationsApiException(
        result['message']?.toString() ?? 'Organization request failed.',
        response.statusCode,
      );
    }
    return result;
  }

  @override
  Future<Map<String, dynamic>> summary() => _request('GET', '/summary');

  @override
  Future<Map<String, dynamic>> list({String? status, String? search}) =>
      _request('GET', '', query: <String, String>{
        if (status != null && status.isNotEmpty) 'status': status,
        if (search != null && search.isNotEmpty) 'search': search,
      });

  @override
  Future<Map<String, dynamic>> details(String id) => _request('GET', '/$id');

  @override
  Future<Map<String, dynamic>> wallet(String id) =>
      _request('GET', '/$id/wallet');

  @override
  Future<Map<String, dynamic>> members(String id) =>
      _request('GET', '/$id/members');

  @override
  Future<Map<String, dynamic>> payments(String id) =>
      _request('GET', '/$id/payments');

  @override
  Future<Map<String, dynamic>> audit(String id) =>
      _request('GET', '/$id/audit');

  @override
  Future<void> updateStatus(String id, String status) async {
    await _request('PATCH', '/$id/status',
        body: <String, dynamic>{'status': status});
  }

  @override
  Future<void> updateWalletFreeze(String id, bool frozen) async {
    await _request('PATCH', '/$id/wallet', body: <String, dynamic>{
      'status': frozen ? 'FROZEN' : 'ACTIVE',
      'frozen': frozen,
    });
  }
}

class AdminOrganizationsApiException implements Exception {
  const AdminOrganizationsApiException(this.message, this.statusCode);
  final String message;
  final int statusCode;
  @override
  String toString() => message;
}
