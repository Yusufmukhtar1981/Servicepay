import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'session_store.dart';

class PinSessionInvalid implements Exception {}

/// Only PIN management uses this retry helper. Financial purchases never do.
class PinSessionClient {
  static Future<bool>? _refreshing;
  static Future<void> revoke(http.Client client, Uri endpoint) async {
    final token = await SessionStore.readRefreshToken();
    if (token == null || token.isEmpty) return;
    try {
      await client.post(endpoint,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': token}),
      ).timeout(const Duration(seconds: 3));
    } catch (_) {
      // Local sign-out always completes even if the network is unavailable.
    }
  }
  static String? _subject(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return null;
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
      return (payload['id'] ?? payload['userId'] ?? payload['_id'])?.toString();
    } catch (_) {
      return null;
    }
  }
  static Future<http.Response> post(http.Client client, Uri endpoint,
      Map<String, dynamic> body) async {
    Future<http.Response> send(String token) => client.post(endpoint,
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 30));
    final token = await SessionStore.readToken();
    if (token == null || token.isEmpty) throw PinSessionInvalid();
    final response = await send(token);
    if (response.statusCode != 401) return response;
    final current = await SessionStore.readToken();
    if (current != null && current != token) {
      if (_subject(current) != _subject(token)) throw PinSessionInvalid();
      final retried = await send(current);
      if (retried.statusCode == 401) throw PinSessionInvalid();
      return retried;
    }
    // Share one rotation across callers, but replay the PIN request only once.
    final future = _refreshing ??= _refresh(client, endpoint, token);
    bool refreshed;
    try {
      refreshed = await future;
    } finally {
      if (identical(_refreshing, future)) _refreshing = null;
    }
    if (!refreshed) throw PinSessionInvalid();
    final newToken = await SessionStore.readToken();
    if (newToken == null || newToken.isEmpty) throw PinSessionInvalid();
    final retried = await send(newToken);
    if (retried.statusCode == 401) throw PinSessionInvalid();
    return retried;
  }

  static Future<bool> _refresh(http.Client client, Uri endpoint, String token) async {
    final credential = await SessionStore.readRefreshToken();
    if (credential == null || credential.isEmpty) return false;
    if (_subject(credential) != _subject(token)) return false;
    final response = await client.post(
      endpoint.replace(path: '/api/auth/refresh'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': credential}),
    ).timeout(const Duration(seconds: 20));
    if (response.statusCode == 401 || response.statusCode == 403) return false;
    if (response.statusCode != 200) throw StateError('Session refresh is temporarily unavailable.');
    final data = jsonDecode(response.body);
    if (data is! Map || data['success'] != true ||
        data['token'] is! String || data['refreshToken'] is! String ||
        (data['token'] as String).isEmpty || (data['refreshToken'] as String).isEmpty) {
      throw StateError('Invalid session refresh response.');
    }
    if (_subject(data['token']) != _subject(token)) return false;
    return SessionStore.writeSession(data['token'],
      refreshToken: data['refreshToken'], expectedAccessToken: token);
  }
}
