import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Non-authoritative, customer-scoped address-book cache. Never stores tokens,
/// balances, PINs, quotes, purchase results, or transaction status.
class SavedNumbersCache {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  static final Map<String, List<Map<String, dynamic>>> _memory = {};

  // Decoding is ONLY for cache namespacing, never authentication/authorization.
  // The server still validates the token on every authenticated API request.
  static String? ownerForToken(String token) {
    try {
      final payload = jsonDecode(utf8
          .decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))));
      final id =
          (payload['id'] ?? payload['_id'] ?? payload['sub'])?.toString();
      if (id == null || !RegExp(r'^[a-fA-F0-9]{24}$').hasMatch(id)) return null;
      return id.toLowerCase();
    } catch (_) {
      return null;
    }
  }

  static List<Map<String, dynamic>> sanitize(List<dynamic> rows) => rows
      .whereType<Map>()
      .where((r) => r['_id'] != null && r['phone'] is String)
      .take(200)
      .map((r) => <String, dynamic>{
            for (final key in const [
              '_id',
              'phone',
              'normalizedPhone',
              'name',
              'createdAt',
              'updatedAt'
            ])
              if (r[key] != null) key: r[key].toString(),
          })
      .toList();

  static List<Map<String, dynamic>> _copy(List<Map<String, dynamic>> rows) =>
      rows.map((r) => Map<String, dynamic>.from(r)).toList();

  static Future<List<Map<String, dynamic>>> read(String owner) async {
    if (_memory.containsKey(owner)) return _copy(_memory[owner]!);
    try {
      final raw = await _storage
          .read(key: 'servicepay_saved_numbers_v1_$owner')
          .timeout(const Duration(milliseconds: 500));
      if (raw == null) return [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      final rows = sanitize(decoded);
      _memory[owner] = rows;
      return _copy(rows);
    } catch (_) {
      // Cache is optional; the network result remains the source of truth.
      return [];
    }
  }

  static Future<void> write(
      String owner, List<Map<String, dynamic>> rows) async {
    final safe = sanitize(rows);
    _memory[owner] = safe;
    try {
      await _storage
          .write(
              key: 'servicepay_saved_numbers_v1_$owner',
              value: jsonEncode(safe))
          .timeout(const Duration(seconds: 1));
    } catch (_) {
      // Memory remains available when this browser does not support persistence.
    }
  }

  static Future<void> invalidate(String owner) async {
    _memory.remove(owner);
    try {
      await _storage
          .delete(key: 'servicepay_saved_numbers_v1_$owner')
          .timeout(const Duration(seconds: 1));
    } catch (_) {}
  }
}
