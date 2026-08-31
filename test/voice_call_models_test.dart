import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/voice_call_models.dart';

void main() {
  test('normalizes signaling states without hardware', () {
    expect(voiceCallStateFromPayload('connected'), VoiceCallState.active);
    expect(voiceCallStateFromPayload('outgoing'), VoiceCallState.ringing);
    expect(voiceCallStateFromPayload('declined'), VoiceCallState.ended);
    expect(voiceCallStateFromPayload('unknown'), VoiceCallState.idle);
  });

  test('parses nested customer call payload and initials', () {
    final record = CallRecord.fromJson(<String, dynamic>{
      'callId': 'c-18',
      'contact': <String, dynamic>{'fullName': 'Ada Okafor', 'phone': '0801'},
      'status': 'missed',
      'createdAt': '2026-08-29T12:00:00Z',
    });
    expect(record.id, 'c-18');
    expect(record.name, 'Ada Okafor');
    expect(record.initials, 'AO');
    expect(record.status, 'missed');
  });

  test('parses all terminal provider states', () {
    for (final state in ['declined', 'missed', 'busy', 'failed', 'cancelled']) {
      expect(voiceCallStateFromPayload(state), VoiceCallState.ended);
    }
  });

  test('serializes signaling payloads and config availability', () {
    expect(serializeDescription('c1', 'offer', 'v=0')['callId'], 'c1');
    expect(
        (serializeDescription('c1', 'answer', 'sdp')['description']
            as Map)['type'],
        'answer');
    final ice = serializeCandidate('c1', 'candidate:1', '0', 0);
    expect((ice['candidate'] as Map)['candidate'], 'candidate:1');
    expect(callingAvailableFromConfig({'callingAvailable': true}), isTrue);
    expect(
        callingAvailableFromConfig(
            {'callingAvailable': false, 'reason': 'TURN unavailable'}),
        isFalse);
  });
}
