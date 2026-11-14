import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/business_network/business_network_api.dart';

void main() {
  group('BusinessNetworkApi', () {
    test('sends bearer auth and unwraps authenticated API data', () async {
      final client = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/business-network/me');
        expect(request.headers['authorization'], 'Bearer customer-token');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada'}
            }
          }),
          200,
        );
      });
      final api = BusinessNetworkApi(
        client: client,
        tokenProvider: () async => 'customer-token',
        baseUrl: 'https://test.servicepay.invalid/api',
      );
      final data = await api.get('me') as Map;
      expect((data['customer'] as Map)['fullName'], 'Ada');
      client.close();
    });

    test('default base URL honors SERVICEPAY_API_BASE_URL', () async {
      const configuredBase = String.fromEnvironment(
        'SERVICEPAY_API_BASE_URL',
        defaultValue: 'https://api.servicepay.ng/api',
      );
      final client = MockClient((request) async {
        expect(request.url, Uri.parse('$configuredBase/business-network/me'));
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'features': {}}
          }),
          200,
        );
      });
      final api = BusinessNetworkApi(
        client: client,
        tokenProvider: () async => 'customer-token',
      );
      await api.get('me');
      client.close();
    });

    test('surfaces server authorization errors without fabricating data',
        () async {
      final client = MockClient((_) async => http.Response(
            jsonEncode({
              'success': false,
              'message': 'Profile is suspended',
              'code': 'SUSPENDED'
            }),
            403,
          ));
      final api = BusinessNetworkApi(
        client: client,
        tokenProvider: () async => 'valid-session-token',
        baseUrl: 'https://test.servicepay.invalid/api',
      );
      await expectLater(
          api.get('dashboard/agent'), throwsA(isA<BusinessNetworkException>()));
      client.close();
    });
  });
}
