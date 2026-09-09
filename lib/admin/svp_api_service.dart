import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class SvpApiService {
  SvpApiService(
      {http.Client? client,
      this.baseUrl = const String.fromEnvironment(
        'SERVICEPAY_API_BASE_URL',
        defaultValue: 'https://api.servicepay.ng/api',
      )})
      : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;

  Future<Map<String, dynamic>> request(String method, String path,
      {Map<String, dynamic>? body, Map<String, String>? query}) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token') ?? '';
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
    };
    final response = method == 'GET'
        ? await _client.get(uri, headers: headers)
        : method == 'POST'
            ? await _client.post(uri, headers: headers, body: jsonEncode(body))
            : await _client.patch(uri,
                headers: headers, body: jsonEncode(body));
    final decoded =
        response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    final result = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
          result['message']?.toString() ?? 'The SVP service is unavailable.');
    }
    return result;
  }
}
