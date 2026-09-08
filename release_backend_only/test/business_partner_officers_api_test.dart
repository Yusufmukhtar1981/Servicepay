import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/business_partner_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'partner-token',
    });
  });

  test('creates an officer with the fixed contract payload', () async {
    late http.Request request;
    final BusinessPartnerApiService api = _api((http.Request value) async {
      request = value;
      return http.Response('{"success":true}', 201);
    });

    await api.createOfficer(
      type: 'SOLAR',
      fullName: 'Amina Bello',
      phone: '08012345678',
      email: 'amina@example.com',
      password: 'secure-pass',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '12 Allen Avenue',
    );

    expect(request.method, 'POST');
    expect(request.url.path, '/api/business-partner/officers');
    expect(jsonDecode(request.body), <String, dynamic>{
      'type': 'SOLAR',
      'fullName': 'Amina Bello',
      'phone': '08012345678',
      'email': 'amina@example.com',
      'password': 'secure-pass',
      'state': 'Lagos',
      'lga': 'Ikeja',
      'address': '12 Allen Avenue',
    });
  });

  test('uses encoded detail and edit routes with editable fields only',
      () async {
    final List<http.Request> requests = <http.Request>[];
    final BusinessPartnerApiService api = _api((http.Request request) async {
      requests.add(request);
      return http.Response('{"success":true}', 200);
    });

    await api.getOfficer(type: 'PHONE', id: 'officer/42');
    await api.updateOfficer(
      type: 'PHONE',
      id: 'officer/42',
      fields: <String, dynamic>{
        'fullName': 'Ibrahim Musa',
        'phone': '08000000000',
        'email': 'ibrahim@example.com',
        'state': 'Kano',
        'lga': 'Nassarawa',
        'address': '4 Market Road',
      },
    );

    expect(requests[0].method, 'GET');
    expect(requests[0].url.toString(),
        contains('/api/business-partner/officers/PHONE/officer%2F42'));
    expect(requests[1].method, 'PATCH');
    expect(requests[1].url.toString(),
        contains('/api/business-partner/officers/PHONE/officer%2F42'));
    expect(jsonDecode(requests[1].body), isNot(contains('id')));
    expect(jsonDecode(requests[1].body), isNot(contains('status')));
  });

  test('sends status and reset-access requests to their lifecycle routes',
      () async {
    final List<http.Request> requests = <http.Request>[];
    final BusinessPartnerApiService api = _api((http.Request request) async {
      requests.add(request);
      return http.Response('{"success":true}', 200);
    });

    await api.updateOfficerStatus(
        type: 'SOLAR', id: 'solar-7', status: 'SUSPENDED');
    await api.resetOfficerAccess(
        type: 'SOLAR', id: 'solar-7', password: 'new-password');

    expect(requests[0].method, 'PATCH');
    expect(requests[0].url.path,
        '/api/business-partner/officers/SOLAR/solar-7/status');
    expect(jsonDecode(requests[0].body), <String, dynamic>{
      'status': 'SUSPENDED',
    });
    expect(requests[1].method, 'POST');
    expect(requests[1].url.path,
        '/api/business-partner/officers/SOLAR/solar-7/reset-access');
    expect(jsonDecode(requests[1].body), <String, dynamic>{
      'password': 'new-password',
    });
  });
}

BusinessPartnerApiService _api(
  Future<http.Response> Function(http.Request) handler,
) =>
    BusinessPartnerApiService(client: MockClient(handler));