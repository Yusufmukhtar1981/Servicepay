import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:servicepay_app/services/biometric_auth_service.dart';
import 'package:servicepay_app/services/transaction_authorization_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MemoryStore implements SecureCredentialStore {
  final Map<String, String> values = <String, String>{};

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }
}

class _InvalidatingStore extends _MemoryStore {
  bool throwOnRead = false;

  @override
  Future<String?> read(String key) {
    if (throwOnRead) {
      throw StateError('Biometric key invalidated');
    }
    return super.read(key);
  }
}

class _FakeDevice implements BiometricDevice {
  _FakeDevice({
    this.supported = true,
    this.result = BiometricAuthenticationResult.success,
  });

  bool supported;
  BiometricAuthenticationResult result;
  int authenticationCount = 0;

  @override
  Future<BiometricAuthenticationResult> authenticate({
    required String reason,
  }) async {
    authenticationCount += 1;
    return result;
  }

  @override
  Future<BiometricAvailability> availability() async => BiometricAvailability(
        supported: supported,
        types:
            supported ? <BiometricType>[BiometricType.fingerprint] : const [],
      );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('login enrollment is customer-only and account-bound', () async {
    final _MemoryStore store = _MemoryStore();
    final BiometricAuthService service = BiometricAuthService(
      device: _FakeDevice(),
      store: store,
    );

    await service.enrollLogin(
      userId: 'customer-a',
      token: 'token-a',
      role: 'CUSTOMER',
      email: 'a@example.com',
    );
    expect(await service.hasLoginEnrollment(), isTrue);
    expect((await service.loginCredential())?.userId, 'customer-a');

    await service.prepareForPasswordLogin('customer-b');
    expect(await service.hasLoginEnrollment(), isFalse);
  });

  test('transaction credential cannot be read by another account', () async {
    final BiometricAuthService service = BiometricAuthService(
      device: _FakeDevice(),
      store: _MemoryStore(),
    );
    await service.enrollTransaction(userId: 'customer-a', pin: '2468');

    expect(await service.transactionPin('customer-a'), '2468');
    expect(await service.transactionPin('customer-b'), isNull);
  });

  testWidgets('successful biometric authorization returns PIN once',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_id': 'customer-a',
    });
    final _FakeDevice device = _FakeDevice();
    final BiometricAuthService service = BiometricAuthService(
      device: device,
      store: _MemoryStore(),
    );
    await service.enrollTransaction(userId: 'customer-a', pin: '2468');
    int fallbackCount = 0;
    String? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) {
            return TextButton(
              onPressed: () async {
                result = await TransactionAuthorizationService.request(
                  context: context,
                  biometricService: service,
                  pinFallback: () async {
                    fallbackCount += 1;
                    return '1357';
                  },
                );
              },
              child: const Text('Authorize'),
            );
          },
        ),
      ),
    );
    await tester.tap(find.text('Authorize'));
    await tester.pumpAndSettle();

    expect(result, '2468');
    expect(device.authenticationCount, 1);
    expect(fallbackCount, 0);
  });

  testWidgets('cancelled biometrics uses PIN fallback exactly once',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_id': 'customer-a',
    });
    final _FakeDevice device = _FakeDevice(
      result: BiometricAuthenticationResult.cancelled,
    );
    final BiometricAuthService service = BiometricAuthService(
      device: device,
      store: _MemoryStore(),
    );
    await service.enrollTransaction(userId: 'customer-a', pin: '2468');
    int fallbackCount = 0;
    String? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () async {
              result = await TransactionAuthorizationService.request(
                context: context,
                biometricService: service,
                pinFallback: () async {
                  fallbackCount += 1;
                  return '1357';
                },
              );
            },
            child: const Text('Authorize'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Authorize'));
    await tester.pumpAndSettle();

    expect(result, '1357');
    expect(fallbackCount, 1);
  });

  testWidgets('unavailable biometrics clears enrollment and falls back',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_id': 'customer-a',
    });
    final _FakeDevice device = _FakeDevice(supported: false);
    final BiometricAuthService service = BiometricAuthService(
      device: device,
      store: _MemoryStore(),
    );
    await service.enrollTransaction(userId: 'customer-a', pin: '2468');

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () => TransactionAuthorizationService.request(
              context: context,
              biometricService: service,
              pinFallback: () async => '1357',
            ),
            child: const Text('Authorize'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Authorize'));
    await tester.pumpAndSettle();

    expect(await service.hasTransactionEnrollment('customer-a'), isFalse);
  });

  testWidgets('invalidated protected credential clears and falls back once',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_id': 'customer-a',
    });
    final _InvalidatingStore credentials = _InvalidatingStore();
    final BiometricAuthService service = BiometricAuthService(
      device: _FakeDevice(),
      store: credentials,
      metadataStore: _MemoryStore(),
    );
    await service.enrollTransaction(userId: 'customer-a', pin: '2468');
    credentials.throwOnRead = true;
    int fallbackCount = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () => TransactionAuthorizationService.request(
              context: context,
              biometricService: service,
              pinFallback: () async {
                fallbackCount += 1;
                return '1357';
              },
            ),
            child: const Text('Authorize'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Authorize'));
    await tester.pumpAndSettle();

    expect(fallbackCount, 1);
    expect(await service.hasTransactionEnrollment('customer-a'), isFalse);
  });
}
