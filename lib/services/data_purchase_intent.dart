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
    String? planName,
    bool preparedOnly = false,
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
            // Re-establish durability even if the storage implementation cached
            // a preceding failed write optimistically.
            await _storage.write(storageKey, saved);
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
        jsonEncode({
          'fingerprint': fingerprint,
          'key': key,
          'planName': planName,
          'submitted': !preparedOnly
        }),
      );
      return key;
    } finally {
      if (identical(_submissions[storageKey], completed.future)) {
        _submissions.remove(storageKey);
      }
      completed.complete();
    }
  }

  /// Serialize preparation cancellation against durable submission admission.
  Future<void> _updatePreparation(String key, {required bool submit}) async {
    final storageKey = '$_prefix${await _accountId()}';
    final preceding = _submissions[storageKey];
    final completed = Completer<void>();
    _submissions[storageKey] = completed.future;
    try {
      if (preceding != null) await preceding;
      final saved = await _storage.read(storageKey);
      final existing = saved == null ? null : jsonDecode(saved);
      if (existing is! Map || existing['key'] != key) {
        if (submit)
          throw StateError(
              'The purchase confirmation expired. Please try again.');
        return;
      }
      if (submit) {
        await _storage.write(
            storageKey, jsonEncode({...existing, 'submitted': true}));
      } else if (existing['submitted'] == false) {
        // Missing submitted flags are legacy uncertain purchases, never cancel.
        await _storage.delete(storageKey);
      }
    } finally {
      if (identical(_submissions[storageKey], completed.future)) {
        _submissions.remove(storageKey);
      }
      completed.complete();
    }
  }

  Future<void> markSubmitted(String key) =>
      _updatePreparation(key, submit: true);
  Future<void> cancelPreparation(String key) =>
      _updatePreparation(key, submit: false);

  Future<void> finish(String key) async {
    final storageKey = '$_prefix${await _accountId()}';
    final saved = await _storage.read(storageKey);
    if (saved == null) return;
    final existing = jsonDecode(saved);
    if (existing is Map && existing['key'] == key) {
      await _storage.delete(storageKey);
    }
  }

  Future<Map<String, dynamic>?> pending() async {
    final saved = await _storage.read('$_prefix${await _accountId()}');
    if (saved == null) return null;
    final decoded = jsonDecode(saved);
    if (decoded is! Map ||
        decoded['key'] is! String ||
        decoded['fingerprint'] is! String) {
      throw StateError('An earlier DATA request cannot be safely recovered.');
    }
    if (decoded['submitted'] == false) return null;
    return Map<String, dynamic>.from(decoded);
  }

  Future<List<Map<String, dynamic>>> retained() async {
    final storageKey = '$_prefix${await _accountId()}.retained';
    final raw = await _storage.read(storageKey);
    if (raw == null) return [];
    final decoded = jsonDecode(raw);
    if (decoded is! List)
      throw StateError('Earlier requests cannot be recovered.');
    return decoded.map((item) {
      if (item is! Map ||
          item['key'] is! String ||
          item['fingerprint'] is! String) {
        throw StateError('Earlier requests cannot be recovered.');
      }
      return Map<String, dynamic>.from(item);
    }).toList();
  }

  /// Only an explicit, server-authorized independent purchase frees the active
  /// slot. Preserve the previous identity before deleting it; never resend it.
  Future<void> retainForSeparatePurchase(String key) async {
    final storageKey = '$_prefix${await _accountId()}';
    final preceding = _submissions[storageKey];
    final completed = Completer<void>();
    _submissions[storageKey] = completed.future;
    try {
      if (preceding != null) await preceding;
      final saved = await _storage.read(storageKey);
      if (saved == null) throw StateError('The original request is missing.');
      final active = jsonDecode(saved);
      if (active is! Map ||
          active['key'] != key ||
          active['fingerprint'] is! String ||
          active['submitted'] == false) {
        throw StateError('The original request cannot be retained.');
      }
      final history = await retained();
      if (!history.any((item) => item['key'] == key)) {
        if (history.length >= 100)
          throw StateError('Resolve an earlier request first.');
        history.add(Map<String, dynamic>.from(active));
      }
      final encoded = jsonEncode(history);
      await _storage.write('$storageKey.retained', encoded);
      if (await _storage.read('$storageKey.retained') != encoded) {
        throw StateError('The original request could not be durably retained.');
      }
      await _storage.delete(storageKey);
    } finally {
      if (identical(_submissions[storageKey], completed.future)) {
        _submissions.remove(storageKey);
      }
      completed.complete();
    }
  }

  Future<void> finishRetained(String key) async {
    final storageKey = '$_prefix${await _accountId()}.retained';
    final history = await retained();
    history.removeWhere((item) => item['key'] == key);
    await _storage.write(storageKey, jsonEncode(history));
  }
}
