import 'dart:convert';

import 'package:http/http.dart' as http;

import 'session_store.dart';

typedef RecoveryUrlLauncher = Future<bool> Function(Uri uri);
typedef RecoveryTokenReader = Future<String?> Function();

class CustomerAccountRecoveryService {
  CustomerAccountRecoveryService({
    required http.Client client,
    required String baseUrl,
    required RecoveryUrlLauncher launch,
    RecoveryTokenReader? readToken,
  })  : _client = client,
        _baseUrl = baseUrl,
        _launch = launch,
        _readToken = readToken ?? SessionStore.readToken;

  final http.Client _client;
  final String _baseUrl;
  final RecoveryUrlLauncher _launch;
  final RecoveryTokenReader _readToken;
  static const _requestTimeout = Duration(seconds: 30);
  static const _entryPath = '/account-recovery/page';

  Future<bool> smsAvailable() async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/account-recovery/methods'),
      headers: const {'Accept': 'application/json'},
    ).timeout(_requestTimeout);
    final decoded = _decode(response.body);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true ||
        decoded['requiresVerifiedPhone'] != true ||
        decoded['smsAvailable'] is! bool) {
      throw const RecoveryRequestException();
    }
    return decoded['smsAvailable'] as bool;
  }

  Future<RecoveryEntry> requestPhoneChallenge({
    required String phone,
    required String action,
  }) async {
    if (action != 'PASSWORD_RESET' && action != 'PIN_RECOVERY') {
      throw ArgumentError.value(action, 'action');
    }
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/account-recovery/phone/challenge'),
          headers: const {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'phone': phone.trim(), 'action': action}),
        )
        .timeout(_requestTimeout);
    final decoded = _decode(response.body);
    final entryUrl = decoded is Map ? decoded['customerEntryUrl'] : null;
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true ||
        entryUrl is! String) {
      throw const RecoveryRequestException();
    }
    return RecoveryEntry(
      uri: _validatedEntryUri(entryUrl),
      expiresAt: DateTime.tryParse(decoded['expiresAt']?.toString() ?? ''),
    );
  }

  Future<RecoveryEntry> requestPhoneVerification({
    required String currentPassword,
  }) async {
    final token = (await _readToken())?.trim() ?? '';
    if (token.isEmpty) throw const RecoveryRequestException();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/account-recovery/phone-verification/challenge'),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({'currentPassword': currentPassword}),
        )
        .timeout(_requestTimeout);
    final decoded = _decode(response.body);
    final entryUrl = decoded is Map ? decoded['customerEntryUrl'] : null;
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true ||
        entryUrl is! String) {
      throw const RecoveryRequestException();
    }
    return RecoveryEntry(uri: _validatedEntryUri(entryUrl));
  }

  Future<bool> openEntry(Uri uri) => _launch(uri);

  Uri _validatedEntryUri(String value) {
    final Uri configuredBase = Uri.parse(_baseUrl);
    final Uri apiBase = configuredBase.hasScheme
        ? configuredBase
        : Uri.base.resolveUri(configuredBase);
    final Uri parsed = Uri.tryParse(value) ?? Uri();
    final Uri resolved =
        parsed.hasScheme ? parsed : Uri.base.resolveUri(parsed);
    if (apiBase.scheme != 'https' ||
        apiBase.host.isEmpty ||
        resolved.scheme != 'https' ||
        resolved.userInfo.isNotEmpty ||
        resolved.authority.contains('@') ||
        _rawAuthorityContainsUserInfo(value) ||
        resolved.origin != apiBase.origin ||
        resolved.path != _entryPath) {
      throw const RecoveryRequestException();
    }
    return resolved;
  }

  bool _rawAuthorityContainsUserInfo(String value) {
    final schemeSeparator = value.indexOf('://');
    final authorityStart = schemeSeparator >= 0
        ? schemeSeparator + 3
        : value.startsWith('//')
            ? 2
            : -1;
    if (authorityStart < 0) return false;
    var authorityEnd = value.length;
    for (final delimiter in const ['/', '?', '#']) {
      final index = value.indexOf(delimiter, authorityStart);
      if (index >= 0 && index < authorityEnd) authorityEnd = index;
    }
    return value.substring(authorityStart, authorityEnd).contains('@');
  }

  dynamic _decode(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }
}

class RecoveryEntry {
  const RecoveryEntry({required this.uri, this.expiresAt});

  final Uri uri;
  final DateTime? expiresAt;
}

class RecoveryRequestException implements Exception {
  const RecoveryRequestException();
}
