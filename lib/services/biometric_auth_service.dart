import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'package:http/http.dart' as http;
import 'package:biometric_storage/biometric_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'session_store.dart';

class BiometricAuthResult {
  const BiometricAuthResult({required this.token, required this.user});
  final String token;
  final Map<String, dynamic> user;
}

/// Small adapters keep native secure stores replaceable in unit tests.
abstract interface class BiometricKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class _SecureKeyValueStore implements BiometricKeyValueStore {
  _SecureKeyValueStore(this._storage);
  final FlutterSecureStorage _storage;
  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

abstract interface class BiometricCredentialStore {
  Future<String?> read();
  Future<void> write(String credential);
  Future<void> delete();
}

typedef SessionTokenWriter = Future<void> Function(String token);

class _BiometricStorageCredentialStore implements BiometricCredentialStore {
  _BiometricStorageCredentialStore(this._file);
  final BiometricStorageFile _file;
  @override
  Future<String?> read() => _file.read();
  @override
  Future<void> write(String credential) => _file.write(credential);
  @override
  Future<void> delete() => _file.delete();
}

class BiometricDeviceSettings {
  const BiometricDeviceSettings({
    required this.deviceId,
    required this.loginEnabled,
    required this.transactionEnabled,
  });
  final String? deviceId;
  final bool loginEnabled;
  final bool transactionEnabled;
}

/// Biometric credentials are opaque server credentials. The value is only
/// readable after a successful native biometric prompt.
class BiometricAuthService {
  BiometricAuthService({
    LocalAuthentication? localAuthentication,
    FlutterSecureStorage? storage,
    http.Client? client,
    BiometricKeyValueStore? keyValueStore,
    BiometricCredentialStore? credentialStore,
    SessionTokenWriter? sessionTokenWriter,
  }) : _auth = localAuthentication ?? LocalAuthentication(),
       _client = client ?? http.Client(),
       _keyValueStore =
           keyValueStore ??
           _SecureKeyValueStore(
             storage ??
                 const FlutterSecureStorage(
                   aOptions: AndroidOptions(encryptedSharedPreferences: true),
                   iOptions: IOSOptions(
                     accessibility: KeychainAccessibility.first_unlock,
                   ),
                 ),
           ),
       _credentialStore = credentialStore,
       _sessionTokenWriter = sessionTokenWriter ?? SessionStore.writeToken;

  static const baseUrl = 'https://api.servicepay.ng/api';
  static const _deviceKey = 'servicepay_biometric_device_id';
  static const _credentialKey = 'servicepay_biometric_credential';
  static const _enrollmentMarker = 'servicepay_biometric_enrolled';
  final LocalAuthentication _auth;
  final http.Client _client;
  final BiometricKeyValueStore _keyValueStore;
  BiometricCredentialStore? _credentialStore;
  final SessionTokenWriter _sessionTokenWriter;
  String? _lastCredential;

  Future<bool> isSupported() async {
    try {
      return await _auth.isDeviceSupported() && await _auth.canCheckBiometrics;
    } on PlatformException {
      return false;
    }
  }

  static Future<bool> hasEnrollmentMarker() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(_enrollmentMarker) == true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> authenticate({String reason = 'Verify your identity'}) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: false,
          useErrorDialogs: true,
        ),
      );
    } on PlatformException {
      return false;
    }
  }

  Future<String?> deviceId() => _keyValueStore.read(_deviceKey);
  Future<BiometricCredentialStore> _store() async {
    return _credentialStore ??= _BiometricStorageCredentialStore(
      await BiometricStorage().getStorage(
        _credentialKey,
        options: StorageFileInitOptions(
          authenticationRequired: true,
          authenticationValidityDurationSeconds: -1,
          androidBiometricOnly: true,
          darwinBiometricOnly: true,
        ),
        promptInfo: const PromptInfo(
          androidPromptInfo: AndroidPromptInfo(
            title: 'Verify your identity',
            negativeButton: 'Cancel',
          ),
          iosPromptInfo: IosPromptInfo(accessTitle: 'Verify your identity'),
        ),
      ),
    );
  }

  /// Reading the opaque credential always invokes the native access-control
  /// prompt. It is never backed by flutter_secure_storage.
  Future<String?> credentialAfterAuthentication() async {
    try {
      return await (await _store()).read();
    } on AuthException catch (_) {
      await clearLocalEnrollment();
      return null;
    } on PlatformException catch (_) {
      await clearLocalEnrollment();
      return null;
    }
  }

  Future<void> rotateCredential(String credential) async {
    if (credential.trim().isEmpty) return;
    await (await _store()).write(credential);
  }

  Future<bool> isEnrolled() async => (await deviceId()) != null;

  Future<void> clearLocalEnrollment() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_enrollmentMarker);
    } catch (_) {
      // Tests and unsupported embedders may not register shared preferences.
    }
    await _keyValueStore.delete(_deviceKey);
    try {
      await (await _store()).delete();
    } catch (_) {
      // Invalidated keystore entries are already safely unusable.
    }
  }

  Future<BiometricAuthResult?> login() async {
    if (!await isSupported() || !await isEnrolled()) return null;
    final id = await _keyValueStore.read(_deviceKey);
    final credential = await credentialAfterAuthentication();
    if (id == null || credential == null) return null;
    final response = await _client.post(
      Uri.parse('$baseUrl/auth/biometric/login'),
      headers: const {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: jsonEncode({'deviceId': id, 'credential': credential}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 401 || response.statusCode == 404) {
        await clearLocalEnrollment();
      }
      return null;
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final nextCredential = body['credential']?.toString();
    if (nextCredential == null || nextCredential.isEmpty) {
      await clearLocalEnrollment();
      return null;
    }
    await rotateCredential(nextCredential);
    final data = body['data'] is Map
        ? Map<String, dynamic>.from(body['data'])
        : body;
    final token = (body['token'] ?? body['accessToken'] ?? data['token'] ?? '')
        .toString();
    if (token.isEmpty) return null;
    await _sessionTokenWriter(token);
    final user = data['user'] is Map
        ? Map<String, dynamic>.from(data['user'])
        : <String, dynamic>{};
    return BiometricAuthResult(token: token, user: user);
  }

  /// Enroll after password authentication. The password itself is never
  /// accepted by this service or persisted.
  Future<bool> enroll(String passwordJwt) async {
    if (!await isSupported()) {
      return false;
    }
    final id = await _newDeviceId();
    final response = await _client.post(
      Uri.parse('$baseUrl/auth/biometric/enroll'),
      headers: {
        'Authorization': 'Bearer $passwordJwt',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'deviceId': id}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) return false;
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final credential = body['credential']?.toString();
    if (credential == null || credential.isEmpty) return false;
    final enrolledDeviceId = body['deviceId']?.toString();
    if (enrolledDeviceId == null || enrolledDeviceId.isEmpty) return false;
    try {
      // This write is the sole enrollment prompt. The keystore file is
      // configured for authentication on every access.
      await rotateCredential(credential);
      _lastCredential = credential;
      await _keyValueStore.write(_deviceKey, enrolledDeviceId);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_enrollmentMarker, true);
      return true;
    } catch (_) {
      await _revokeServerDevice(passwordJwt, enrolledDeviceId);
      await clearLocalEnrollment();
      return false;
    }
  }

  Future<String> _newDeviceId() async {
    final random = Random.secure();
    return base64Url.encode(List<int>.generate(24, (_) => random.nextInt(256)));
  }

  Future<void> revoke(String token) async {
    final id = await _keyValueStore.read(_deviceKey);
    if (id != null) {
      await _client.post(
        Uri.parse('$baseUrl/auth/biometric/logout'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'deviceId': id}),
      );
    }
    await clearLocalEnrollment();
  }

  Future<BiometricDeviceSettings?> settings(String token) async {
    final id = await deviceId();
    if (id == null || id.isEmpty) return null;
    final response = await _client.get(
      Uri.parse(
        '$baseUrl/auth/biometric/devices/current?deviceId=${Uri.encodeQueryComponent(id)}',
      ),
      headers: {'Authorization': 'Bearer $token', 'Accept': 'application/json'},
    );
    if (response.statusCode == 404) {
      await clearLocalEnrollment();
      return null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) return null;
    final raw = jsonDecode(response.body);
    final envelope = Map<String, dynamic>.from(raw as Map);
    final data = envelope['device'] is Map
        ? Map<String, dynamic>.from(envelope['device'])
        : envelope['data'] is Map
        ? Map<String, dynamic>.from(envelope['data'])
        : envelope;
    return BiometricDeviceSettings(
      deviceId: data['deviceId']?.toString(),
      loginEnabled: data['loginEnabled'] == true,
      transactionEnabled: data['transactionEnabled'] == true,
    );
  }

  Future<bool> updateSettings(
    String token, {
    required bool loginEnabled,
    required bool transactionEnabled,
  }) async {
    final id = await deviceId();
    if (id == null || id.isEmpty) return false;
    String? credential;
    if (loginEnabled || transactionEnabled) {
      credential = _lastCredential ?? await credentialAfterAuthentication();
      if (credential == null || credential.isEmpty) return false;
    }
    final response = await _client.patch(
      Uri.parse('$baseUrl/auth/biometric/devices/${Uri.encodeComponent(id)}'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: jsonEncode({
        'loginEnabled': loginEnabled,
        'transactionEnabled': transactionEnabled,
        if (credential != null) 'credential': credential,
      }),
    );
    _lastCredential = null;
    if (response.statusCode >= 200 && response.statusCode < 300) {
      Map<String, dynamic> envelope = <String, dynamic>{};
      try {
        final raw = jsonDecode(response.body);
        if (raw is Map) envelope = Map<String, dynamic>.from(raw);
      } catch (_) {}
      final rotated = envelope['credential']?.toString() ??
          (envelope['data'] is Map
              ? (envelope['data'] as Map)['credential']?.toString()
              : null);
      if (rotated != null && rotated.isNotEmpty) {
        try {
          await rotateCredential(rotated);
        } catch (_) {
          await _revokeServerDevice(token, id);
          await clearLocalEnrollment();
          return false;
        }
      }
    }
    if (response.statusCode == 404) {
      await clearLocalEnrollment();
    }
    return response.statusCode >= 200 && response.statusCode < 300;
  }

  Future<void> _revokeServerDevice(String token, String id) async {
    try {
      await _client.post(
        Uri.parse('$baseUrl/auth/biometric/logout'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'deviceId': id}),
      );
    } catch (_) {
      // Enrollment failure must never leave local credentials enabled.
    }
  }
}
