import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'pin_session_client.dart';
import 'session_store.dart';

class KekeSessionChanged implements Exception {}

/// Uses the same secure session and single-flight rotation as PIN management.
/// Keke's protect middleware rejects 401s before executing its controllers.
class KekeSessionApi {
  static Future<http.Response> get(Uri url,
          {Map<String, String>? headers}) =>
      _request('GET', url, headers: headers);

  static Future<http.Response> post(Uri url,
          {Map<String, String>? headers, Object? body,
          String? expectedCustomerKey}) =>
      _request('POST', url, headers: headers, body: body,
          expectedCustomerKey: expectedCustomerKey);

  static Future<http.Response> _request(String method, Uri url,
      {Map<String, String>? headers, Object? body,
      String? expectedCustomerKey}) async {
    final client = http.Client();
    final owner = _owner(await SessionStore.readToken());
    try {
      if (owner == null) throw PinSessionInvalid();
      if (expectedCustomerKey != null &&
          expectedCustomerKey != 'servicepay_keke_unresolved_$owner') {
        throw PinSessionInvalid();
      }
      final response = await PinSessionClient.authenticatedRequest(client, url,
          (token) {
        if (_owner(token) != owner) throw PinSessionInvalid();
        final authenticated = <String, String>{
          ...?headers,
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        };
        return (method == 'GET'
                ? client.get(url, headers: authenticated)
                : client.post(url, headers: authenticated, body: body))
            .timeout(const Duration(seconds: 30));
      });
      if (_owner(await SessionStore.readToken()) != owner) {
        throw KekeSessionChanged();
      }
      return response;
    } finally {
      client.close();
    }
  }

  static String? _owner(String? token) {
    try {
      final payload = jsonDecode(utf8.decode(base64Url.decode(
          base64Url.normalize(token!.split('.')[1])))) as Map;
      return (payload['id'] ?? payload['userId'] ?? payload['_id'])?.toString();
    } catch (_) {
      return null;
    }
  }

  static String errorMessage(Object error) {
    if (error is KekeSessionChanged) {
      return 'Your signed-in account changed. Reopen Keke to check ride status.';
    }
    if (error is PinSessionInvalid) {
      return 'Your session needs renewal. Please sign in again.';
    }
    if (error is TimeoutException) {
      return 'Connection timed out. Please check your connection.';
    }
    if (error is http.ClientException) {
      return 'Unable to connect. Please check your internet connection.';
    }
    if (error is StateError) {
      return 'Session renewal is temporarily unavailable. Please try again later.';
    }
    return 'Unable to load Keke information. Please try again.';
  }
}

/// A lost booking response is not permission to create another booking.
/// This local fence survives navigation/restart; it never stores credentials.
class KekeBookingGuard {
  static bool _reserving = false;
  static Future<String> currentKey() async {
    final token = await SessionStore.readToken();
    try {
      final payload = jsonDecode(utf8.decode(base64Url.decode(
          base64Url.normalize(token!.split('.')[1])))) as Map;
      final id = payload['id'] ?? payload['userId'] ?? payload['_id'];
      if (id == null || '$id'.isEmpty) throw const FormatException();
      return 'servicepay_keke_unresolved_$id';
    } catch (_) {
      throw PinSessionInvalid();
    }
  }

  static Future<bool> isUnresolved() async =>
      (await SharedPreferences.getInstance()).containsKey(await currentKey());

  static Future<String> reserve() async {
    if (_reserving) throw StateError('A booking is already being prepared.');
    _reserving = true;
    try {
    final key = await currentKey();
    final prefs = await SharedPreferences.getInstance();
    if (prefs.containsKey(key)) {
      throw StateError('A previous booking is awaiting confirmation.');
    }
    final value = DateTime.now().toUtc().toIso8601String();
    if (!await prefs.setString(key, value)) {
      throw StateError('Unable to save booking safety state.');
    }
    await prefs.reload();
    if (prefs.getString(key) != value) {
      throw StateError('Unable to save booking safety state.');
    }
    return key;
    } finally {
      _reserving = false;
    }
  }

  static Future<void> resolved(String key) async {
    await (await SharedPreferences.getInstance()).remove(key);
  }
}
