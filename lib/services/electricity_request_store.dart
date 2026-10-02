import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// An unresolved Electricity request survives reloads and failed cache writes.
class ElectricityRequestStore {
  static String _storageKey(String token) {
    final parts = token.split('.');
    if (parts.length != 3) throw StateError('Please sign in again.');
    final claims = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
    final id = claims['id'] ?? claims['userId'] ?? claims['sub'];
    if (id is! String || !RegExp(r'^[a-fA-F0-9]{24}$').hasMatch(id)) {
      throw StateError('Please sign in again.');
    }
    return 'electricity.pending.$id';
  }

  static Future<Map<String, dynamic>?> read(String token) async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_storageKey(token));
    if (saved == null) return null;
    return Map<String, dynamic>.from(jsonDecode(saved) as Map);
  }

  static Future<String> persist(String token, Map<String, dynamic> intent) async {
    final existing = await read(token);
    if (existing != null && jsonEncode(existing['intent']) != jsonEncode(intent)) {
      throw StateError('An Electricity request is unresolved. Check its status before changing payment details.');
    }
    final key = existing?['key'] as String? ??
        'electricity-${DateTime.now().microsecondsSinceEpoch}';
    final value = existing ?? {'key': key, 'intent': intent, 'phase': 'UNSUBMITTED'};
    final prefs = await SharedPreferences.getInstance();
    if (!await prefs.setString(_storageKey(token), jsonEncode(value))) {
      throw StateError('Cannot save the payment request safely. No payment was submitted.');
    }
    return key;
  }

  static Future<void> rememberResult(String token, Map<String, dynamic> result) async {
    final stored = await read(token);
    if (stored == null) return;
    stored['transactionId'] = result['transactionId'];
    final prefs = await SharedPreferences.getInstance();
    if (!await prefs.setString(_storageKey(token), jsonEncode(stored))) {
      throw StateError('Payment submitted. Check Transactions; do not create a new request.');
    }
  }

  static Future<void> markSubmitted(String token) async {
    final stored = await read(token);
    if (stored == null) throw StateError('No persisted payment request.');
    stored['phase'] = 'SUBMITTED';
    final prefs = await SharedPreferences.getInstance();
    if (!await prefs.setString(_storageKey(token), jsonEncode(stored))) {
      throw StateError('Cannot safely submit this request.');
    }
  }

  static Future<void> complete(String token) async {
    final prefs = await SharedPreferences.getInstance();
    if (!await prefs.remove(_storageKey(token))) {
      throw StateError('Unable to clear the completed request. Check Transactions before another payment.');
    }
  }
}