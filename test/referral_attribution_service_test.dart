import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/referral_attribution_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  test('captures and normalizes the referral query code', () {
    final uri = Uri.parse('https://servicepay.ng/register?ref=%20sp-ab12%20');

    expect(ReferralCodeNormalizer.fromUri(uri), 'SP-AB12');
    expect(ReferralCodeNormalizer.fromUri(Uri.parse('/register')), isNull);
  });

  test('validates, persists and restores a referral attribution', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/auth/referral/validate');
      expect(request.url.queryParameters['code'], 'SP-AB12');
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'valid': true,
          'firstName': 'Ada',
        }),
        200,
      );
    });
    final service = ReferralAttributionService(client: client);

    final applied = await service.captureAndPersist(' sp-ab12 ');

    expect(applied?.code, 'SP-AB12');
    expect(applied?.firstName, 'Ada');

    final restored = await ReferralAttributionService(
      client: client,
    ).restore();
    expect(restored?.code, 'SP-AB12');
    expect(restored?.firstName, 'Ada');
  });

  test('invalid validation does not create an applied attribution', () async {
    final service = ReferralAttributionService(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, dynamic>{'success': true, 'valid': false}),
          200,
        ),
      ),
    );

    expect(await service.captureAndPersist('NOT-VALID'), isNull);
    expect(await service.restore(), isNull);
  });

  test('an explicit invalid link clears an older pending attribution',
      () async {
    final store = ReferralAttributionStore();
    await store.write(const ReferralAttribution(code: 'SP-OLD'));
    final service = ReferralAttributionService(
      store: store,
      client: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, dynamic>{'success': true, 'valid': false}),
          200,
        ),
      ),
    );

    expect(await service.captureAndPersist('SP-INVALID'), isNull);
    expect(await service.restore(), isNull);
  });

  test('refresh keeps the same cached attribution during validation outage',
      () async {
    final store = ReferralAttributionStore();
    await store.write(
      const ReferralAttribution(code: 'SP-CACHED', firstName: 'Ada'),
    );
    final service = ReferralAttributionService(
      store: store,
      validationTimeout: const Duration(milliseconds: 10),
      client: MockClient((_) => Future<http.Response>.delayed(
            const Duration(seconds: 1),
            () => http.Response('', 503),
          )),
    );

    final attribution = await service.captureAndPersist('SP-CACHED');
    expect(attribution?.code, 'SP-CACHED');
    expect(attribution?.firstName, 'Ada');
  });

  for (final statusCode in <int>[429, 503]) {
    test('HTTP $statusCode preserves the same cached attribution', () async {
      final store = ReferralAttributionStore();
      await store.write(const ReferralAttribution(code: 'SP-CACHED'));
      final service = ReferralAttributionService(
        store: store,
        client: MockClient((_) async => http.Response(
              jsonEncode(<String, dynamic>{
                'success': false,
                'valid': false,
              }),
              statusCode,
            )),
      );

      final attribution = await service.captureAndPersist('SP-CACHED');
      expect(attribution?.code, 'SP-CACHED');
      expect((await service.restore())?.code, 'SP-CACHED');
    });
  }
}
