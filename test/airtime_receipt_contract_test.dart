import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/services/api_service.dart';
import 'package:servicepay_app/transactions_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('airtime details and PDF reads use encoded identity and session auth',
      () async {
    SharedPreferences.setMockInitialValues({'auth_token': 'session-token'});
    final requests = <http.Request>[];
    await http.runWithClient(() async {
      final details = await ApiService.airtimeDetails('ref/one two');
      expect(details['success'], true);
      final requery = await ApiService.requeryAirtimeReference('SP/REF-1');
      expect(requery['success'], true);
      final pdf = await ApiService.airtimeReceiptPdf('SP-AIR-1');
      expect(pdf, [37, 80, 68, 70]);
    },
        () => MockClient((request) async {
              requests.add(request);
              if (request.url.path.endsWith('/details')) {
                return http.Response(
                  jsonEncode({
                    'success': true,
                    'data': {'transaction': {}}
                  }),
                  200,
                );
              }
              if (request.url.path.endsWith('/requery')) {
                return http.Response(jsonEncode({'success': true}), 200);
              }
              return http.Response.bytes(
                [37, 80, 68, 70],
                200,
                headers: {'content-type': 'application/pdf'},
              );
            }));

    expect(requests, hasLength(3));
    expect(requests[0].method, 'GET');
    expect(requests[0].url.toString(), contains('ref%2Fone%20two/details'));
    expect(requests[0].headers['authorization'], 'Bearer session-token');
    expect(requests[0].headers['accept'], 'application/json');
    expect(requests[1].method, 'POST');
    expect(requests[1].url.toString(), contains('SP%2FREF-1/requery'));
    expect(requests[1].headers['authorization'], 'Bearer session-token');
    expect(requests[2].headers['authorization'], 'Bearer session-token');
    expect(requests[2].headers['accept'], 'application/pdf');
  });

  test('only airtime history records enter the airtime details branch', () {
    expect(isAirtimeHistoryRecord({'serviceType': 'AIRTIME'}), isTrue);
    expect(isAirtimeHistoryRecord({'serviceType': 'DATA'}), isFalse);
    expect(isAirtimeHistoryRecord({}, title: 'Airtime purchase'), isTrue);
    expect(
      airtimeHistoryIdentity({'id': 'db-id', 'reference': 'SP-REF'}),
      'SP-REF',
    );
    expect(
      airtimeHistoryIdentity({'id': 'db-id', 'providerId': 'supplier-ref'}),
      isEmpty,
    );
  });
}
