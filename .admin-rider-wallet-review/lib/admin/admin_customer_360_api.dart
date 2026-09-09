import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminCustomer360Page {
  const AdminCustomer360Page({required this.items, required this.pagination});

  final List<Map<String, dynamic>> items;
  final Map<String, dynamic> pagination;
}

class AdminCustomer360Api {
  AdminCustomer360Api({http.Client? client})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;

  static const baseUrl = 'https://api.servicepay.ng/api/admin/customer360';
  final http.Client _client;
  final bool _ownsClient;

  Future<List<Map<String, dynamic>>> search(String query) async {
    final response = await _request('search', query: {'query': query.trim()});
    return _items(response);
  }

  Future<Map<String, dynamic>> overview(String customerId) async {
    final response = await _request(Uri.encodeComponent(customerId));
    final data = _map(response['data']);
    return data.isNotEmpty ? data : response;
  }

  Future<AdminCustomer360Page> timeline(String customerId,
      {int page = 1, int limit = 20}) async {
    final response = await _request(
      '${Uri.encodeComponent(customerId)}/timeline',
      query: {'page': '$page', 'limit': '$limit'},
    );
    return AdminCustomer360Page(
      items: _items(response),
      pagination:
          _map(_map(response['data'])['pagination'] ?? response['pagination']),
    );
  }

  Future<AdminCustomer360Page> transactions(
    String customerId, {
    int page = 1,
    int limit = 20,
    String status = '',
    String serviceType = '',
    String search = '',
    String from = '',
    String to = '',
  }) async {
    final response = await _request(
      '${Uri.encodeComponent(customerId)}/transactions',
      query: {
        'page': '$page',
        'limit': '$limit',
        'status': status,
        'serviceType': serviceType,
        'search': search,
        'from': from,
        'to': to,
      }..removeWhere((key, value) => value.isEmpty),
    );
    return AdminCustomer360Page(
      items: _items(response),
      pagination:
          _map(_map(response['data'])['pagination'] ?? response['pagination']),
    );
  }

  Future<Map<String, dynamic>> _request(String path,
      {Map<String, String>? query}) async {
    final prefs = await SharedPreferences.getInstance();
    var token = (prefs.getString('auth_token') ??
            prefs.getString('token') ??
            prefs.getString('admin_token') ??
            '')
        .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
        .trim();
    if (token.isEmpty) {
      throw Exception(
          'Your login session was not found. Please sign in again.');
    }
    final uri = Uri.parse('$baseUrl/$path').replace(queryParameters: query);
    final response = await _client.get(uri, headers: {
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    }).timeout(const Duration(seconds: 30));
    Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(response.body);
      body = decoded is Map ? Map<String, dynamic>.from(decoded) : {};
    } catch (_) {
      body = {};
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['success'] == false) {
      throw Exception(
          (body['message'] ?? 'Unable to load customer intelligence.')
              .toString());
    }
    return body;
  }

  List<Map<String, dynamic>> _items(Map<String, dynamic> response) {
    final data = _map(response['data']);
    final raw = data['items'] ?? response['items'] ?? [];
    return raw is List
        ? raw.whereType<Map>().map(Map<String, dynamic>.from).toList()
        : [];
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};

  void close() {
    if (_ownsClient) _client.close();
  }
}
