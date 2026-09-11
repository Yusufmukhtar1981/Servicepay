import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'organization_models.dart';

class OrganizationsApi {
  static final Random _secureRandom = Random.secure();

  static String _createIdempotencyKey() {
    final List<int> randomBytes = List<int>.generate(
      18,
      (_) => _secureRandom.nextInt(256),
    );
    return 'organization-${DateTime.now().microsecondsSinceEpoch}-'
        '${base64UrlEncode(randomBytes)}';
  }

  OrganizationsApi(
      {http.Client? client,
      this.baseUrl = 'https://api.servicepay.ng/api/organizations'})
      : _client = client ?? http.Client();
  final http.Client _client;
  final String baseUrl;

  Future<List<Organization>> mine() async {
    final data = await _request('GET', '/mine');
    final owned = data['organizations'] is List
        ? data['organizations'] as List
        : const [];
    final memberships =
        data['memberships'] is List ? data['memberships'] as List : const [];
    final result = <Organization>[];
    for (final item in owned.whereType<Map>()) {
      result.add(Organization.fromJson(Map<String, dynamic>.from(item)));
    }
    for (final item in memberships.whereType<Map>()) {
      final membership = Map<String, dynamic>.from(item);
      final rawOrg = membership['organization'];
      if (rawOrg is Map) {
        final json = Map<String, dynamic>.from(rawOrg);
        json['membership'] = membership;
        result.add(Organization.fromJson(json));
      }
    }
    return result;
  }

  Future<List<Organization>> explore({String query = ''}) async =>
      _list('/explore', query.isEmpty ? null : {'search': query});
  Future<Organization> detail(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}');
    final raw = data['organization'];
    final organization =
        raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    if (data['membership'] is Map) {
      organization['membership'] = data['membership'];
    }
    if ('${organization['id'] ?? organization['_id'] ?? ''}'.trim().isEmpty) {
      organization['id'] = id;
    }
    return Organization.fromJson(organization);
  }

  Future<Map<String, dynamic>> membership(String id) async =>
      _request('GET', '/${Uri.encodeComponent(id)}/membership');
  Future<Map<String, dynamic>> card(String id) async =>
      _request('GET', '/${Uri.encodeComponent(id)}/membership-card');
  Future<Map<String, dynamic>> dashboard(String id) async =>
      _request('GET', '/${Uri.encodeComponent(id)}/dashboard');

  Future<Map<String, dynamic>> apply(String id, Map<String, dynamic> fields) =>
      _request('POST', '/${Uri.encodeComponent(id)}/apply', body: fields);
  Future<List<OrganizationPayment>> payments(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}/payments');
    final raw = data['payments'] ?? data['data'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map((e) =>
                OrganizationPayment.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <OrganizationPayment>[];
  }

  Future<List<Map<String, dynamic>>> dues(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}/dues');
    final raw = data['dues'] ?? data['data'];
    final list = raw is List ? raw : <dynamic>[];
    return list
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  Future<Map<String, dynamic>> payAnnual(
          {required String organizationId, required String pin}) =>
      _request('POST', '/${Uri.encodeComponent(organizationId)}/annual-payment',
          body: {'transactionPin': pin},
          idempotencyKey: _createIdempotencyKey());
  Future<Map<String, dynamic>> pay(
          {required String organizationId,
          required String dueId,
          required String pin}) =>
      _request('POST', '/${Uri.encodeComponent(organizationId)}/payments',
          body: {'dueId': dueId, 'transactionPin': pin},
          idempotencyKey: _createIdempotencyKey());

  Future<List<Organization>> _list(String path,
      [Map<String, String>? query]) async {
    final data = await _request('GET', path, query: query);
    final raw = data['organizations'] ?? data['data'] ?? data['items'];
    final list = raw is List
        ? raw
        : raw is Map
            ? <dynamic>[raw]
            : <dynamic>[];
    return list
        .whereType<Map>()
        .map((e) => Organization.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query,
      Map<String, dynamic>? body,
      String? idempotencyKey}) async {
    final prefs = await SharedPreferences.getInstance();
    var token = prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('access_token');
    if (token == null || token.trim().isEmpty)
      throw Exception(
          'Your login session was not found. Please sign in again.');
    token = token.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${token.trim()}'
    };
    if (idempotencyKey != null) headers['X-Idempotency-Key'] = idempotencyKey;
    final response = method == 'GET'
        ? await _client.get(uri, headers: headers)
        : await _client.post(uri,
            headers: headers, body: jsonEncode(body ?? {}));
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        data['success'] == false) {
      throw Exception(data['message']?.toString() ??
          'Organization request failed. Please try again.');
    }
    return data;
  }
}

/// Backwards-compatible short name for screens and integrations.
typedef OrganizationApi = OrganizationsApi;
