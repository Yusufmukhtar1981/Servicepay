import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/ai_support_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'customer-test-session',
    });
  });

  test('record picker uses opaque cursor pages and no customer identifier',
      () async {
    late Uri requested;
    final client = MockClient((request) async {
      requested = request.url;
      expect(request.headers['authorization'], 'Bearer customer-test-session');
      return http.Response(
        jsonEncode(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'items': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'owned-record-key',
                'type': 'DELIVERY',
                'status': 'IN_TRANSIT',
                'reference': 'DLV-2048',
                'createdAt': '2026-08-30T10:00:00.000Z',
              },
            ],
            'nextCursor': 'opaque-page-token',
          },
        }),
        200,
      );
    });

    final page = await AiSupportApiService.getRecords(
      cursor: 'previous-opaque-cursor',
      limit: 20,
      client: client,
    );

    expect(
      requested.path,
      Uri.parse('${AiSupportApiService.baseUrl}/records').path,
    );
    expect(requested.queryParameters['cursor'], 'previous-opaque-cursor');
    expect(requested.queryParameters['limit'], '20');
    expect(requested.queryParameters.keys, isNot(contains('customerId')));
    expect(page.items.single.id, 'owned-record-key');
    expect(page.items.single.reference, 'DLV-2048');
    expect(page.nextCursor, 'opaque-page-token');
  });

  test(
      'voice requests require consent and speech binds exact saved assistant text',
      () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request as http.Request);
      if (request.url.path.endsWith('/voice/transcribe')) {
        return http.Response(
          '{"success":true,"data":{"text":"My transfer is pending","language":"en"}}',
          200,
        );
      }
      return http.Response(
        '{"success":true,"data":{"audioBase64":"AQID","mimeType":"audio/mpeg","disclosure":"AI-generated voice"}}',
        200,
      );
    });

    final transcript = await AiSupportApiService.transcribeVoice(
      Uint8List.fromList(<int>[82, 73, 70, 70]),
      language: 'en',
      client: client,
    );
    final audio = await AiSupportApiService.synthesizeVoice(
      messageIndex: 7,
      messageText: 'The saved assistant reply, exactly.',
      language: 'en',
      client: client,
    );

    expect(transcript, 'My transfer is pending');
    expect(audio, <int>[1, 2, 3]);
    final transcribePayload =
        jsonDecode(requests[0].body) as Map<String, dynamic>;
    expect(transcribePayload['consent'], isTrue);
    expect(transcribePayload['language'], 'en');
    expect(base64Decode(transcribePayload['audioBase64'] as String),
        <int>[82, 73, 70, 70]);
    final speechPayload = jsonDecode(requests[1].body) as Map<String, dynamic>;
    expect(speechPayload['messageIndex'], 7);
    expect(speechPayload['messageText'], 'The saved assistant reply, exactly.');
    expect(speechPayload['consent'], isTrue);
  });

  test('selected record key is scoped into chat and human escalation bodies',
      () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request as http.Request);
      if (request.url.path.endsWith('/chat')) {
        return http.Response(
          '{"success":true,"reply":"I checked the stored record.","assistantMessageIndex":4}',
          200,
        );
      }
      return http.Response(
        '{"success":true,"data":{"id":"case-owned","caseReference":"SUP-44","status":"OPEN"}}',
        201,
      );
    });

    final reply = await AiSupportApiService.sendMessage(
      'Please check my record',
      language: 'en',
      transactionLookupId: 'owned-record-key',
      client: client,
    );
    final ticket = await AiSupportApiService.escalate(
      'Please help with this record',
      transactionLookupId: 'owned-record-key',
      client: client,
    );

    expect(reply.assistantMessageIndex, 4);
    expect(ticket.caseReference, 'SUP-44');
    expect(
      (jsonDecode(requests[0].body)
          as Map<String, dynamic>)['transactionLookupId'],
      'owned-record-key',
    );
    expect(
      (jsonDecode(requests[1].body)
          as Map<String, dynamic>)['transactionLookupId'],
      'owned-record-key',
    );
  });

  test(
      'history feature-off capability disables text support and preserves server index',
      () async {
    final client = MockClient((request) async => http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'aiSupportEnabled': true,
            'capabilities': <String, dynamic>{
              'smartSupportEnabled': false,
              'englishVoiceEnabled': false,
              'hausaVoiceEnabled': false,
            },
            'messages': <Map<String, dynamic>>[
              <String, dynamic>{
                'role': 'ASSISTANT',
                'message': 'Stored reply',
                'messageIndex': 12,
              },
            ],
          }),
          200,
        ));

    final history = await AiSupportApiService.getHistory(client: client);
    expect(history.aiSupportEnabled, isFalse);
    expect(history.messages.single.messageIndex, 12);
  });
}
