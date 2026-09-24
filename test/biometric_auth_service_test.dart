import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:local_auth/local_auth.dart';
import 'package:local_auth_platform_interface/types/auth_messages.dart';
import 'package:biometric_storage/biometric_storage.dart';
import 'package:servicepay_app/biometric_settings_screen.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/services/biometric_auth_service.dart';

class FakeAuth extends LocalAuthentication {
  FakeAuth({
    this.supported = true,
    this.result = true,
    this.error,
    this.supportFuture,
  });
  final bool supported;
  final bool result;
  final Object? error;
  final Future<bool>? supportFuture;
  int supportChecks = 0;
  @override
  Future<bool> isDeviceSupported() {
    supportChecks++;
    return supportFuture ?? Future<bool>.value(supported);
  }

  @override
  Future<bool> get canCheckBiometrics async => supported;
  @override
  Future<bool> authenticate({
    required String localizedReason,
    Iterable<AuthMessages> authMessages = const <AuthMessages>[],
    AuthenticationOptions options = const AuthenticationOptions(),
  }) async {
    if (error != null) throw error!;
    return result;
  }
}

class FakeKeys implements BiometricKeyValueStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

class FakeCredentials implements BiometricCredentialStore {
  FakeCredentials(this.value);
  String? value;
  Object? readError;
  @override
  Future<String?> read() async {
    if (readError != null) throw readError!;
    return value;
  }

  @override
  Future<void> write(String credential) async => value = credential;
  @override
  Future<void> delete() async => value = null;
}

class ReplyClient extends http.BaseClient {
  ReplyClient(this.status, this.body);
  final int status;
  final String body;
  Uri? requested;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requested = request.url;
    return http.StreamedResponse(
      Stream.value(body.codeUnits),
      status,
      headers: const {'content-type': 'application/json'},
    );
  }
}

BiometricAuthService service({
  FakeAuth? auth,
  FakeKeys? keys,
  FakeCredentials? credentials,
  http.Client? client,
  List<String>? tokens,
}) {
  return BiometricAuthService(
    localAuthentication: auth ?? FakeAuth(),
    keyValueStore:
        keys ??
        (FakeKeys()..values['servicepay_biometric_device_id'] = 'device'),
    credentialStore: credentials ?? FakeCredentials('old-credential'),
    client:
        client ??
        ReplyClient(
          200,
          '{"token":"token","credential":"next","data":{"user":{"id":"u"}}}',
        ),
    sessionTokenWriter: tokens == null
        ? null
        : (value) async => tokens.add(value),
  );
}

void main() {
  test('PATCH settings persists a rotated credential before success', () async {
    final credentials = FakeCredentials('old-credential');
    final client = ReplyClient(200, '{"credential":"rotated-credential"}');
    final result = await service(credentials: credentials, client: client)
        .updateSettings(
          'session-token',
          loginEnabled: true,
          transactionEnabled: false,
        );
    expect(result, isTrue);
    expect(credentials.value, 'rotated-credential');
  });

  test(
    'successful Android-style biometric login rotates credential and session',
    () async {
      final tokens = <String>[];
      final credentials = FakeCredentials('old');
      final result = await service(
        credentials: credentials,
        tokens: tokens,
      ).login();
      expect(result?.token, 'token');
      expect(credentials.value, 'next');
      expect(tokens, ['token']);
    },
  );

  test(
    'biometric login accepts the production top-level user response',
    () async {
      final tokens = <String>[];
      final result = await service(
        credentials: FakeCredentials('old'),
        tokens: tokens,
        client: ReplyClient(
          200,
          '{"token":"token","credential":"next","user":{"id":"customer-1","role":"CUSTOMER"}}',
        ),
      ).login();
      expect(result?.user['id'], 'customer-1');
      expect(result?.user['role'], 'CUSTOMER');
      expect(tokens, ['token']);
    },
  );

  test(
    'cancel, unsupported hardware, and not enrolled use safe fallback',
    () async {
      final cancelled = FakeCredentials(
        'credential',
      )..readError = AuthException(AuthExceptionCode.userCanceled, 'cancelled');
      expect(await service(credentials: cancelled).login(), isNull);
      expect(await service(auth: FakeAuth(supported: false)).login(), isNull);
      expect(await service(keys: FakeKeys()).login(), isNull);
    },
  );

  test('platform credential failure is treated as cancellation', () async {
    final credentials = FakeCredentials('credential')
      ..readError = PlatformException(code: 'NotAvailable');
    final result = await service(credentials: credentials).login();
    expect(result, isNull);
  });

  test(
    'credential cancellation/invalidation clears local enrollment',
    () async {
      final keys = FakeKeys()
        ..values['servicepay_biometric_device_id'] = 'device';
      final credentials = FakeCredentials(
        'stale',
      )..readError = AuthException(AuthExceptionCode.userCanceled, 'cancelled');
      final instance = service(keys: keys, credentials: credentials);
      expect(await instance.credentialAfterAuthentication(), isNull);
      expect(await instance.isEnrolled(), isFalse);
      expect(credentials.value, isNull);
    },
  );

  test(
    'revoked server credential and reinstall loss clear enrollment',
    () async {
      final keys = FakeKeys()
        ..values['servicepay_biometric_device_id'] = 'device';
      final client = ReplyClient(401, '{"message":"revoked"}');
      final instance = service(keys: keys, client: client);
      expect(await instance.login(), isNull);
      expect(await instance.isEnrolled(), isFalse);

      final reinstallKeys = FakeKeys();
      expect(await service(keys: reinstallKeys).login(), isNull);
    },
  );

  test(
    'logout cleanup calls server and removes device and credential',
    () async {
      final keys = FakeKeys()
        ..values['servicepay_biometric_device_id'] = 'device';
      final credentials = FakeCredentials('credential');
      final client = ReplyClient(204, '');
      await service(
        keys: keys,
        credentials: credentials,
        client: client,
      ).revoke('token');
      expect(await keys.read('servicepay_biometric_device_id'), isNull);
      expect(credentials.value, isNull);
      expect(client.requested?.path, contains('/auth/biometric/logout'));
    },
  );

  testWidgets('password fallback and login remain usable at 320px large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.6)),
        child: MaterialApp(
          home: LoginScreen(
            biometricService: service(auth: FakeAuth(supported: false)),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);
  });

  testWidgets('biometric settings explains fallback at 320px large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.6)),
        child: MaterialApp(
          home: BiometricSettingsScreen(
            service: service(auth: FakeAuth(supported: false)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('password and transaction PIN'), findsOneWidget);
  });

  testWidgets('web biometric settings render without invoking native auth', (
    tester,
  ) async {
    final auth = FakeAuth(supportFuture: Completer<bool>().future);
    await tester.pumpWidget(
      MaterialApp(
        home: BiometricSettingsScreen(
          service: service(auth: auth),
          isWeb: true,
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(
      find.textContaining(
        'Biometric authentication is available in the Servicepay mobile app.',
      ),
      findsOneWidget,
    );
    expect(auth.supportChecks, 0);
  });

  testWidgets('biometric settings timeout stops spinner and offers retry', (
    tester,
  ) async {
    final auth = FakeAuth(supportFuture: Completer<bool>().future);
    await tester.pumpWidget(
      MaterialApp(
        home: BiometricSettingsScreen(
          service: service(auth: auth),
          loadTimeout: const Duration(milliseconds: 20),
          isWeb: false,
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 30));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Unable to load biometric settings.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });
}
