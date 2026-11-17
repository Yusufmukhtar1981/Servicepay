import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../services/session_store.dart';

class ManagementApiException implements Exception {
  final String message;
  final int? statusCode;
  const ManagementApiException(this.message, [this.statusCode]);
  @override
  String toString() => message;
}

class ManagementApi {
  ManagementApi({http.Client? client, Future<String?> Function()? tokenReader})
      : _client = client ?? http.Client(),
        _tokenReader = tokenReader ?? SessionStore.readToken;

  static const String baseUrl = String.fromEnvironment(
    'SERVICEPAY_API_BASE_URL',
    defaultValue: 'https://api.servicepay.ng/api',
  );
  final http.Client _client;
  final Future<String?> Function() _tokenReader;

  Future<Map<String, dynamic>> get(String path,
      [Map<String, String> query = const {}]) async {
    final token = await _tokenReader();
    if (token == null || token.trim().isEmpty) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    final uri = Uri.parse('$baseUrl/management/$path').replace(
      queryParameters: query.isEmpty ? null : query,
    );
    final response = await _client.get(uri, headers: {
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    }).timeout(const Duration(seconds: 25));
    final dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ManagementApiException(
          'The server returned an unreadable response.', response.statusCode);
    }
    if (response.statusCode == 401) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true) {
      throw ManagementApiException(
        decoded is Map
            ? (decoded['message']?.toString() ??
                'Unable to load management data.')
            : 'Unable to load management data.',
        response.statusCode,
      );
    }
    final data = decoded['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    return <String, dynamic>{};
  }

  Future<Map<String, dynamic>> post(
      String path, Map<String, dynamic> payload) async {
    final token = await _tokenReader();
    if (token == null || token.trim().isEmpty) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    final response = await _client
        .post(Uri.parse('$baseUrl/management/$path'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(payload))
        .timeout(const Duration(seconds: 25));
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ManagementApiException(
          'The server returned an unreadable response.', response.statusCode);
    }
    if (response.statusCode == 401) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true) {
      throw ManagementApiException(
        decoded is Map
            ? (decoded['message']?.toString() ?? 'Unable to save target.')
            : 'Unable to save target.',
        response.statusCode,
      );
    }
    final data = decoded['data'];
    return data is Map<String, dynamic>
        ? data
        : data is Map
            ? Map<String, dynamic>.from(data)
            : {};
  }

  Future<Uint8List> export(Map<String, String> query) async {
    final token = await _tokenReader();
    if (token == null || token.trim().isEmpty) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    final response = await _client.get(
      Uri.parse('$baseUrl/management/analytics/export')
          .replace(queryParameters: query),
      headers: {'Authorization': 'Bearer $token', 'Accept': '*/*'},
    ).timeout(const Duration(seconds: 45));
    if (response.statusCode == 401) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = 'Export could not be downloaded.';
      try {
        final value = jsonDecode(response.body);
        if (value is Map && value['message'] != null) {
          message = value['message'].toString();
        }
      } catch (_) {}
      throw ManagementApiException(message, response.statusCode);
    }
    return response.bodyBytes;
  }

  Future<Map<String, dynamic>> workspaceCustomers({
    String activity = 'ALL',
    String search = '',
    String? registeredFrom,
    String? registeredTo,
    int page = 1,
    int limit = 25,
  }) =>
      get('workspace/customers', {
        'activity': activity,
        'search': search,
        if (registeredFrom != null) 'registeredFrom': registeredFrom,
        if (registeredTo != null) 'registeredTo': registeredTo,
        'page': '$page',
        'limit': '$limit',
      });

  Future<Map<String, dynamic>> workspaceCustomer(String id,
          {int page = 1, int limit = 25}) =>
      get('workspace/customers/${_pathSegment(id)}',
          {'page': '$page', 'limit': '$limit'});

  Future<Map<String, dynamic>> workspaceCustomerTransactions(String id,
          {String search = '', int page = 1, int limit = 25}) =>
      get('workspace/customers/${_pathSegment(id)}/transactions',
          {'search': search, 'page': '$page', 'limit': '$limit'});

  Future<Uint8List> exportWorkspaceCustomers(Map<String, String> query) async {
    final token = await _tokenReader();
    if (token == null || token.trim().isEmpty) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    final response = await _client.get(
      Uri.parse('$baseUrl/management/workspace/customers/export')
          .replace(queryParameters: query),
      headers: {'Authorization': 'Bearer $token', 'Accept': '*/*'},
    ).timeout(const Duration(seconds: 45));
    if (response.statusCode == 401) {
      throw const ManagementApiException(
          'Session expired. Please sign in again.', 401);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ManagementApiException(
          'Customer export could not be downloaded.', response.statusCode);
    }
    return response.bodyBytes;
  }

  Future<Map<String, dynamic>> workspaceOverview(Map<String, String> query) =>
      get('workspace/overview', query);

  Future<Map<String, dynamic>> workspacePerformance(
          Map<String, String> query) =>
      get('workspace/performance', query);

  Future<Map<String, dynamic>> workspaceWithdrawals() =>
      get('workspace/withdrawals');

  Future<Map<String, dynamic>> requestCommissionWithdrawal(
          Map<String, dynamic> payload) =>
      post('workspace/withdrawals', payload);

  Future<Map<String, dynamic>> workspaceComplaints({
    String? status,
    int page = 1,
    int limit = 25,
  }) =>
      get('workspace/complaints', {
        if (status != null && status != 'ALL') 'status': status,
        'page': '$page',
        'limit': '$limit',
      });

  Future<Map<String, dynamic>> workspaceComplaint(String id) =>
      get('workspace/complaints/${_pathSegment(id)}');

  Future<Map<String, dynamic>> createWorkspaceComplaint(
          Map<String, dynamic> payload) =>
      post('workspace/complaints', payload);

  Future<Map<String, dynamic>> replyWorkspaceComplaint(
          String id, Map<String, dynamic> payload) =>
      post('workspace/complaints/${_pathSegment(id)}/replies', payload);

  String _pathSegment(String value) {
    if (!RegExp(r'^[A-Za-z0-9_-]{1,128}$').hasMatch(value)) {
      throw ArgumentError.value(value, 'id', 'Invalid record identifier');
    }
    return Uri.encodeComponent(value);
  }
}

class ManagementPeriod {
  const ManagementPeriod(this.preset, {this.from, this.to});
  final String preset;
  final DateTime? from;
  final DateTime? to;
  static const presets = [
    'TODAY',
    'YESTERDAY',
    'LAST_7_DAYS',
    'THIS_WEEK',
    'LAST_WEEK',
    'THIS_MONTH',
    'LAST_MONTH',
    'LAST_30_DAYS',
    'CUSTOM'
  ];

  static String dateString(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  static DateTime? lagosCalendarDate(DateTime? timestamp) =>
      timestamp?.toUtc().add(const Duration(hours: 1));
  Map<String, String> query() => {
        'period': preset,
        if (preset == 'CUSTOM' && from != null) 'from': dateString(from!),
        if (preset == 'CUSTOM' && to != null) 'to': dateString(to!),
      };
}
