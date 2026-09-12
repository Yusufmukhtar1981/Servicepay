import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/services/customer_feature_config_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  test('maps enabled, hidden, disabled, and maintenance features', () async {
    final MockClient client = MockClient((http.Request request) async {
      expect(request.url.path, '/api/settings/customer/features');
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'version': '42',
          'features': <Map<String, dynamic>>[
            <String, dynamic>{
              'key': 'AIRTIME',
              'enabled': true,
              'effectiveEnabled': true,
              'visible': true,
            },
            <String, dynamic>{
              'key': 'DATA',
              'enabled': false,
              'effectiveEnabled': false,
              'visible': true,
            },
            <String, dynamic>{
              'key': 'MARKETPLACE',
              'enabled': true,
              'effectiveEnabled': true,
              'visible': false,
            },
            <String, dynamic>{
              'key': 'WITHDRAWAL',
              'enabled': true,
              'effectiveEnabled': true,
              'visible': true,
              'maintenanceMode': true,
              'title': 'Withdrawal maintenance',
              'message': 'Back shortly.',
              'expectedReturnAt': '2030-01-01T00:00:00Z',
            },
          ],
        }),
        200,
      );
    });

    final CustomerFeatureConfiguration configuration =
        await CustomerFeatureConfigurationService(client: client).load();

    expect(configuration.forKey('AIRTIME').effectiveEnabled, isTrue);
    expect(configuration.forKey('DATA').isBlocked, isTrue);
    expect(configuration.forKey('MARKETPLACE').visible, isFalse);
    expect(configuration.forKey('WITHDRAWAL').maintenanceMode, isTrue);
    expect(configuration.forKey('WITHDRAWAL').message, 'Back shortly.');
    expect(configuration.version, '42');
  });

  test('API failure preserves cached state and safe defaults', () async {
    final MockClient successfulClient = MockClient(
      (_) async => http.Response(
        jsonEncode(<String, dynamic>{
          'features': <Map<String, dynamic>>[
            <String, dynamic>{
              'key': 'DATA',
              'enabled': false,
              'effectiveEnabled': false,
              'visible': true,
            },
          ],
        }),
        200,
      ),
    );
    final CustomerFeatureConfigurationService service =
        CustomerFeatureConfigurationService(client: successfulClient);
    await service.load();

    final CustomerFeatureConfiguration fallback =
        await CustomerFeatureConfigurationService(
      client: MockClient((_) async => http.Response('', 503)),
    ).load();

    expect(fallback.forKey('DATA').effectiveEnabled, isFalse);
    expect(fallback.forKey('AIRTIME').effectiveEnabled, isTrue);
    expect(fallback.forKey('AIRTIME').visible, isTrue);
    expect(fallback.features.length,
        CustomerFeatureConfigurationService.canonicalKeys.length);
  });

  test('newly hidden server state overrides a previously cached state',
      () async {
    await CustomerFeatureConfigurationService(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, dynamic>{
            'version': '1',
            'features': <Map<String, dynamic>>[
              <String, dynamic>{
                'key': 'MARKETPLACE',
                'enabled': true,
                'effectiveEnabled': true,
                'visible': true,
              },
            ],
          }),
          200,
        ),
      ),
    ).load();

    final CustomerFeatureConfiguration configuration =
        await CustomerFeatureConfigurationService(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, dynamic>{
            'version': '2',
            'features': <Map<String, dynamic>>[
              <String, dynamic>{
                'key': 'MARKETPLACE',
                'enabled': true,
                'effectiveEnabled': true,
                'visible': false,
              },
            ],
          }),
          200,
        ),
      ),
    ).load();

    expect(configuration.forKey('MARKETPLACE').visible, isFalse);
    expect(configuration.forKey('MARKETPLACE').effectiveEnabled, isTrue);
  });

  test('wallet funding is controlled independently from wallet', () async {
    final MockClient client = MockClient(
      (_) async => http.Response(
        jsonEncode(<String, dynamic>{
          'features': <Map<String, dynamic>>[
            <String, dynamic>{
              'key': 'WALLET',
              'enabled': true,
              'effectiveEnabled': true,
              'visible': true,
            },
            <String, dynamic>{
              'key': 'walletFunding',
              'enabled': false,
              'effectiveEnabled': false,
              'visible': false,
            },
          ],
        }),
        200,
      ),
    );

    final CustomerFeatureConfiguration configuration =
        await CustomerFeatureConfigurationService(client: client).load();

    expect(
      configuration.forKey('walletFunding').effectiveEnabled,
      isFalse,
    );
    expect(configuration.forKey('WALLET_FUNDING').visible, isFalse);
    expect(configuration.forKey('WALLET').effectiveEnabled, isTrue);
    expect(configuration.forKey('WALLET').visible, isTrue);
    expect(
      CustomerFeatureConfigurationService.normalizeKey('walletFunding'),
      'WALLET_FUNDING',
    );

    final CustomerFeatureConfiguration cached =
        await CustomerFeatureConfigurationService(
      client: MockClient((_) async => http.Response('', 503)),
    ).load();
    expect(cached.forKey('WALLET_FUNDING').effectiveEnabled, isFalse);
    expect(cached.forKey('WALLET_FUNDING').visible, isFalse);
    expect(cached.forKey('WALLET').effectiveEnabled, isTrue);
  });

  test('fresh cached disabled state is retained during a brief outage',
      () async {
    final DateTime fetchedAt = DateTime(2026, 1, 1, 12);
    await CustomerFeatureConfigurationService(
      now: () => fetchedAt,
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, dynamic>{
            'features': <Map<String, dynamic>>[
              <String, dynamic>{
                'key': 'DATA',
                'enabled': false,
                'effectiveEnabled': false,
                'visible': true,
              },
            ],
          }),
          200,
        ),
      ),
    ).load();

    final CustomerFeatureConfiguration fallback =
        await CustomerFeatureConfigurationService(
      now: () => fetchedAt.add(const Duration(minutes: 5)),
      client: MockClient((_) async => http.Response('', 503)),
    ).load();

    expect(fallback.fromCache, isTrue);
    expect(fallback.forKey('DATA').effectiveEnabled, isFalse);
    expect(fallback.forKey('DATA').visible, isTrue);
  });

  test('stale cached restrictions fail open to production defaults', () async {
    final SharedPreferences preferences =
        await SharedPreferences.getInstance();
    await preferences.setString(
      'customer_feature_configuration_v1',
      jsonEncode(<String, dynamic>{
        'cacheVersion': CustomerFeatureConfigurationService.cacheSchemaVersion,
        'cachedAt': DateTime(2026, 1, 1).toIso8601String(),
        'version': 'old',
        'features': <Map<String, dynamic>>[
          <String, dynamic>{
            'key': 'DATA',
            'enabled': false,
            'effectiveEnabled': false,
            'visible': true,
          },
          <String, dynamic>{
            'key': 'WITHDRAWAL',
            'enabled': true,
            'effectiveEnabled': true,
            'visible': true,
            'maintenanceMode': true,
            'message': 'Old maintenance notice',
          },
          <String, dynamic>{
            'key': 'MARKETPLACE',
            'enabled': true,
            'effectiveEnabled': true,
            'visible': false,
          },
        ],
      }),
    );

    final CustomerFeatureConfiguration fallback =
        await CustomerFeatureConfigurationService(
      now: () => DateTime(2026, 1, 1).add(const Duration(hours: 1)),
      client: MockClient((_) async => http.Response('', 503)),
    ).load();

    expect(fallback.fromCache, isTrue);
    expect(fallback.forKey('DATA').effectiveEnabled, isTrue);
    expect(fallback.forKey('WITHDRAWAL').maintenanceMode, isFalse);
    expect(fallback.forKey('WITHDRAWAL').isBlocked, isFalse);
    expect(fallback.forKey('MARKETPLACE').visible, isTrue);
    expect(fallback.forKey('MARKETPLACE').isBlocked, isFalse);
  });

  test('missing feature entries never disable production services', () async {
    final CustomerFeatureConfiguration configuration =
        await CustomerFeatureConfigurationService(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, dynamic>{
            'features': <Map<String, dynamic>>[
              <String, dynamic>{
                'key': 'NOT_A_REAL_FEATURE',
                'enabled': false,
                'visible': false,
              },
            ],
          }),
          200,
        ),
      ),
    ).load();

    expect(
        configuration.forKey('SERVICEPAY_TRANSFER').effectiveEnabled, isTrue);
    expect(configuration.forKey('SERVICEPAY_TRANSFER').visible, isTrue);
    expect(configuration.forKey('NOT_A_REAL_FEATURE').effectiveEnabled, isTrue);
    expect(configuration.forKey('NOT_A_REAL_FEATURE').visible, isTrue);
  });
}
