enum VoiceCallState { idle, searching, ringing, incoming, active, ended, error }

/// The user-facing outcome of asking the device for audio capture.
///
/// This deliberately maps platform exception text only; it does not assert that
/// a physical microphone or a two-way call is working.
enum MicrophoneAccessResult {
  granted,
  denied,
  unsupported,
  api,
  config,
  network
}

class MicrophoneAccessFailure {
  const MicrophoneAccessFailure(this.result);

  final MicrophoneAccessResult result;

  bool get canRetryPermission => result == MicrophoneAccessResult.denied;
  bool get mayNeedSettings => result == MicrophoneAccessResult.denied;

  String get message {
    switch (result) {
      case MicrophoneAccessResult.denied:
        return 'Microphone permission is required for ServicePay calls.';
      case MicrophoneAccessResult.unsupported:
        return 'Voice calling is not supported on this platform.';
      case MicrophoneAccessResult.config:
        return 'Calling configuration is unavailable. Please try again later.';
      case MicrophoneAccessResult.network:
        return 'A network error prevented the call from starting. Please try again.';
      case MicrophoneAccessResult.api:
        return 'Unable to access the microphone. Please try again.';
      case MicrophoneAccessResult.granted:
        return '';
    }
  }
}

MicrophoneAccessFailure classifyMicrophoneError(Object error) {
  final value = '${error.runtimeType} $error'.toLowerCase();
  if (value.contains('notallowed') ||
      value.contains('permissiondenied') ||
      value.contains('permission denied') ||
      value.contains('denied')) {
    return const MicrophoneAccessFailure(MicrophoneAccessResult.denied);
  }
  if (value.contains('notsupported') || value.contains('unsupported')) {
    return const MicrophoneAccessFailure(MicrophoneAccessResult.unsupported);
  }
  if (value.contains('network') ||
      value.contains('socket') ||
      value.contains('timeout')) {
    return const MicrophoneAccessFailure(MicrophoneAccessResult.network);
  }
  if (value.contains('config') ||
      value.contains('ice') ||
      value.contains('turn')) {
    return const MicrophoneAccessFailure(MicrophoneAccessResult.config);
  }
  return const MicrophoneAccessFailure(MicrophoneAccessResult.api);
}

String callSetupErrorMessage(Object error) {
  final failure = classifyMicrophoneError(error);
  switch (failure.result) {
    case MicrophoneAccessResult.unsupported:
      return 'Voice calling is not supported on this platform.';
    case MicrophoneAccessResult.config:
      return 'Calling configuration is unavailable. Please try again later.';
    case MicrophoneAccessResult.network:
      return 'Connection lost. Retry?';
    case MicrophoneAccessResult.granted:
    case MicrophoneAccessResult.denied:
    case MicrophoneAccessResult.api:
      return 'The call could not start. Please try again.';
  }
}

String callSessionResponseMessage(int statusCode, dynamic body) {
  if (statusCode == 409) return 'User unavailable';
  if (statusCode == 429) {
    return 'Too many call attempts. Please wait and try again.';
  }
  if (body is Map) {
    final message = '${body['message'] ?? ''}'.trim();
    if (message.isNotEmpty) return message;
  }
  return 'The call session could not be created. Please try again.';
}

String terminalCallMessage(dynamic value) {
  switch (value?.toString().trim().toUpperCase()) {
    case 'DECLINED':
    case 'REJECTED':
      return 'Call declined';
    case 'BUSY':
    case 'MISSED':
    case 'FAILED':
      return 'User unavailable';
    case 'CANCELLED':
      return 'Call cancelled';
    default:
      return 'Call ended';
  }
}

String terminalCallActionPath(String action) {
  switch (action.trim().toUpperCase()) {
    case 'DECLINED':
      return 'decline';
    case 'CANCELLED':
      return 'cancel';
    default:
      return 'end';
  }
}

/// Keeps a tap/retry from creating more than one call session at a time.
class CallStartGuard {
  bool _inFlight = false;

  bool tryAcquire() {
    if (_inFlight) return false;
    _inFlight = true;
    return true;
  }

  void release() => _inFlight = false;
  bool get isInFlight => _inFlight;
}

/// Local media must never outlive a declined, terminal, failed, or disposed
/// call, irrespective of whether signaling reached the server.
bool shouldReleaseCallResources({
  required VoiceCallState state,
  required bool declined,
  required bool disposing,
}) =>
    disposing ||
    declined ||
    state == VoiceCallState.ended ||
    state == VoiceCallState.error;

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

bool shouldIgnoreConnectionStateDuringTeardown(
        String state, bool intentionalTeardown) =>
    intentionalTeardown &&
    const <String>{'DISCONNECTED', 'FAILED', 'CLOSED'}
        .contains(state.trim().toUpperCase());

bool shouldResumeIncomingCallSession({
  required bool callCreated,
  required bool remoteTerminal,
}) =>
    callCreated && !remoteTerminal;

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
