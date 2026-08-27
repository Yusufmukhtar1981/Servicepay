import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

enum BiometricAuthenticationResult {
  success,
  cancelled,
  unavailable,
  failed,
}

class BiometricAvailability {
  const BiometricAvailability({
    required this.supported,
    this.types = const <BiometricType>[],
  });

  final bool supported;
  final List<BiometricType> types;

  String get label {
    if (!supported) return 'Not supported on this device';
    if (types.contains(BiometricType.face)) return 'Face authentication ready';
    if (types.contains(BiometricType.fingerprint)) {
      return 'Fingerprint authentication ready';
    }
    return 'Biometric authentication ready';
  }
}

class BiometricLoginCredential {
  const BiometricLoginCredential({
    required this.userId,
    required this.token,
    required this.role,
    required this.email,
  });

  final String userId;
  final String token;
  final String role;
  final String email;
}

abstract class BiometricDevice {
  Future<BiometricAvailability> availability();

  Future<BiometricAuthenticationResult> authenticate({
    required String reason,
  });
}

abstract class SecureCredentialStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

class LocalBiometricDevice implements BiometricDevice {
  LocalBiometricDevice([LocalAuthentication? authentication])
      : _authentication = authentication ?? LocalAuthentication();

  final LocalAuthentication _authentication;

  @override
  Future<BiometricAvailability> availability() async {
    try {
      final bool supported = await _authentication.isDeviceSupported();
      final bool canCheck = await _authentication.canCheckBiometrics;
      if (!supported || !canCheck) {
        return const BiometricAvailability(supported: false);
      }

      final List<BiometricType> types =
          await _authentication.getAvailableBiometrics();
      return BiometricAvailability(
        supported: types.isNotEmpty,
        types: types,
      );
    } catch (_) {
      return const BiometricAvailability(supported: false);
    }
  }

  @override
  Future<BiometricAuthenticationResult> authenticate({
    required String reason,
  }) async {
    try {
      final bool authenticated = await _authentication.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: true,
          useErrorDialogs: true,
        ),
      );
      return authenticated
          ? BiometricAuthenticationResult.success
          : BiometricAuthenticationResult.cancelled;
    } on PlatformException catch (error) {
      final String code = error.code.toLowerCase();
      if (code.contains('notavailable') ||
          code.contains('notenrolled') ||
          code.contains('passcodenotset') ||
          code.contains('lockedout')) {
        return BiometricAuthenticationResult.unavailable;
      }
      return BiometricAuthenticationResult.failed;
    } catch (_) {
      return BiometricAuthenticationResult.failed;
    }
  }
}

class PlatformSecureCredentialStore implements SecureCredentialStore {
  PlatformSecureCredentialStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions.biometric(
                enforceBiometrics: true,
                biometricType: AndroidBiometricType.strongBiometricOnly,
                biometricPromptTitle: 'ServicePay authentication',
                biometricPromptSubtitle:
                    'Confirm your identity to unlock secure credentials',
              ),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
                accessControlFlags: <AccessControlFlag>[
                  AccessControlFlag.biometryCurrentSet,
                ],
              ),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class PlatformSecureMetadataStore implements SecureCredentialStore {
  PlatformSecureMetadataStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class BiometricAuthService {
  BiometricAuthService({
    BiometricDevice? device,
    SecureCredentialStore? store,
    SecureCredentialStore? metadataStore,
  })  : _device = device ?? LocalBiometricDevice(),
        _credentialStore = store ?? PlatformSecureCredentialStore(),
        _metadataStore =
            metadataStore ?? store ?? PlatformSecureMetadataStore();

  static final BiometricAuthService instance = BiometricAuthService();

  static const String _loginOwnerKey = 'biometric.login.owner';
  static const String _loginTokenKey = 'biometric.login.token';
  static const String _loginRoleKey = 'biometric.login.role';
  static const String _loginEmailKey = 'biometric.login.email';
  static const String _loginEnabledKey = 'biometric.login.enabled';
  static const String _transactionOwnerKey = 'biometric.transaction.owner';
  static const String _transactionPinKey = 'biometric.transaction.pin';
  static const String _transactionEnabledKey = 'biometric.transaction.enabled';

  final BiometricDevice _device;
  final SecureCredentialStore _credentialStore;
  final SecureCredentialStore _metadataStore;

  Future<BiometricAvailability> availability() => _device.availability();

  Future<BiometricAuthenticationResult> authenticate({
    required String reason,
  }) =>
      _device.authenticate(reason: reason);

  Future<void> prepareForPasswordLogin(String userId) async {
    final String cleanUserId = userId.trim();
    final String loginOwner =
        (await _metadataStore.read(_loginOwnerKey) ?? '').trim();
    final String transactionOwner =
        (await _metadataStore.read(_transactionOwnerKey) ?? '').trim();
    if ((loginOwner.isNotEmpty && loginOwner != cleanUserId) ||
        (transactionOwner.isNotEmpty && transactionOwner != cleanUserId)) {
      await clearAll();
    }
  }

  Future<bool> hasLoginEnrollment() async {
    final String owner = await loginOwner();
    final String role =
        (await _metadataStore.read(_loginRoleKey) ?? '').trim().toUpperCase();
    return owner.isNotEmpty &&
        role == 'CUSTOMER' &&
        await _metadataStore.read(_loginEnabledKey) == 'true';
  }

  Future<String> loginOwner() async =>
      (await _metadataStore.read(_loginOwnerKey) ?? '').trim();

  Future<BiometricLoginCredential?> loginCredential() async {
    if (!await hasLoginEnrollment()) return null;
    final String userId = await loginOwner();
    final String token =
        (await _credentialStore.read(_loginTokenKey) ?? '').trim();
    final String role =
        (await _metadataStore.read(_loginRoleKey) ?? '').trim().toUpperCase();
    final String email =
        (await _metadataStore.read(_loginEmailKey) ?? '').trim();
    if (userId.isEmpty || token.isEmpty || role != 'CUSTOMER') return null;
    return BiometricLoginCredential(
      userId: userId,
      token: token,
      role: role,
      email: email,
    );
  }

  Future<void> enrollLogin({
    required String userId,
    required String token,
    required String role,
    required String email,
  }) async {
    final String cleanUserId = userId.trim();
    final String cleanToken = token.trim();
    final String cleanRole = role.trim().toUpperCase();
    if (cleanUserId.isEmpty || cleanToken.isEmpty || cleanRole != 'CUSTOMER') {
      throw StateError(
          'Biometric login is available to customer accounts only.');
    }
    await prepareForPasswordLogin(cleanUserId);
    await _credentialStore.write(_loginTokenKey, cleanToken);
    await _metadataStore.write(_loginOwnerKey, cleanUserId);
    await _metadataStore.write(_loginRoleKey, cleanRole);
    await _metadataStore.write(_loginEmailKey, email.trim());
    await _metadataStore.write(_loginEnabledKey, 'true');
  }

  Future<void> clearLoginEnrollment() async {
    await _credentialStore.delete(_loginTokenKey);
    for (final String key in <String>[
      _loginOwnerKey,
      _loginRoleKey,
      _loginEmailKey,
      _loginEnabledKey,
    ]) {
      await _metadataStore.delete(key);
    }
  }

  Future<bool> hasTransactionEnrollment(String userId) async {
    final String owner =
        (await _metadataStore.read(_transactionOwnerKey) ?? '').trim();
    return owner.isNotEmpty &&
        owner == userId.trim() &&
        await _metadataStore.read(_transactionEnabledKey) == 'true';
  }

  Future<String?> transactionPin(String userId) async {
    if (!await hasTransactionEnrollment(userId)) return null;
    final String? pin =
        (await _credentialStore.read(_transactionPinKey))?.trim();
    return pin != null && RegExp(r'^\d{4}$').hasMatch(pin) ? pin : null;
  }

  Future<void> enrollTransaction({
    required String userId,
    required String pin,
  }) async {
    final String cleanUserId = userId.trim();
    final String cleanPin = pin.trim();
    if (cleanUserId.isEmpty || !RegExp(r'^\d{4}$').hasMatch(cleanPin)) {
      throw StateError('A valid customer and transaction PIN are required.');
    }
    await prepareForPasswordLogin(cleanUserId);
    await _credentialStore.write(_transactionPinKey, cleanPin);
    await _metadataStore.write(_transactionOwnerKey, cleanUserId);
    await _metadataStore.write(_transactionEnabledKey, 'true');
  }

  Future<void> clearTransactionEnrollment() async {
    await _credentialStore.delete(_transactionPinKey);
    await _metadataStore.delete(_transactionOwnerKey);
    await _metadataStore.delete(_transactionEnabledKey);
  }

  Future<void> clearAll() async {
    await clearLoginEnrollment();
    await clearTransactionEnrollment();
  }
}
