import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:servicepay_app/management/management_api.dart';

void main() {
  group('ManagementApi', () {
    test('serializes inclusive custom calendar dates as YYYY-MM-DD', () {
      const period = ManagementPeriod(
        'CUSTOM',
        from: null,
        to: null,
      );
      expect(period.query(), {'period': 'CUSTOM'});
      final selected = ManagementPeriod(
        'CUSTOM',
        from: DateTime(2025, 2, 3),
        to: DateTime(2025, 2, 9),
      );
      expect(selected.query(), {
        'period': 'CUSTOM',
        'from': '2025-02-03',
        'to': '2025-02-09',
      });
    });

    test('converts UTC target startsAt into the correct Lagos calendar day', () {
      final startsAt = DateTime.parse('2025-06-01T23:00:00.000Z');
      final lagos = ManagementPeriod.lagosCalendarDate(startsAt);
      expect(lagos!.hour, 0);
      expect(lagos.day, 2);
      expect(ManagementPeriod.dateString(lagos), '2025-06-02');
    });

    test('decodes the standard success envelope and preserves query scope', () async {
      Uri? requested;
      final api = ManagementApi(
        tokenReader: () async => 'test-token',
        client: MockClient((request) async {
          requested = request.url;
          expect(request.headers['authorization'], 'Bearer test-token');
          return http.Response(
            jsonEncode({
              'success': true,
              'data': {
                'scope': {'role': 'STATE_MANAGER'},
                'kpis': {'totalCustomers': 17},
              },
            }),
            200,
          );
        }),
      );

      final result = await api.get('analytics/overview', {
        'period': 'THIS_MONTH',
        'teamId': 'authorized-team',
      });

      expect(requested!.path, endsWith('/management/analytics/overview'));
      expect(requested!.queryParameters['period'], 'THIS_MONTH');
      expect(requested!.queryParameters['teamId'], 'authorized-team');
      expect(result['kpis']['totalCustomers'], 17);
    });

    test('uses backend message for envelope errors', () async {
      final api = ManagementApi(
        tokenReader: () async => 'test-token',
        client: MockClient((_) async => http.Response(
          jsonEncode({'success': false, 'message': 'Scope is not authorized'}),
          403,
        )),
      );

      expect(
        () => api.get('analytics/teams'),
        throwsA(isA<ManagementApiException>().having(
          (e) => e.message, 'message', 'Scope is not authorized')),
      );
    });

    test('downloads scoped report bytes from analytics export endpoint', () async {
      Uri? requested;
      final api = ManagementApi(
        tokenReader: () async => 'test-token',
        client: MockClient((request) async {
          requested = request.url;
          return http.Response.bytes([0x53, 0x50, 0x01], 200);
        }),
      );
      final bytes = await api.export({
        'period': 'LAST_30_DAYS',
        'teamId': 'assigned-team',
        'format': 'csv',
        'status': 'SUCCESSFUL',
      });

      expect(requested!.path, endsWith('/management/analytics/export'));
      expect(requested!.queryParameters['teamId'], 'assigned-team');
      expect(requested!.queryParameters['format'], 'csv');
      expect(bytes, [0x53, 0x50, 0x01]);
    });

    test('requires an authenticated session without making a request', () async {
      var requested = false;
      final api = ManagementApi(
        tokenReader: () async => null,
        client: MockClient((_) async {
          requested = true;
          return http.Response('{}', 200);
        }),
      );

      expect(() => api.get('analytics/overview'),
          throwsA(isA<ManagementApiException>().having(
              (e) => e.statusCode, 'statusCode', 401)));
      await Future<void>.delayed(Duration.zero);
      expect(requested, isFalse);
    });
  });
}
