import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'session_store.dart';

@immutable
class CustomerLeaderboardRow {
  const CustomerLeaderboardRow({
    required this.rank,
    required this.displayName,
    required this.count,
    required this.value,
    required this.isMe,
  });

  final int rank;
  final String displayName;
  final int count;
  final num value;
  final bool isMe;

  factory CustomerLeaderboardRow.fromJson(Map<String, dynamic> json) =>
      CustomerLeaderboardRow(
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        displayName: json['displayName']?.toString() ?? 'ServicePay customer',
        count: (json['count'] as num?)?.toInt() ?? 0,
        value: (json['value'] as num?) ?? 0,
        isMe: json['isMe'] == true,
      );
}

@immutable
class CustomerLeaderboardReport {
  const CustomerLeaderboardReport({
    required this.enabled,
    required this.month,
    required this.timeZone,
    required this.countTop,
    required this.valueTop,
    required this.me,
    required this.rules,
    required this.calculatedAt,
    required this.cachedUntil,
  });

  final bool enabled;
  final String month;
  final String timeZone;
  final List<CustomerLeaderboardRow> countTop;
  final List<CustomerLeaderboardRow> valueTop;
  final Map<String, dynamic> me;
  final Map<String, dynamic> rules;
  final String? calculatedAt;
  final String? cachedUntil;

  factory CustomerLeaderboardReport.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : <String, dynamic>{};
    final period = data['period'] is Map
        ? Map<String, dynamic>.from(data['period'] as Map)
        : <String, dynamic>{};
    List<CustomerLeaderboardRow> rows(String key) =>
        (data[key] is List ? data[key] as List : const [])
            .whereType<Map>()
            .map((row) =>
                CustomerLeaderboardRow.fromJson(Map<String, dynamic>.from(row)))
            .toList();
    return CustomerLeaderboardReport(
      enabled: data['enabled'] == true,
      month: period['month']?.toString() ?? '',
      timeZone: period['timeZone']?.toString() ?? 'Africa/Lagos',
      countTop: rows('countTop'),
      valueTop: rows('valueTop'),
      me: data['me'] is Map
          ? Map<String, dynamic>.from(data['me'] as Map)
          : const <String, dynamic>{},
      rules: data['rules'] is Map
          ? Map<String, dynamic>.from(data['rules'] as Map)
          : const <String, dynamic>{},
      calculatedAt: data['calculatedAt']?.toString(),
      cachedUntil: data['cachedUntil']?.toString(),
    );
  }
}

class CustomerLeaderboardApi {
  CustomerLeaderboardApi({
    http.Client? client,
    this.baseUrl = const String.fromEnvironment(
      'SERVICEPAY_API_BASE_URL',
      defaultValue: 'https://api.servicepay.ng/api',
    ),
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;

  Future<CustomerLeaderboardReport> load(String month) async {
    final token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) {
      throw const FormatException(
          'Your session has expired. Please sign in again.');
    }
    final response = await _client.get(
      Uri.parse('$baseUrl/customer-leaderboard')
          .replace(queryParameters: {'month': month}),
      headers: {'Accept': 'application/json', 'Authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 20));
    final decoded = jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw FormatException(decoded is Map
          ? decoded['message']?.toString() ?? 'Could not load Champions.'
          : 'Could not load Champions.');
    }
    if (decoded is! Map || decoded['success'] != true) {
      throw const FormatException('Champions report is unavailable.');
    }
    return CustomerLeaderboardReport.fromJson(
        Map<String, dynamic>.from(decoded));
  }

  Future<bool> loadShowFullName() async {
    final token = await _readToken();
    final response = await _client.get(
      Uri.parse('$baseUrl/customer-leaderboard/privacy'),
      headers: {'Accept': 'application/json', 'Authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 20));
    return _parsePrivacyResponse(response);
  }

  Future<bool> updateShowFullName(bool showFullName) async {
    final token = await _readToken();
    final response = await _client
        .patch(
          Uri.parse('$baseUrl/customer-leaderboard/privacy'),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({'showFullName': showFullName}),
        )
        .timeout(const Duration(seconds: 20));
    return _parsePrivacyResponse(response);
  }

  Future<String> _readToken() async {
    final token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) {
      throw const FormatException(
          'Your session has expired. Please sign in again.');
    }
    return token;
  }

  bool _parsePrivacyResponse(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw FormatException(decoded is Map
          ? decoded['message']?.toString() ??
              'Could not update Champions privacy preference.'
          : 'Could not update Champions privacy preference.');
    }
    if (decoded is! Map ||
        decoded['success'] != true ||
        decoded['data'] is! Map ||
        decoded['data']['showFullName'] is! bool) {
      throw const FormatException(
          'Champions privacy preference could not be confirmed.');
    }
    return decoded['data']['showFullName'] as bool;
  }
}
