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
      'peerId': 'u-9',
      'contact': <String, dynamic>{'fullName': 'Ada Okafor', 'phone': '0801'},
      'status': 'missed',
      'createdAt': '2026-08-29T12:00:00Z',
    });
    expect(record.callId, 'c-18');
    expect(record.peerId, 'u-9');
    expect(record.name, 'Ada Okafor');
    expect(record.initials, 'AO');
    expect(record.status, 'missed');
  });

  test('coordinator requires callee acceptance before caller offer', () {
    final coordinator = CallLifecycleCoordinator(CallRole.caller);
    expect(coordinator.canOffer, isFalse);
    expect(coordinator.receive('ACCEPTED'), VoiceCallState.ringing);
    expect(coordinator.canOffer, isTrue);
    expect(coordinator.hangupAction(), 'CANCELLED');
    expect(coordinator.receive('CONNECTED'), VoiceCallState.active);
    expect(coordinator.hangupAction(), 'ENDED');
  });

  test('callee lifecycle maps decline and terminal timeout states', () {
    final coordinator = CallLifecycleCoordinator(CallRole.callee);
    coordinator.receive('RINGING');
    expect(coordinator.hangupAction(), 'DECLINED');
    for (final value in ['MISSED', 'BUSY', 'FAILED']) {
      expect(coordinator.receive(value), VoiceCallState.ended);
    }
  });

  test('callee only accepts after a positive lifecycle acknowledgement', () {
    final callee = CallLifecycleCoordinator(CallRole.callee);
    expect(callee.acknowledgeAccepted({'ok': false}), isFalse);
    expect(
        callee.acknowledgeAccepted({'ok': true, 'state': 'ACCEPTED'}), isTrue);
    expect(callee.state, VoiceCallState.ringing);
  });

  test('both roles become active only on a connected peer', () {
    for (final role in CallRole.values) {
      final call = CallLifecycleCoordinator(role)..receive('ACCEPTED');
      expect(call.connection('CONNECTED'), VoiceCallState.active);
      expect(call.connection('FAILED'), VoiceCallState.ended);
    }
  });

  test('terminal notification rules distinguish local and remote teardown', () {
    expect(
        shouldNotifyTerminal(
            remoteTerminal: false,
            intentionalTeardown: false,
            terminalSent: false,
            callCreated: true),
        isTrue);
    expect(
        shouldNotifyTerminal(
            remoteTerminal: true,
            intentionalTeardown: false,
            terminalSent: false,
            callCreated: true),
        isFalse);
    expect(
        shouldNotifyTerminal(
            remoteTerminal: false,
            intentionalTeardown: true,
            terminalSent: false,
            callCreated: true),
        isFalse);
    expect(
        shouldNotifyTerminal(
            remoteTerminal: false,
            intentionalTeardown: false,
            terminalSent: true,
            callCreated: true),
        isFalse);
    expect(
        shouldNotifyTerminal(
            remoteTerminal: false,
            intentionalTeardown: false,
            terminalSent: false,
            callCreated: false),
        isFalse);
  });

  test('a reset session permits terminal notification after an earlier call',
      () {
    expect(
        shouldNotifyTerminal(
            remoteTerminal: false,
            intentionalTeardown: false,
            terminalSent: true,
            callCreated: true),
        isFalse);
    // Resetting per-call guards for a subsequent inbound or outbound call.
    expect(
        shouldNotifyTerminal(
            remoteTerminal: false,
            intentionalTeardown: false,
            terminalSent: false,
            callCreated: true),
        isTrue);
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

  test('negotiation failures only terminate an accepted server call', () {
    expect(shouldTerminateServerOnNegotiationFailure(false, 'call-1'), isFalse);
    expect(shouldTerminateServerOnNegotiationFailure(true, ''), isFalse);
    expect(shouldTerminateServerOnNegotiationFailure(true, 'call-1'), isTrue);
  });
}
