import 'dart:convert';
import 'dart:math';

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

  static Future<List<TrustDeal>> deals({String? status}) async {
    final Uri uri = Uri.parse('$baseUrl/trust/deals').replace(
      queryParameters:
          status == null ? null : <String, String>{'status': status},
    );
    return _dealList(await _get(uri), 'deals');
  }

  static Future<TrustDeal> getDeal(String id) async => _deal(
      await _get(Uri.parse('$baseUrl/trust/deals/${Uri.encodeComponent(id)}')),
      'deal');

  static Future<TrustDeal> createDeal(Map<String, dynamic> payload) async =>
      _deal(
          await _request('POST', Uri.parse('$baseUrl/trust/deals'),
              payload: payload),
          'deal');

  static Future<TrustDeal> fundDeal(String id, String pin) async => _deal(
      await _request('POST',
          Uri.parse('$baseUrl/trust/deals/${Uri.encodeComponent(id)}/fund'),
          payload: <String, dynamic>{'transactionPin': pin}),
      'deal');

  static Future<TrustDeal> dealAction(String id, String action,
          {Map<String, dynamic>? payload}) async =>
      _deal(
          await _request(
              'POST',
              Uri.parse(
                  '$baseUrl/trust/deals/${Uri.encodeComponent(id)}/$action'),
              payload: payload ?? <String, dynamic>{}),
          'deal');

  static Future<TrustDispute> createDispute(
          String dealId, Map<String, dynamic> payload) async =>
      _dispute(
          await _request(
              'POST',
              Uri.parse(
                  '$baseUrl/trust/deals/${Uri.encodeComponent(dealId)}/disputes'),
              payload: payload),
          'dispute');

  static Future<List<TrustDeal>> adminDeals({String? status}) async =>
      _dealList(
          await _get(Uri.parse('$baseUrl/admin/trust/deals').replace(
              queryParameters:
                  status == null ? null : <String, String>{'status': status})),
          'deals');

  static Future<List<TrustDispute>> adminDisputes() async => _disputeList(
      await _get(Uri.parse('$baseUrl/admin/trust/disputes')), 'disputes');

  static Future<TrustDispute> adminResolveDispute(
          String id, String resolution, String note) async =>
      _dispute(
          await _request(
              'POST',
              Uri.parse(
                  '$baseUrl/admin/trust/disputes/${Uri.encodeComponent(id)}/resolve'),
              payload: <String, dynamic>{
                'resolution': resolution,
                'note': note
              }),
          'dispute');

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
      if (method != 'GET') 'Idempotency-Key': _idempotencyKey(),
    };
    final String? encoded = payload == null ? null : jsonEncode(payload);
    final http.Response response = method == 'GET'
        ? await http.get(uri, headers: headers)
        : method == 'PATCH'
            ? await http.patch(uri, headers: headers, body: encoded)
            : await http.post(uri, headers: headers, body: encoded);
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

  static String _idempotencyKey() =>
      '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

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

  static TrustDeal _deal(Map<String, dynamic> body, String key) {
    final dynamic data = body['data'];
    final dynamic raw = data is Map ? data[key] ?? data : body[key] ?? body;
    if (raw is! Map) throw Exception('The server returned an invalid deal.');
    return TrustDeal.fromJson(Map<String, dynamic>.from(raw));
  }

  static List<TrustDeal> _dealList(Map<String, dynamic> body, String key) {
    final dynamic data = body['data'];
    final dynamic raw = data is Map ? data[key] ?? data['items'] : body[key];
    if (raw is! List) return <TrustDeal>[];
    return raw
        .whereType<Map>()
        .map((Map item) => TrustDeal.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  static TrustDispute _dispute(Map<String, dynamic> body, String key) {
    final dynamic data = body['data'];
    final dynamic raw = data is Map ? data[key] ?? data : body[key] ?? body;
    if (raw is! Map) throw Exception('The server returned an invalid dispute.');
    return TrustDispute.fromJson(Map<String, dynamic>.from(raw));
  }

  static List<TrustDispute> _disputeList(
      Map<String, dynamic> body, String key) {
    final dynamic data = body['data'];
    final dynamic raw = data is Map ? data[key] ?? data['items'] : body[key];
    if (raw is! List) return <TrustDispute>[];
    return raw
        .whereType<Map>()
        .map((Map item) =>
            TrustDispute.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }
}
