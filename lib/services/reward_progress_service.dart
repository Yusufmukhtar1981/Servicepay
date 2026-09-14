import 'dart:convert';

import 'package:http/http.dart' as http;

/// Server-calculated progress for one announcement campaign.
///
/// The customer app deliberately does not calculate eligibility from
/// transactions. These values are only rendered after the authenticated
/// progress endpoint supplies them.
class RewardProgress {
  const RewardProgress({
    required this.transactionCount,
    required this.requiredTransactionCount,
    required this.transactionValue,
    required this.requiredTransactionValue,
    required this.qualified,
    this.remainingTransactions,
    this.remainingValue,
    this.hasData = true,
  });

  const RewardProgress.empty()
      : transactionCount = 0,
        requiredTransactionCount = 0,
        transactionValue = 0,
        requiredTransactionValue = 0,
        qualified = false,
        remainingTransactions = null,
        remainingValue = null,
        hasData = false;

  final int transactionCount;
  final int requiredTransactionCount;
  final double transactionValue;
  final double requiredTransactionValue;
  final bool qualified;
  final int? remainingTransactions;
  final double? remainingValue;
  final bool hasData;

  factory RewardProgress.fromJson(Map<String, dynamic> json) {
    dynamic value(String key) =>
        json[key] ?? (json['data'] is Map ? (json['data'] as Map)[key] : null);

    int integer(List<String> keys) {
      for (final String key in keys) {
        final dynamic raw = value(key);
        if (raw is num) return raw.toInt();
        final int? parsed = int.tryParse(raw?.toString() ?? '');
        if (parsed != null) return parsed;
      }
      return 0;
    }

    double number(List<String> keys) {
      for (final String key in keys) {
        final dynamic raw = value(key);
        if (raw is num) return raw.toDouble();
        final double? parsed =
            double.tryParse(raw?.toString().replaceAll(',', '') ?? '');
        if (parsed != null) return parsed;
      }
      return 0;
    }

    final dynamic rawRequirements = json['requirements'] ??
        (json['data'] is Map ? (json['data'] as Map)['requirements'] : null);
    final Map<String, dynamic> requirements = rawRequirements is Map
        ? Map<String, dynamic>.from(rawRequirements)
        : <String, dynamic>{};
    int requirementInt(List<String> keys) {
      for (final String key in keys) {
        final dynamic raw = requirements[key];
        if (raw is num) return raw.toInt();
        final int? parsed = int.tryParse(raw?.toString() ?? '');
        if (parsed != null) return parsed;
      }
      return 0;
    }

    double requirementNumber(List<String> keys) {
      for (final String key in keys) {
        final dynamic raw = requirements[key];
        if (raw is num) return raw.toDouble();
        final double? parsed =
            double.tryParse(raw?.toString().replaceAll(',', '') ?? '');
        if (parsed != null) return parsed;
      }
      return 0;
    }

    final dynamic rawQualified = value('qualified') ?? value('isQualified');
    final bool qualified = rawQualified == true ||
        rawQualified?.toString().trim().toLowerCase() == 'true';
    final int? remainingTransactions = _optionalInt(
      value('remainingTransactions') ??
          value('remainingTransactionCount') ??
          value('remainingCount'),
    );
    final double? remainingValue = _optionalDouble(
      value('remainingValue') ?? value('remainingTransactionValue'),
    );

    return RewardProgress(
      transactionCount: integer(
        <String>['transactionCount', 'qualifyingTransactionCount', 'count'],
      ),
      requiredTransactionCount: _firstInt(
        integer(<String>[
          'requiredTransactionCount',
          'qualifyingTransactionCountRequired',
          'transactionCountRequired',
        ]),
        requirementInt(<String>[
          'qualifyingTransactionCount',
          'requiredTransactionCount',
        ]),
      ),
      transactionValue: number(
        <String>['transactionValue', 'qualifyingTransactionValue', 'value'],
      ),
      requiredTransactionValue: _firstDouble(
        number(<String>[
          'requiredTransactionValue',
          'qualifyingTransactionValueRequired',
          'transactionValueRequired',
        ]),
        requirementNumber(<String>[
          'qualifyingTransactionValue',
          'requiredTransactionValue',
        ]),
      ),
      qualified: qualified,
      remainingTransactions: remainingTransactions,
      remainingValue: remainingValue,
    );
  }

  static int _firstInt(int primary, int fallback) =>
      primary == 0 ? fallback : primary;

  static double _firstDouble(double primary, double fallback) =>
      primary == 0 ? fallback : primary;

  static int? _optionalInt(dynamic raw) {
    if (raw is num) return raw.toInt();
    return int.tryParse(raw?.toString() ?? '');
  }

  static double? _optionalDouble(dynamic raw) {
    if (raw is num) return raw.toDouble();
    return double.tryParse(raw?.toString().replaceAll(',', '') ?? '');
  }
}

class RewardProgressService {
  RewardProgressService({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    required this.token,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final String token;

  Map<String, String> get _headers => <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      };

  Future<RewardProgress> fetchProgress(String promotionId) async {
    final http.Response response = await _client
        .get(
          Uri.parse(
            '$baseUrl/announcements/${Uri.encodeComponent(promotionId)}/progress',
          ),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 12));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Reward progress is temporarily unavailable.');
    }
    if (response.body.trim().isEmpty) return const RewardProgress.empty();
    final dynamic decoded = jsonDecode(response.body);
    dynamic payload = decoded;
    if (decoded is Map) {
      payload = decoded['progress'] ?? decoded['data'] ?? decoded;
      if (payload is Map && payload['progress'] is Map) {
        payload = payload['progress'];
      }
    }
    if (payload is! Map) return const RewardProgress.empty();
    final Map<String, dynamic> data = Map<String, dynamic>.from(payload);
    if (data.isEmpty) return const RewardProgress.empty();
    return RewardProgress.fromJson(data);
  }
}