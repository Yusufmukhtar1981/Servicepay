import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'session_store.dart';

abstract class DataPurchaseIntentStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class _SecureIntentStorage implements DataPurchaseIntentStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// A submitted purchase retains its identity until the server confirms a
/// terminal outcome. Never discard an uncertain submission to make a new one.
class DataPurchaseIntent {
  DataPurchaseIntent({
    DataPurchaseIntentStorage? storage,
    Future<String> Function()? accountId,
  })  : _storage = storage ?? _SecureIntentStorage(),
        _accountId = accountId ?? _authenticatedAccountId;

  final DataPurchaseIntentStorage _storage;
  final Future<String> Function() _accountId;
  static const String _prefix = 'servicepay.dataPurchase.pending.';
  static final Map<String, Future<void>> _submissions =
      <String, Future<void>>{};

  static Future<String> _authenticatedAccountId() async {
    final token = await SessionStore.readToken();
    if (token == null) throw StateError('Please sign in before buying data.');
    try {
      final parts = token.split('.');
      final claims = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
      );
      final id = claims['id'];
      if (id is String && RegExp(r'^[a-fA-F0-9]{24}$').hasMatch(id)) {
        return id.toLowerCase();
      }
    } catch (_) {
      // A malformed session must never authorize a fresh purchase identity.
    }
    throw StateError('Unable to identify your session. Please sign in again.');
  }

  static String _fingerprint({
    required String network,
    required String phone,
    required String planCode,
    required double price,
    String? productQuote,
  }) =>
      jsonEncode(<String>[
        network.trim().toUpperCase(),
        phone.trim(),
        planCode.trim(),
        price.toStringAsFixed(2),
        productQuote?.trim() ?? '',
      ]);

  Future<String> keyForSubmission({
    required String network,
    required String phone,
    required String planCode,
    required double price,
    String? productQuote,
  }) async {
    final storageKey = '$_prefix${await _accountId()}';
    final preceding = _submissions[storageKey];
    final completed = Completer<void>();
    _submissions[storageKey] = completed.future;
    try {
      if (preceding != null) await preceding;
      final fingerprint = _fingerprint(
        network: network,
        phone: phone,
        planCode: planCode,
        price: price,
        productQuote: productQuote,
      );
      final saved = await _storage.read(storageKey);
      if (saved != null) {
        try {
          final existing = jsonDecode(saved);
          if (existing is Map &&
              existing['fingerprint'] == fingerprint &&
              existing['key'] is String &&
              (existing['key'] as String).isNotEmpty) {
            return existing['key'] as String;
          }
        } catch (_) {
          // Corrupt state is unresolved, not permission to spend again.
        }
        throw StateError(
          'A previous data purchase may still be processing. Confirm its '
          'final status before starting a different purchase.',
        );
      }
      final random = Random.secure();
      final key = 'data-${base64UrlEncode(
        List<int>.generate(24, (_) => random.nextInt(256)),
      ).replaceAll('=', '')}';
      // Persist before sending: a timeout or screen restart must retain this key.
      await _storage.write(
        storageKey,
        jsonEncode({'fingerprint': fingerprint, 'key': key}),
      );
      return key;
    } finally {
      if (identical(_submissions[storageKey], completed.future)) {
        _submissions.remove(storageKey);
      }
      completed.complete();
    }
  }

  Future<void> finish(String key) async {
    final storageKey = '$_prefix${await _accountId()}';
    final saved = await _storage.read(storageKey);
    if (saved == null) return;
    final existing = jsonDecode(saved);
    if (existing is Map && existing['key'] == key) {
      await _storage.delete(storageKey);
    }
  }
}
