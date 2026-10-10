import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The one place where an access token is persisted. Tokens must never be
/// placed in SharedPreferences (which is not encrypted on Android).
class SessionStore {
  SessionStore._();

  static const _tokenKey = 'servicepay_access_token';
  static const _refreshKey = 'servicepay_refresh_token';
  static const _secureSessionMarker = 'servicepay_secure_session_present';
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  static String? _memoryFallback;
  static String? _refreshFallback;
  static Future<void> _writes = Future<void>.value();
  static int _writeCount = 0;
  static Future<void>? _migration;
  static int _generation = 0;

  static Future<String?> readToken() async {
    if (_writeCount > 0) await _writes;
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
      if (existing != null && existing.trim().isNotEmpty) {
        _memoryFallback = existing.trim();
        return _memoryFallback;
      }
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

  static Future<String?> readRefreshToken() async {
    if (_writeCount > 0) await _writes;
    try {
      return await _storage.read(key: _refreshKey) ?? _refreshFallback;
    } catch (_) {
      return _refreshFallback;
    }
  }

  static Future<void> writeToken(String token) async {
    await writeSession(token);
  }

  static Future<bool> writeSession(String token, {
    String? refreshToken, String? expectedAccessToken,
  }) async {
    if (token.trim().isEmpty) throw ArgumentError('Token cannot be empty');
    var applied = false;
    Future<void> apply() async {
      if (expectedAccessToken != null && _memoryFallback != expectedAccessToken) return;
      _generation++;
      final migration = _migration;
      if (migration != null) await migration;
      _memoryFallback = token.trim();
      _refreshFallback = refreshToken;
      try {
        await _storage.write(key: _tokenKey, value: token.trim());
        if (refreshToken == null) {
          await _storage.delete(key: _refreshKey);
        } else {
          await _storage.write(key: _refreshKey, value: refreshToken);
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool(_secureSessionMarker, true);
      } catch (_) {
        // Unsupported embedders keep only process memory, never preferences.
      }
      final prefs = await SharedPreferences.getInstance();
      for (final key in const ['auth_token', 'access_token', 'token']) {
        await prefs.remove(key);
      }
      applied = true;
    }
    final wasPending = _writeCount > 0;
    _writeCount++;
    final operation = (wasPending ? _writes.then((_) => apply()) : apply())
        .whenComplete(() => _writeCount--);
    _writes = operation.catchError((Object _) {});
    await operation;
    return applied;
  }

  static Future<void> clear() async {
    if (_writeCount > 0) await _writes;
    _generation++;
    _memoryFallback = null;
    _refreshFallback = null;
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
      await _storage.delete(key: _refreshKey);
    } catch (_) {
      // No persistent secure store exists in this process.
    }
  }
}
