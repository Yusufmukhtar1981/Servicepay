import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/admin/admin_communications_api.dart';

class _RecordingClient extends http.BaseClient {
  http.Request? request;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest value) async {
    request = value as http.Request;
    return http.StreamedResponse(
      Stream<List<int>>.value(utf8.encode('{"success":true,"count":4}')),
      200,
      headers: const {'content-type': 'application/json'},
    );
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'token-value'});
  });

  test('sends an authenticated email preview with the audience payload',
      () async {
    final client = _RecordingClient();
    final api = AdminCommunicationsApi(client: client);

    await api.preview(
      channel: 'email',
      audience: const {'type': 'ACTIVE_CUSTOMERS'},
    );

    expect(
        client.request!.url.path, '/api/admin/communications/audience/preview');
    expect(client.request!.headers['authorization'], 'Bearer token-value');
    expect(jsonDecode(client.request!.body), {
      'channel': 'email',
      'audience': {'type': 'ACTIVE_CUSTOMERS'},
    });
  });

  test('includes confirmation and idempotency on email broadcasts', () async {
    final client = _RecordingClient();
    final api = AdminCommunicationsApi(client: client);

    await api.broadcastEmail(
      subject: 'Notice',
      message: 'Message',
      audience: const {'type': 'ALL_CUSTOMERS'},
      idempotencyKey: 'unique-key',
    );

    expect(
        client.request!.url.path, '/api/admin/communications/email/broadcast');
    expect(jsonDecode(client.request!.body)['confirmation'], isTrue);
    expect(jsonDecode(client.request!.body)['idempotencyKey'], 'unique-key');
  });
}
