import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'trust_models.dart';

class TrustApiService {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static Future<List<TrustProfile>> searchProfiles({
    required String query,
    required String kind,
  }) async {
    final Uri uri = Uri.parse('$baseUrl/trust/search').replace(
      queryParameters: <String, String>{'q': query.trim(), 'kind': kind},
    );
    final Map<String, dynamic> body = await _get(uri);
    return _profileList(body, 'profiles');
  }

  static Future<TrustProfile> getProfile(String servicePayId) async {
    final Map<String, dynamic> body = await _get(
      Uri.parse('$baseUrl/trust/profiles/${Uri.encodeComponent(servicePayId)}'),
    );
    return _profile(body, 'profile');
  }

  static Future<TrustProfile> getMyProfile() async =>
      _profile(await _get(Uri.parse('$baseUrl/trust/me')), 'profile');

  static Future<TrustProfile> updateDiscoverability(bool discoverable) async {
    final Map<String, dynamic> body = await _request(
      'PATCH',
      Uri.parse('$baseUrl/trust/me/discoverability'),
      payload: <String, dynamic>{'discoverable': discoverable},
    );
    return _profile(body, 'profile');
  }

  static Future<List<TrustProfile>> adminProfiles({String query = ''}) async {
    final Uri uri = Uri.parse('$baseUrl/admin/trust/profiles').replace(
      queryParameters: <String, String>{'q': query.trim(), 'limit': '20'},
    );
    return _profileList(await _get(uri), 'profiles');
  }

  static Future<TrustProfile> adminProfile(String servicePayId) async =>
      _profile(
        await _get(Uri.parse(
          '$baseUrl/admin/trust/profiles/${Uri.encodeComponent(servicePayId)}',
        )),
        'profile',
      );

  static Future<Map<String, dynamic>> _get(Uri uri) => _request('GET', uri);

  static Future<Map<String, dynamic>> _request(
    String method,
    Uri uri, {
    Map<String, dynamic>? payload,
  }) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    String? token;
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final String? value = prefs.getString(key)?.trim();
      if (value != null && value.isNotEmpty) {
        token = value.toLowerCase().startsWith('bearer ')
            ? value.substring(7).trim()
            : value;
        break;
      }
    }
    if (token == null || token.isEmpty) {
      throw Exception(
          'Your login session was not found. Please sign in again.');
    }
    final Map<String, String> headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (payload != null) 'Content-Type': 'application/json',
    };
    final http.Response response = method == 'PATCH'
        ? await http.patch(uri, headers: headers, body: jsonEncode(payload))
        : await http.get(uri, headers: headers);
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final Map<String, dynamic> body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
          body['message']?.toString() ?? 'Unable to complete this request.');
    }
    return body;
  }

  static TrustProfile _profile(Map<String, dynamic> body, String key) {
    final dynamic data = body['data'];
    final dynamic raw = data is Map ? data[key] : body[key];
    if (raw is! Map) {
      throw Exception('The server returned an invalid trust profile.');
    }
    return TrustProfile.fromJson(Map<String, dynamic>.from(raw));
  }

  static List<TrustProfile> _profileList(
      Map<String, dynamic> body, String key) {
    final dynamic data = body['data'];
    final dynamic raw = data is Map ? data[key] : body[key];
    if (raw is! List) return <TrustProfile>[];
    return raw
        .whereType<Map>()
        .map((Map value) =>
            TrustProfile.fromJson(Map<String, dynamic>.from(value)))
        .toList();
  }
}
