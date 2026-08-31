import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'voice_call_models.dart';

class VoiceCallScreen extends StatefulWidget {
  const VoiceCallScreen({super.key, this.client});
  final http.Client? client;

  @override
  State<VoiceCallScreen> createState() => _VoiceCallScreenState();
}

class _VoiceCallScreenState extends State<VoiceCallScreen> {
  static const apiBase = 'https://api.servicepay.ng/api';
  late final http.Client _client = widget.client ?? http.Client();
  final _search = TextEditingController();
  Timer? _durationTimer;
  io.Socket? _socket;
  RTCPeerConnection? _peer;
  MediaStream? _localStream;
  List<CallRecord> _history = <CallRecord>[];
  VoiceCallState _state = VoiceCallState.idle;
  CallRecord? _selected;
  String _callId = '';
  String _peerId = '';
  CallLifecycleCoordinator? _coordinator;
  Timer? _ringTimer;
  Timer? _disconnectTimer;
  String _error = '';
  int _seconds = 0;
  bool _muted = false;
  bool _speaker = false;
  bool _loading = true;
  bool _callsAvailable = true;
  String _availabilityReason = '';
  Map<String, dynamic> _iceServers = <String, dynamic>{};
  final List<RTCIceCandidate> _pendingIce = <RTCIceCandidate>[];
  bool _remoteDescriptionSet = false;
  bool _remoteEnd = false;
  bool _intentionalTeardown = false;
  bool _terminalSent = false;
  Map<String, dynamic>? _queuedDescription;

  @override
  void initState() {
    super.initState();
    _connectSocket();
    _loadConfig();
    _loadHistory();
  }

  @override
  void dispose() {
    _search.dispose();
    _durationTimer?.cancel();
    _ringTimer?.cancel();
    _disconnectTimer?.cancel();
    _cleanCall();
    _socket?.dispose();
    _socket = null;
    if (widget.client == null) _client.close();
    super.dispose();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token') ?? prefs.getString('token');
  }

  Future<void> _connectSocket() async {
    final token = await _token();
    if (token == null || token.isEmpty) return;
    _socket = io.io(apiBase.replaceFirst('/api', ''), <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': token},
    });
    _socket!.on('call:incoming', (payload) {
      _incoming(payload)
          .catchError((_) => _setError('Unable to receive call.'));
    });
    _socket!.on('call:state', _remoteState);
    _socket!.on('call:sdp', (payload) {
      _remoteSdp(payload).catchError((_) => _setError(
          'Call negotiation failed.',
          terminateServer: shouldTerminateServerOnNegotiationFailure(
              _coordinator?.accepted == true, _callId)));
    });
    _socket!.on('call:ice', (payload) {
      _remoteIce(payload).catchError((_) => _setError('Call connection failed.',
          terminateServer: shouldTerminateServerOnNegotiationFailure(
              _coordinator?.accepted == true, _callId)));
    });
    _socket!.connect();
  }

  Future<void> _loadConfig() async {
    try {
      final token = await _token();
      if (token == null) return;
      final response = await _client.get(Uri.parse('$apiBase/calls/config'),
          headers: {'Authorization': 'Bearer $token'});
      final body = jsonDecode(response.body);
      if (response.statusCode < 300 && body is Map) {
        _callsAvailable = body['callingAvailable'] != false;
        _availabilityReason = (body['reason'] ?? '').toString();
        _iceServers = {'iceServers': body['iceServers'] ?? <dynamic>[]};
        if (mounted) {
          setState(() {});
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _callsAvailable = false;
          _availabilityReason = 'Calling configuration is unavailable.';
        });
      }
    }
  }

  Future<void> _incoming(dynamic payload) async {
    if (payload is! Map || !mounted) {
      return;
    }
    await _resetPerCallState();
    _callId = (payload['id'] ?? payload['callId'] ?? '').toString();
    final peer = payload['peerId']?.toString() ?? '';
    _selected = CallRecord(
        callId: _callId,
        peerId: peer,
        name: 'ServicePay customer',
        phone: '',
        status: 'incoming',
        createdAt: null);
    _peerId = peer;
    _coordinator = CallLifecycleCoordinator(CallRole.callee);
    setState(() => _state = VoiceCallState.incoming);
  }

  void _remoteState(dynamic payload) {
    if (payload is! Map || payload['callId']?.toString() != _callId) return;
    final state = _coordinator?.receive(payload['state']?.toString() ?? '') ??
        voiceCallStateFromPayload(payload['state']);
    if (state == VoiceCallState.active) _activate();
    if (state == VoiceCallState.ringing &&
        _coordinator?.role == CallRole.caller &&
        _coordinator?.canOffer == true) {
      _prepareCallerOffer();
    }
    if (state == VoiceCallState.ended) {
      _remoteEnd = true;
      _end();
    }
  }

  Future<void> _remoteSdp(dynamic payload) async {
    try {
      if (payload is! Map || payload['callId']?.toString() != _callId) {
        return;
      }
      final raw = payload['description'];
      if (raw is! Map || _peer == null) {
        _queuedDescription = raw is Map ? Map<String, dynamic>.from(raw) : null;
        return;
      }
      final description = RTCSessionDescription(
          raw['sdp']?.toString(), raw['type']?.toString());
      await _peer!.setRemoteDescription(description);
      _remoteDescriptionSet = true;
      for (final candidate in _pendingIce) {
        await _peer!.addCandidate(candidate);
      }
      _pendingIce.clear();
      if (description.type == 'offer') {
        final answer = await _peer!.createAnswer();
        await _peer!.setLocalDescription(answer);
        _socket?.emit('call:sdp', {
          'callId': _callId,
          'description': {'sdp': answer.sdp, 'type': answer.type}
        });
      }
    } catch (_) {
      _setError('Call negotiation failed.',
          terminateServer: shouldTerminateServerOnNegotiationFailure(
              _coordinator?.accepted == true, _callId));
    }
  }

  Future<void> _remoteIce(dynamic payload) async {
    if (payload is! Map ||
        payload['callId']?.toString() != _callId ||
        _peer == null) {
      return;
    }
    final raw = payload['candidate'];
    if (raw is! Map) return;
    final candidate = RTCIceCandidate(raw['candidate']?.toString(),
        raw['sdpMid']?.toString(), raw['sdpMLineIndex']);
    if (_remoteDescriptionSet) {
      await _peer!.addCandidate(candidate);
    } else {
      _pendingIce.add(candidate);
    }
  }

  Future<void> _loadHistory() async {
    try {
      final token = await _token();
      if (token == null || token.isEmpty) {
        throw StateError('Please sign in again.');
      }
      final response = await _client.get(Uri.parse('$apiBase/calls/history'),
          headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer $token'
          });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError('Call history is temporarily unavailable.');
      }
      final decoded = jsonDecode(response.body);
      final raw = decoded is List
          ? decoded
          : (decoded is Map
              ? (decoded['calls'] ?? decoded['data'] ?? <dynamic>[])
              : <dynamic>[]);
      if (raw is! List) throw const FormatException();
      _history = raw
          .whereType<Map>()
          .map((e) => CallRecord.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    } catch (e) {
      _error = e
          .toString()
          .replaceFirst('Bad state: ', '')
          .replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _start(CallRecord record) async {
    if (!_callsAvailable) {
      _setError(_availabilityReason.isEmpty
          ? 'Calling is unavailable.'
          : _availabilityReason);
      return;
    }
    await _resetPerCallState();
    setState(() {
      _selected = record;
      _peerId = record.peerId;
      _coordinator = CallLifecycleCoordinator(CallRole.caller);
      _state = VoiceCallState.ringing;
      _error = '';
    });
    try {
      final token = await _token();
      if (token == null) throw StateError('Please sign in again.');
      final created = await _client.post(
        Uri.parse('$apiBase/calls'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token'
        },
        body: jsonEncode({'calleeId': record.peerId}),
      );
      if (created.statusCode < 200 || created.statusCode >= 300) {
        throw StateError('This customer is not available for a call.');
      }
      final body = jsonDecode(created.body);
      if (body is Map && body['call'] is Map) {
        _callId = (body['call']['id'] ?? body['call']['_id'] ?? '').toString();
      }
      _ringUntil(body is Map && body['call'] is Map
          ? body['call']['expiresAt']
          : null);
    } on UnsupportedError {
      _setError('Voice calling is not supported on this platform.');
    } catch (_) {
      _setError(
          'Microphone access is required to place a call. Check permission and try again.');
    }
  }

  Future<void> _acceptIncoming() async {
    try {
      _localStream = await navigator.mediaDevices
          .getUserMedia({'audio': true, 'video': false});
      _peer = await createPeerConnection(_iceServers);
      _attachConnectionCallbacks();
      _peer!.onIceCandidate = (candidate) => _socket?.emit(
          'call:ice', {'callId': _callId, 'candidate': candidate.toMap()});
      _peer!.onTrack = (_) {};
      for (final track in _localStream!.getAudioTracks()) {
        await _peer!.addTrack(track, _localStream!);
      }
      _socket
          ?.emitWithAck('call:state', {'callId': _callId, 'state': 'ACCEPTED'},
              ack: (dynamic response) {
        final ack = response is Map ? response : <dynamic, dynamic>{};
        if (_coordinator?.acknowledgeAccepted(ack) != true) {
          _setError('Unable to accept this call. Please try again.');
          return;
        }
        if (mounted) setState(() => _state = VoiceCallState.ringing);
      });
    } on UnsupportedError {
      _setError('Voice calling is not supported on this platform.');
    } catch (_) {
      _setError(
          'Microphone access was denied. Allow microphone access to answer.');
    }
  }

  void _activate() {
    if (!mounted) return;
    setState(() => _state = VoiceCallState.active);
    _durationTimer?.cancel();
    _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _seconds++);
    });
  }

  void _setError(String message, {bool terminateServer = false}) {
    if (terminateServer) _end();
    _cleanCall();
    if (mounted) {
      setState(() {
        _state = VoiceCallState.error;
        _error = message;
      });
    }
  }

  void _end() {
    if (shouldNotifyTerminal(
        remoteTerminal: _remoteEnd,
        intentionalTeardown: _intentionalTeardown,
        terminalSent: _terminalSent,
        callCreated: _callId.isNotEmpty)) {
      final action = _coordinator?.hangupAction() ?? 'ENDED';
      _terminalSent = true;
      _notifyTerminal(action);
    }
    _durationTimer?.cancel();
    _cleanCall();
    if (mounted) setState(() => _state = VoiceCallState.ended);
  }

  Future<void> _cleanCall() async {
    _intentionalTeardown = true;
    for (final track in _localStream?.getTracks() ?? <MediaStreamTrack>[]) {
      await track.stop();
    }
    await _localStream?.dispose();
    await _peer?.close();
    _localStream = null;
    _peer = null;
    _pendingIce.clear();
    _remoteDescriptionSet = false;
    _remoteEnd = false;
    _disconnectTimer?.cancel();
  }

  Future<void> _resetPerCallState() async {
    await _cleanCall();
    _durationTimer?.cancel();
    _ringTimer?.cancel();
    _disconnectTimer?.cancel();
    _durationTimer = null;
    _ringTimer = null;
    _disconnectTimer = null;
    _queuedDescription = null;
    _pendingIce.clear();
    _remoteDescriptionSet = false;
    _seconds = 0;
    _muted = false;
    _speaker = false;
    _remoteEnd = false;
    _intentionalTeardown = false;
    _terminalSent = false;
    _callId = '';
    _peerId = '';
    _coordinator = null;
  }

  Future<void> _notifyTerminal(String action) async {
    bool acknowledged = false;
    _socket?.emitWithAck('call:state', {'callId': _callId, 'state': action},
        ack: (dynamic reply) {
      acknowledged = reply is Map && reply['ok'] == true;
    });
    await Future<void>.delayed(const Duration(seconds: 2));
    if (acknowledged || _callId.isEmpty) return;
    try {
      final token = await _token();
      if (token == null) return;
      await _client.post(Uri.parse('$apiBase/calls/$_callId/end'), headers: {
        'Authorization': 'Bearer $token'
      }).timeout(const Duration(seconds: 8));
    } catch (_) {}
  }

  Future<void> _prepareCallerOffer() async {
    if (_peer != null) return;
    try {
      _peer = await createPeerConnection(_iceServers);
      _attachConnectionCallbacks();
      _peer!.onIceCandidate = (candidate) => _socket?.emit(
          'call:ice', {'callId': _callId, 'candidate': candidate.toMap()});
      _peer!.onTrack = (_) {};
      _localStream = await navigator.mediaDevices
          .getUserMedia({'audio': true, 'video': false});
      for (final track in _localStream!.getAudioTracks()) {
        await _peer!.addTrack(track, _localStream!);
      }
      final offer = await _peer!.createOffer();
      await _peer!.setLocalDescription(offer);
      _socket?.emit('call:sdp',
          serializeDescription(_callId, offer.type ?? 'offer', offer.sdp));
      if (_queuedDescription != null) {
        final queued = _queuedDescription;
        _queuedDescription = null;
        await _remoteSdp({'callId': _callId, 'description': queued});
      }
    } catch (_) {
      _setError('Microphone access is required to place a call.',
          terminateServer: shouldTerminateServerOnNegotiationFailure(
              _coordinator?.accepted == true, _callId));
    }
  }

  void _attachConnectionCallbacks() {
    _peer!.onConnectionState = (state) => _handleConnectionState(state.name);
    _peer!.onIceConnectionState = (state) => _handleConnectionState(state.name);
  }

  void _handleConnectionState(String raw) {
    final state = raw.toUpperCase();
    if (state == 'CONNECTED' || state == 'COMPLETED') {
      _disconnectTimer?.cancel();
      _coordinator?.connection('CONNECTED');
      _activate();
      return;
    }
    if (state == 'DISCONNECTED') {
      _disconnectTimer?.cancel();
      _disconnectTimer = Timer(const Duration(seconds: 8), () {
        if (mounted) {
          _setError('Call connection was lost.', terminateServer: true);
        }
      });
      return;
    }
    if (state == 'FAILED' || state == 'CLOSED') {
      _coordinator?.connection('FAILED');
      _setError('Call connection failed.', terminateServer: true);
    }
  }

  void _ringUntil(dynamic expiresAt) {
    _ringTimer?.cancel();
    final expiry = DateTime.tryParse(expiresAt?.toString() ?? '');
    if (expiry == null) return;
    final delay = expiry.difference(DateTime.now());
    _ringTimer = Timer(delay.isNegative ? Duration.zero : delay, () {
      if (mounted &&
          (_state == VoiceCallState.ringing ||
              _state == VoiceCallState.incoming)) {
        _remoteEnd = true;
        _end();
      }
    });
  }

  String _time() =>
      '${(_seconds ~/ 60).toString().padLeft(2, '0')}:${(_seconds % 60).toString().padLeft(2, '0')}';

  Future<void> _searchCustomer(String query) async {
    final value = query.trim();
    if (value.isEmpty) return;
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final token = await _token();
      if (token == null || token.isEmpty) {
        throw StateError('Please sign in again.');
      }
      final response = await _client.get(
        Uri.parse('$apiBase/calls/search')
            .replace(queryParameters: {'q': value}),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token'
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError('No ServicePay customer matched that search.');
      }
      final decoded = jsonDecode(response.body);
      final raw = decoded is Map ? decoded['users'] : decoded;
      if (raw is! List || raw.isEmpty) {
        throw StateError('No ServicePay customer matched that search.');
      }
      final record = CallRecord.fromJson(Map<String, dynamic>.from(raw.first));
      if (!mounted) return;
      await _start(record);
    } catch (e) {
      if (mounted) {
        setState(() => _error = e
            .toString()
            .replaceFirst('Bad state: ', '')
            .replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _blockSelected() async {
    final record = _selected;
    final token = await _token();
    if (record == null || token == null) return;
    try {
      await _client.post(
          Uri.parse(
              '$apiBase/calls/privacy/blocked/${Uri.encodeComponent(_peerId.isEmpty ? record.peerId : _peerId)}'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token'
          },
          body: jsonEncode(<String, dynamic>{}));
      if (mounted) {
        Navigator.of(context).pop();
        _end();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Customer blocked from future calls.')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Unable to update blocking preferences.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final callMode =
        _state != VoiceCallState.idle && _state != VoiceCallState.searching;
    return Scaffold(
      backgroundColor: const Color(0xFFF4F8F5),
      appBar: AppBar(
          title: const Text('ServicePay Call'),
          backgroundColor: const Color(0xFFF4F8F5),
          foregroundColor: const Color(0xFF123B2A),
          elevation: 0),
      body: SafeArea(child: callMode ? _callView() : _directoryView()),
    );
  }

  Widget _directoryView() => RefreshIndicator(
        onRefresh: _loadHistory,
        child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                      color: const Color(0xFF123B2A),
                      borderRadius: BorderRadius.circular(24)),
                  child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.verified_user_outlined,
                            color: Color(0xFFB9E7C9), size: 28),
                        SizedBox(height: 18),
                        Text('Private calling, made clear.',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w800)),
                        SizedBox(height: 8),
                        Text(
                            'Call another ServicePay customer without sharing your number. Audio is never recorded.',
                            style: TextStyle(
                                color: Color(0xFFD6E9DC), height: 1.4)),
                      ])),
              const SizedBox(height: 20),
              TextField(
                  controller: _search,
                  onSubmitted: _searchCustomer,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                      labelText: 'Find a ServicePay customer',
                      hintText: 'Phone number or account ID',
                      prefixIcon: const Icon(Icons.search),
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                          borderSide: BorderSide.none))),
              const SizedBox(height: 18),
              if (_error.isNotEmpty) _notice(_error, Icons.info_outline),
              if (!_callsAvailable && _availabilityReason.isNotEmpty)
                _notice(_availabilityReason, Icons.phone_disabled_outlined),
              const Text('Recent calls',
                  style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF18382A))),
              const SizedBox(height: 8),
              if (_loading)
                ...List.generate(
                    3, (_) => const Card(child: SizedBox(height: 68))),
              if (!_loading && _history.isEmpty)
                _notice(
                    'No calls yet. Search a customer to make your first private call.',
                    Icons.history),
              ..._history.map(_historyTile),
              const SizedBox(height: 10),
              TextButton.icon(
                  onPressed: () => _showPrivacy(),
                  icon: const Icon(Icons.lock_outline),
                  label: const Text('Privacy and blocking')),
            ]),
      );

  Widget _historyTile(CallRecord record) => Card(
        color: Colors.white,
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          leading: CircleAvatar(
            backgroundColor: const Color(0xFFDDF2E4),
            child: Text(record.initials,
                style: const TextStyle(
                    color: Color(0xFF14733E), fontWeight: FontWeight.bold)),
          ),
          title: Text(record.name,
              style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text('${record.status}  •  ${record.phone}'),
          trailing: IconButton(
            tooltip: 'Call again',
            onPressed: () => _start(record),
            icon: const Icon(Icons.call_rounded, color: Color(0xFF14733E)),
          ),
        ),
      );

  Widget _callView() => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            CircleAvatar(
                radius: 48,
                backgroundColor: const Color(0xFFDDF2E4),
                child: Text(_selected?.initials ?? '?',
                    style: const TextStyle(
                        fontSize: 30,
                        color: Color(0xFF14733E),
                        fontWeight: FontWeight.w800))),
            const SizedBox(height: 18),
            Text(_selected?.name ?? 'ServicePay customer',
                style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF123B2A))),
            const SizedBox(height: 8),
            Text(
                _state == VoiceCallState.active
                    ? _time()
                    : (_state == VoiceCallState.incoming
                        ? 'Incoming private call'
                        : (_state == VoiceCallState.ended
                            ? 'Connection closed'
                            : 'Calling securely')),
                style: const TextStyle(color: Color(0xFF5D7467), fontSize: 16)),
            const SizedBox(height: 42),
            if (_state == VoiceCallState.incoming) ...[
              FilledButton.icon(
                  onPressed: _acceptIncoming,
                  icon: const Icon(Icons.call_rounded),
                  label: const Text('Answer')),
              TextButton.icon(
                  onPressed: _end,
                  icon: const Icon(Icons.close_rounded),
                  label: const Text('Decline')),
            ],
            if (_state == VoiceCallState.active)
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                _control(Icons.mic_off_outlined, 'Mute', _muted, () {
                  setState(() => _muted = !_muted);
                  for (final t in _localStream?.getAudioTracks() ??
                      <MediaStreamTrack>[]) {
                    t.enabled = !_muted;
                  }
                }),
                const SizedBox(width: 24),
                _control(Icons.volume_up_outlined, 'Speaker', _speaker, () {
                  setState(() => _speaker = !_speaker);
                  Helper.setSpeakerphoneOn(_speaker);
                }),
              ]),
            const SizedBox(height: 34),
            if (_state != VoiceCallState.ended &&
                _state != VoiceCallState.error)
              FloatingActionButton.large(
                  backgroundColor: const Color(0xFFB42318),
                  onPressed: _end,
                  child:
                      const Icon(Icons.call_end_rounded, color: Colors.white)),
            const SizedBox(height: 10),
            Text(
                _state == VoiceCallState.ended
                    ? 'Call ended'
                    : (_state == VoiceCallState.error ? _error : 'End call'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: Color(0xFFB42318), fontWeight: FontWeight.w700)),
            if (_state == VoiceCallState.ended ||
                _state == VoiceCallState.error) ...[
              const SizedBox(height: 18),
              OutlinedButton.icon(
                  onPressed: () =>
                      _selected == null ? null : _start(_selected!),
                  icon: const Icon(Icons.call_rounded),
                  label: const Text('Call again')),
              TextButton.icon(
                  onPressed: _showPrivacy,
                  icon: const Icon(Icons.block_outlined),
                  label: const Text('Privacy and block options')),
            ],
          ])));

  Widget _control(
          IconData icon, String label, bool selected, VoidCallback onTap) =>
      Column(children: [
        IconButton.filled(
            onPressed: onTap,
            icon: Icon(icon),
            style: IconButton.styleFrom(
                backgroundColor: selected
                    ? const Color(0xFF14733E)
                    : const Color(0xFFE1ECE5),
                foregroundColor:
                    selected ? Colors.white : const Color(0xFF234936))),
        Text(label, style: const TextStyle(fontSize: 12)),
      ]);

  Widget _notice(String text, IconData icon) => Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: const Color(0xFFEAF3EC),
          borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        Icon(icon, color: const Color(0xFF14733E)),
        const SizedBox(width: 10),
        Expanded(
            child: Text(text, style: const TextStyle(color: Color(0xFF365244))))
      ]));

  void _showPrivacy() => showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
          child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Your call privacy',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w800)),
                    SizedBox(height: 12),
                    Text(
                        'Calls connect only between authenticated ServicePay accounts. We do not record audio.',
                        style: TextStyle(height: 1.5)),
                    SizedBox(height: 12),
                    if (_selected != null)
                      FilledButton.icon(
                          onPressed: _blockSelected,
                          icon: Icon(Icons.block_outlined),
                          label: Text('Block ${_selected!.name}')),
                  ]))));
}
