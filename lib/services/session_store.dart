import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';

/// The one place where an access token is persisted. Tokens must never be
/// placed in SharedPreferences (which is not encrypted on Android).
class SessionStore {
  SessionStore._();

  static const _tokenKey = 'servicepay_access_token';
  static const _secureSessionMarker = 'servicepay_secure_session_present';
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  static String? _memoryFallback;
  static Future<void>? _migration;
  static int _generation = 0;

  static Future<String?> readToken() async {
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString('auth_token') ??
        prefs.getString('access_token') ??
        prefs.getString('token');
    if (legacy != null && legacy.trim().isNotEmpty) {
      _memoryFallback = legacy.trim();
      final generation = _generation;
      final migration = _migrateLegacyToken(prefs, legacy.trim(), generation);
      _migration = migration;
      migration.whenComplete(() {
        if (identical(_migration, migration)) _migration = null;
      });
      return legacy.trim();
    }
    if (prefs.getBool(_secureSessionMarker) != true) {
      return _memoryFallback;
    }
    try {
      final existing = await _storage.read(key: _tokenKey);
      if (existing != null && existing.trim().isNotEmpty) return existing.trim();
    } catch (_) {
      // Unregistered plugins (including pure Dart tests) use the fallback.
    }
    return _memoryFallback;
  }

  static Future<void> _migrateLegacyToken(
    SharedPreferences prefs,
    String token,
    int generation,
  ) async {
    try {
      await _storage.write(key: _tokenKey, value: token);
      if (generation != _generation) return;
      await prefs.setBool(_secureSessionMarker, true);
      for (final key in const ['auth_token', 'access_token', 'token']) {
        await prefs.remove(key);
      }
    } catch (_) {
      if (generation == _generation) {
        _memoryFallback = token;
      }
    }
  }

  static Future<void> writeToken(String token) async {
    if (token.trim().isEmpty) throw ArgumentError('Token cannot be empty');
    final normalized = token.trim();
    _memoryFallback = normalized;
    try {
      await _storage.write(key: _tokenKey, value: normalized);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_secureSessionMarker, true);
    } catch (_) {
      // Pure Dart tests and unsupported embedders keep a process-only token.
    }
    final prefs = await SharedPreferences.getInstance();
    for (final key in const ['auth_token', 'access_token', 'token']) {
      await prefs.remove(key);
    }
  }

  static Future<void> clear() async {
    _generation++;
    _memoryFallback = null;
    final migration = _migration;
    if (migration != null) await migration;
    _memoryFallback = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_secureSessionMarker);
    for (final key in const ['auth_token', 'access_token', 'token']) {
      await prefs.remove(key);
    }
    try {
      await _storage.delete(key: _tokenKey);
    } catch (_) {
      // No persistent secure store exists in this process.
    }
  }
}
