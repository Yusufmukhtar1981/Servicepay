import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'session_store.dart';

@immutable
class CustomerNotificationSettings {
  const CustomerNotificationSettings({
    this.dashboardBackground = 'green',
    this.soundNotifications = false,
    this.voiceAnnouncements = false,
  });

  final String dashboardBackground;
  final bool soundNotifications;
  final bool voiceAnnouncements;

  CustomerNotificationSettings copyWith({
    String? dashboardBackground,
    bool? soundNotifications,
    bool? voiceAnnouncements,
  }) =>
      CustomerNotificationSettings(
        dashboardBackground: dashboardBackground ?? this.dashboardBackground,
        soundNotifications: soundNotifications ?? this.soundNotifications,
        voiceAnnouncements: voiceAnnouncements ?? this.voiceAnnouncements,
      );

  factory CustomerNotificationSettings.fromJson(Map<String, dynamic> json) {
    final background = json['dashboardBackground'];
    final sound = json['soundNotifications'];
    final voice = json['voiceAnnouncements'];
    if ((background != 'green' && background != 'default') ||
        sound is! bool ||
        voice is! bool) {
      throw const CustomerSettingsException(
          'The customer settings response was invalid.');
    }
    return CustomerNotificationSettings(
      dashboardBackground: background as String,
      soundNotifications: sound,
      voiceAnnouncements: voice,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'dashboardBackground': dashboardBackground,
        'soundNotifications': soundNotifications,
        'voiceAnnouncements': voiceAnnouncements,
      };
}

@immutable
class WalletCreditAlert {
  const WalletCreditAlert({
    required this.id,
    required this.amount,
    required this.reference,
    required this.createdAt,
    required this.balance,
    required this.creditBalance,
  });

  final String id;
  final double amount;
  final String reference;
  final DateTime createdAt;
  final double balance;
  final double creditBalance;

  factory WalletCreditAlert.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final reference = json['reference'];
    final createdAt = json['createdAt'];
    final time = createdAt is String ? DateTime.tryParse(createdAt) : null;
    if (json['currency'] != 'NGN' ||
        id is! String ||
        id.trim().isEmpty ||
        reference is! String ||
        reference.trim().isEmpty ||
        time == null) {
      throw const CustomerSettingsException(
          'The wallet activity response was invalid.');
    }
    return WalletCreditAlert(
      id: id.trim(),
      amount: _validatedMoney(json, 'amount'),
      reference: reference.trim(),
      createdAt: time,
      balance: _validatedMoney(json, 'balance'),
      creditBalance: _validatedMoney(json, 'creditBalance'),
    );
  }
}

double _validatedMoney(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! num) {
    throw const CustomerSettingsException(
        'The wallet activity response contained an invalid amount.');
  }
  final amount = value.toDouble();
  if (!amount.isFinite || amount < 0) {
    throw const CustomerSettingsException(
        'The wallet activity response contained an invalid amount.');
  }
  return amount;
}

@immutable
class WalletCreditHandoff {
  const WalletCreditHandoff({required this.settings, required this.alert});
  final CustomerNotificationSettings settings;
  final WalletCreditAlert? alert;
}

class CustomerNotificationSettingsApi {
  CustomerNotificationSettingsApi({
    http.Client? client,
    String baseUrl = 'https://api.servicepay.ng/api',
    Future<String?> Function()? readToken,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _baseUrl = baseUrl,
        _readToken = readToken ?? SessionStore.readToken;

  final http.Client _client;
  final bool _ownsClient;
  final String _baseUrl;
  final Future<String?> Function() _readToken;
  static const Duration requestTimeout = Duration(seconds: 8);

  Future<String> _token() async {
    final token = await _readToken().timeout(requestTimeout);
    if (token == null || token.trim().isEmpty) {
      throw const CustomerSettingsException(
          'Your session has expired. Sign in again.');
    }
    return token.trim();
  }

  Future<void> _ensureSameSession(String token) async {
    if (await _readToken().timeout(requestTimeout) != token) {
      throw const CustomerSettingsException(
          'Your session changed. Please retry.');
    }
  }

  Future<Map<String, dynamic>> _request(
    String method, {
    Map<String, dynamic>? body,
  }) async {
    final token = await _token();
    final uri = Uri.parse('$_baseUrl/notifications/customer-settings');
    final headers = <String, String>{
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    final response = (method == 'GET'
            ? _client.get(uri, headers: headers)
            : _client.patch(uri, headers: headers, body: jsonEncode(body)))
        .timeout(requestTimeout);
    final result = await response;
    await _ensureSameSession(token);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw CustomerSettingsException(
        'Settings could not be ${method == 'GET' ? 'loaded' : 'saved'} (${result.statusCode}).',
      );
    }
    final decoded = jsonDecode(result.body);
    if (decoded is! Map<String, dynamic> ||
        decoded['success'] != true ||
        decoded['settings'] is! Map<String, dynamic>) {
      throw const CustomerSettingsException(
          'The settings response was incomplete.');
    }
    return decoded['settings'] as Map<String, dynamic>;
  }

  Future<CustomerNotificationSettings> load() async =>
      CustomerNotificationSettings.fromJson(await _request('GET'));

  Future<CustomerNotificationSettings> update(
    Map<String, dynamic> changes,
  ) async {
    const allowed = <String>{
      'dashboardBackground',
      'soundNotifications',
      'voiceAnnouncements',
    };
    if (changes.isEmpty || changes.keys.any((key) => !allowed.contains(key))) {
      throw ArgumentError(
          'Only customer notification settings may be updated.');
    }
    return CustomerNotificationSettings.fromJson(
      await _request('PATCH', body: changes),
    );
  }

  Future<WalletCreditHandoff> claimNextHandoff() async {
    final token = await _token();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/notifications/wallet-credit-alerts/next'),
          headers: <String, String>{
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: '{}',
        )
        .timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CustomerSettingsException(
        'New wallet activity could not be checked (${response.statusCode}).',
      );
    }
    await _ensureSameSession(token);
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic> ||
        decoded['success'] != true ||
        decoded['settings'] is! Map<String, dynamic>) {
      throw const CustomerSettingsException(
          'The wallet activity response was incomplete.');
    }
    final settings = CustomerNotificationSettings.fromJson(
      decoded['settings'] as Map<String, dynamic>,
    );
    final alert = decoded['alert'];
    if (alert == null) {
      return WalletCreditHandoff(settings: settings, alert: null);
    }
    if (alert is! Map<String, dynamic>) {
      throw const CustomerSettingsException(
          'The wallet activity response was invalid.');
    }
    return WalletCreditHandoff(
      settings: settings,
      alert: WalletCreditAlert.fromJson(alert),
    );
  }

  Future<WalletCreditAlert?> claimNextAlert() async =>
      (await claimNextHandoff()).alert;

  void close() {
    if (_ownsClient) _client.close();
  }
}

class CustomerSettingsException implements Exception {
  const CustomerSettingsException(this.message);
  final String message;
  @override
  String toString() => message;
}
