enum VoiceCallState { idle, searching, ringing, incoming, active, ended, error }

VoiceCallState voiceCallStateFromPayload(dynamic value) {
  final String state = value?.toString().trim().toLowerCase() ?? '';
  switch (state) {
    case 'ringing':
    case 'outgoing':
      return VoiceCallState.ringing;
    case 'incoming':
      return VoiceCallState.incoming;
    case 'connected':
    case 'active':
      return VoiceCallState.active;
    case 'ended':
    case 'completed':
    case 'rejected':
    case 'declined':
    case 'missed':
    case 'cancelled':
    case 'busy':
    case 'failed':
      return VoiceCallState.ended;
    default:
      return VoiceCallState.idle;
  }
}

Map<String, dynamic> serializeDescription(
        String callId, String type, String? sdp) =>
    <String, dynamic>{
      'callId': callId,
      'description': <String, dynamic>{'type': type, 'sdp': sdp},
    };

Map<String, dynamic> serializeCandidate(
        String callId, String candidate, String? sdpMid, int? sdpMLineIndex) =>
    <String, dynamic>{
      'callId': callId,
      'candidate': <String, dynamic>{
        'candidate': candidate,
        'sdpMid': sdpMid,
        'sdpMLineIndex': sdpMLineIndex,
      },
    };

bool callingAvailableFromConfig(Map<String, dynamic> config) =>
    config['callingAvailable'] == true;

bool shouldNotifyTerminal({
  required bool remoteTerminal,
  required bool intentionalTeardown,
  required bool terminalSent,
  required bool callCreated,
}) =>
    callCreated && !remoteTerminal && !intentionalTeardown && !terminalSent;

bool shouldTerminateServerOnNegotiationFailure(bool accepted, String callId) =>
    accepted && callId.trim().isNotEmpty;

class CallRecord {
  const CallRecord({
    required this.callId,
    required this.peerId,
    required this.name,
    required this.phone,
    required this.status,
    required this.createdAt,
  });

  final String callId;
  final String peerId;
  final String name;
  final String phone;
  final String status;
  final DateTime? createdAt;

  factory CallRecord.fromJson(Map<String, dynamic> json) {
    final dynamic person = json['peer'] ??
        json['peerSummary'] ??
        json['user'] ??
        json['contact'] ??
        json['recipient'];
    final Map<String, dynamic> nested =
        person is Map ? Map<String, dynamic>.from(person) : <String, dynamic>{};
    return CallRecord(
      callId: (json['callId'] ?? json['_id'] ?? json['id'] ?? '').toString(),
      peerId:
          (json['peerId'] ?? nested['id'] ?? nested['_id'] ?? '').toString(),
      name: (json['name'] ??
              json['fullName'] ??
              nested['fullName'] ??
              nested['name'] ??
              'ServicePay customer')
          .toString(),
      phone: '', // Peer phone numbers are intentionally never rendered.
      status: (json['status'] ?? 'completed').toString(),
      createdAt: DateTime.tryParse(
        (json['createdAt'] ?? json['date'] ?? '').toString(),
      )?.toLocal(),
    );
  }

  String get initials {
    final List<String> words =
        name.trim().split(RegExp(r'\s+')).where((e) => e.isNotEmpty).toList();
    if (words.isEmpty) return '?';
    return words.take(2).map((e) => e[0].toUpperCase()).join();
  }
}

enum CallRole { caller, callee }

class CallLifecycleCoordinator {
  CallLifecycleCoordinator(this.role);
  final CallRole role;
  VoiceCallState state = VoiceCallState.idle;
  bool accepted = false;
  bool peerConnected = false;

  bool get canOffer => role == CallRole.caller && accepted;
  String hangupAction() => state == VoiceCallState.ringing
      ? (role == CallRole.callee ? 'DECLINED' : 'CANCELLED')
      : 'ENDED';

  VoiceCallState receive(String raw) {
    final value = raw.toUpperCase();
    if (value == 'RINGING' || value == 'INCOMING') {
      state = VoiceCallState.ringing;
    } else if (value == 'ACCEPTED') {
      accepted = true;
      state = VoiceCallState.ringing;
    } else if (value == 'CONNECTED' && accepted) {
      peerConnected = true;
      state = VoiceCallState.active;
    } else if ({'DECLINED', 'CANCELLED', 'ENDED', 'MISSED', 'BUSY', 'FAILED'}
        .contains(value)) {
      state = VoiceCallState.ended;
    }
    return state;
  }

  bool acknowledgeAccepted(Map<dynamic, dynamic>? ack) {
    if (ack?['ok'] != true || ack?['state']?.toString() != 'ACCEPTED') {
      return false;
    }
    accepted = true;
    state = VoiceCallState.ringing;
    return true;
  }

  VoiceCallState connection(String value) {
    final normalized = value.toUpperCase();
    if (normalized == 'CONNECTED' || normalized == 'COMPLETED') {
      peerConnected = true;
      state = VoiceCallState.active;
    } else if (normalized == 'FAILED' || normalized == 'CLOSED') {
      state = VoiceCallState.ended;
    }
    return state;
  }
}
