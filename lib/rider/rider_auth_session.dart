import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

class RiderAuthSession {
  static FutureOr<void> Function()? onUnauthorized;
  static bool _handlingUnauthorized = false;
  static const String canonicalTokenKey = 'auth_token';
  static const List<String> tokenKeys = <String>[
    canonicalTokenKey,
    'token',
    'access_token',
    'accessToken',
    'jwt_token',
    'jwt',
  ];

  static String normalizeToken(String? value) {
    return (value ?? '')
        .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
        .trim();
  }

  static Future<String> token({SharedPreferences? preferences}) async {
    final SharedPreferences prefs =
        preferences ?? await SharedPreferences.getInstance();
    for (final String key in tokenKeys) {
      final String value = normalizeToken(prefs.getString(key));
      if (value.isEmpty) continue;
      if (key != canonicalTokenKey ||
          prefs.getString(canonicalTokenKey) != value) {
        await prefs.setString(canonicalTokenKey, value);
      }
      for (final String legacyKey in tokenKeys) {
        if (legacyKey != canonicalTokenKey) {
          await prefs.remove(legacyKey);
        }
      }
      return value;
    }
    return '';
  }

  static Future<Map<String, String>> headers({
    SharedPreferences? preferences,
    bool json = false,
  }) async {
    final String value = await token(preferences: preferences);
    if (value.isEmpty) {
      throw const RiderAuthSessionException(
        'Rider login token was not found. Please sign in again.',
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      if (json) 'Content-Type': 'application/json',
      'Authorization': 'Bearer $value',
    };
  }

  static Future<void> clear({SharedPreferences? preferences}) async {
    final SharedPreferences prefs =
        preferences ?? await SharedPreferences.getInstance();
    for (final String key in tokenKeys) {
      await prefs.remove(key);
    }
  }

  static Future<void> handleUnauthorized() async {
    if (_handlingUnauthorized) return;
    _handlingUnauthorized = true;
    try {
      await clear();
      await onUnauthorized?.call();
    } finally {
      _handlingUnauthorized = false;
    }
  }
}

class RiderAuthSessionException implements Exception {
  const RiderAuthSessionException(this.message);
  final String message;

  @override
  String toString() => message;
}
