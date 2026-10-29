import 'dart:async';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'services/ai_support_api_service.dart';
import 'services/voice_capture.dart';
import 'support_tickets_screen.dart';

class AiSupportScreen extends StatefulWidget {
  const AiSupportScreen({super.key});

  @override
  State<AiSupportScreen> createState() => _AiSupportScreenState();
}

class _AiSupportScreenState extends State<AiSupportScreen> {
  static const Color primaryGreen = Color(0xFF08783E);
  static const Color darkGreen = Color(0xFF075B30);
  static const Color background = Color(0xFFF5FAF7);
  static const String welcomeMessage =
      'Hello. I am ServicePay AI Support. I can help with transfers, wallet funding, airtime, data, electricity, cable TV, delivery, KYC and other ServicePay services.';
  static const String unavailableMessage =
      'AI Support is temporarily unavailable. Please contact ServicePay Support.';

  static const List<String> quickQuestions = <String>[
    'My transaction is pending',
    'Data successful but not received',
    'Reset transaction PIN',
    'How does withdrawal work?',
    'How does ServicePay Empowerment work?',
    'Contact human support',
  ];

  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<AiSupportMessage> _messages = <AiSupportMessage>[];
  final VoiceCapture _voiceCapture = VoiceCapture();
  final AudioPlayer _audioPlayer = AudioPlayer();
  final TextEditingController _voicePreviewController = TextEditingController();

  bool _isLoadingHistory = true;
  bool _isSending = false;
  bool _isClearing = false;
  bool _aiSupportEnabled = false;
  bool _humanEscalationEnabled = true;
  String _language = 'auto';
  Map<String, dynamic> _capabilities = const <String, dynamic>{};
  Map<String, dynamic>? _evidence;
  int _rating = 0;
  bool _feedbackSent = false;
  String? _errorMessage;
  AiSupportRecord? _selectedRecord;
  bool _isRecording = false;
  bool _isTranscribing = false;
  int _recordingSeconds = 0;
  Timer? _recordingTimer;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _voicePreviewController.dispose();
    _scrollController.dispose();
    _recordingTimer?.cancel();
    unawaited(_voiceCapture.dispose());
    unawaited(_audioPlayer.dispose());
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoadingHistory = true;
      _errorMessage = null;
    });

    try {
      final AiSupportHistory history = await AiSupportApiService.getHistory();
      Map<String, dynamic>? feedback;
      try {
        feedback = await AiSupportApiService.getFeedback();
      } catch (_) {
        // Feedback history is optional; it must not block chat history.
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _evidence = null;
        _selectedRecord = null;
        _voicePreviewController.clear();
        _messages
          ..clear()
          ..addAll(history.messages);
        _aiSupportEnabled = history.aiSupportEnabled;
        _humanEscalationEnabled = history.humanEscalationEnabled;
        _capabilities = history.capabilities;
        _rating = (feedback?['rating'] as num?)?.toInt() ?? 0;
        _feedbackSent = _rating > 0;
        _isLoadingHistory = false;
        if (_messages.isEmpty && _aiSupportEnabled) {
          _messages.add(
            const AiSupportMessage(
              role: 'ASSISTANT',
              message: welcomeMessage,
            ),
          );
        }
        if (!_aiSupportEnabled) {
          _messages
            ..clear()
            ..add(
              const AiSupportMessage(
                role: 'ASSISTANT',
                message: unavailableMessage,
              ),
            );
        }
      });
      _scrollToBottom();
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoadingHistory = false;
        _errorMessage = _friendlyError(error);
        _aiSupportEnabled = false;
        _messages
          ..clear()
          ..add(
            const AiSupportMessage(
              role: 'ASSISTANT',
              message: unavailableMessage,
            ),
          );
      });
    }
  }

  Future<void> _sendMessage([String? suggestedMessage]) async {
    if (_isSending || !_aiSupportEnabled) {
      return;
    }

    final String message = (suggestedMessage ?? _messageController.text).trim();

    if (message.isEmpty) {
      return;
    }

    if (message.length > 2000) {
      _showMessage('Message cannot exceed 2,000 characters.');
      return;
    }

    _messageController.clear();
    FocusScope.of(context).unfocus();

    setState(() {
      _errorMessage = null;
      _isSending = true;
      _messages.add(
        AiSupportMessage(
          role: 'USER',
          message: message,
          createdAt: DateTime.now(),
        ),
      );
    });
    _scrollToBottom();

    try {
      final AiSupportReply response = await AiSupportApiService.sendMessage(
        message,
        language: _language,
        transactionLookupId: _selectedRecord?.id,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _evidence = response.evidence;
        _messages.add(
          AiSupportMessage(
            role: 'ASSISTANT',
            message: response.reply,
            createdAt: DateTime.now(),
            messageIndex: response.assistantMessageIndex,
          ),
        );
      });
      _scrollToBottom();
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = _friendlyError(error);
        final bool isDisabled = error is AiSupportApiException &&
            error.code == 'AI_SUPPORT_DISABLED';
        if (isDisabled) {
          _aiSupportEnabled = false;
        }
        _messages.add(
          AiSupportMessage(
            role: 'ASSISTANT',
            message: isDisabled ? unavailableMessage : _errorMessage!,
            createdAt: DateTime.now(),
          ),
        );
      });
      _scrollToBottom();
    } finally {
      if (mounted) {
        setState(() {
          _isSending = false;
        });
      }
    }
  }

  Future<void> _startNewChat() async {
    if (_isClearing) {
      return;
    }
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete AI chat history?'),
        content: const Text(
          'This removes your saved AI support conversation. Existing support tickets are not deleted.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep history'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete history'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _isClearing = true;
      _errorMessage = null;
    });

    try {
      await AiSupportApiService.deleteHistory();

      if (!mounted) {
        return;
      }

      setState(() {
        _evidence = null;
        _selectedRecord = null;
        _voicePreviewController.clear();
        _messages
          ..clear()
          ..add(
            const AiSupportMessage(
              role: 'ASSISTANT',
              message: welcomeMessage,
            ),
          );
      });
      _showMessage('New AI Support chat started.');
    } catch (error) {
      if (mounted) {
        _showMessage(_friendlyError(error));
      }
    } finally {
      if (mounted) {
        setState(() {
          _isClearing = false;
        });
      }
    }
  }

  Future<void> _contactHumanSupport() async {
    if (!_humanEscalationEnabled) {
      _showMessage('Human support is temporarily unavailable.');
      return;
    }

    try {
      final List<AiSupportMessage> userMessages = _messages
          .where((AiSupportMessage item) => item.role == 'USER')
          .toList();
      final String latestMessage = userMessages.isEmpty
          ? 'I need help with my ServicePay account.'
          : userMessages.last.message;
      final AiSupportTicket ticket = await AiSupportApiService.escalate(
        latestMessage,
        transactionLookupId: _selectedRecord?.id,
      );
      if (!mounted) return;
      _showMessage('Support request ${ticket.caseReference} created.');
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => const SupportTicketsScreen(),
        ),
      );
    } catch (error) {
      if (mounted) _showMessage(_friendlyError(error));
    }
  }

  Future<void> _sendFeedback(int rating) async {
    if (rating < 1 || _feedbackSent) return;
    setState(() => _rating = rating);
    try {
      await AiSupportApiService.submitFeedback(rating);
      if (mounted) setState(() => _feedbackSent = true);
      _showMessage('Thank you for your feedback.');
    } catch (error) {
      if (mounted) _showMessage(_friendlyError(error));
    }
  }

  String _friendlyError(Object error) {
    if (error is AiSupportApiException) {
      return error.message;
    }

    return 'AI Support is temporarily unavailable. Please contact ServicePay Support.';
  }

  void _showMessage(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) {
        return;
      }

      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  bool get _voiceAllowed {
    if (!_voiceCapture.isSupported) return false;
    if (_language == 'en') return _capabilities['englishVoiceEnabled'] == true;
    if (_language == 'ha') return _capabilities['hausaVoiceEnabled'] == true;
    return false;
  }

  Future<void> _selectRecord() async {
    if (!_aiSupportEnabled) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _RecordPicker(
        selectedId: _selectedRecord?.id,
        onSelect: (record) {
          setState(() => _selectedRecord = record);
          Navigator.of(context).pop();
        },
      ),
    );
  }

  Future<bool> _confirmVoiceConsent({required bool speaking}) async {
    final bool? accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
            speaking ? 'Play AI voice response?' : 'Record a voice question?'),
        content: Text(
          speaking
              ? 'With your consent, ServicePay will request an AI-generated reading of this saved support message. No financial action will be taken.'
              : 'With your consent, your microphone audio will be sent securely to ServicePay for transcription. It will not be submitted to chat until you review and approve the editable text.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('I consent'),
          ),
        ],
      ),
    );
    return accepted == true;
  }

  Future<void> _startVoiceRecording() async {
    if (!_voiceAllowed || _isRecording || _isTranscribing) return;
    if (!await _confirmVoiceConsent(speaking: false) || !mounted) return;
    try {
      await _voiceCapture.start();
      if (!mounted) {
        await _voiceCapture.cancel();
        return;
      }
      setState(() {
        _isRecording = true;
        _recordingSeconds = 0;
      });
      _recordingTimer?.cancel();
      _recordingTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        if (_recordingSeconds >= 29) {
          timer.cancel();
          _stopVoiceRecording();
        } else {
          setState(() => _recordingSeconds++);
        }
      });
    } catch (error) {
      await _voiceCapture.cancel();
      if (mounted)
        _showMessage(
            'Microphone access is unavailable. Check browser permission and try again.');
    }
  }

  Future<void> _stopVoiceRecording() async {
    if (!_isRecording) return;
    _recordingTimer?.cancel();
    setState(() {
      _isRecording = false;
      _isTranscribing = true;
    });
    try {
      final List<int> wav = await _voiceCapture.stop();
      final String transcript = await AiSupportApiService.transcribeVoice(
        Uint8List.fromList(wav),
        language: _language,
      );
      if (!mounted) return;
      setState(() => _voicePreviewController.text = transcript);
      _showMessage(
          'Review the transcription before adding it to your message.');
    } catch (error) {
      await _voiceCapture.cancel();
      if (mounted) _showMessage(_friendlyError(error));
    } finally {
      if (mounted) setState(() => _isTranscribing = false);
    }
  }

  Future<void> _cancelVoiceRecording() async {
    _recordingTimer?.cancel();
    await _voiceCapture.cancel();
    if (mounted) {
      setState(() {
        _isRecording = false;
        _isTranscribing = false;
        _recordingSeconds = 0;
      });
    }
  }

  Future<void> _playAssistantMessage(AiSupportMessage message) async {
    final int? index = message.messageIndex;
    if (index == null || !_voiceAllowed || message.role != 'ASSISTANT') return;
    if (!await _confirmVoiceConsent(speaking: true) || !mounted) return;
    try {
      final bytes = await AiSupportApiService.synthesizeVoice(
        messageIndex: index,
        messageText: message.message,
        language: _language,
      );
      await _audioPlayer.play(BytesSource(bytes));
      _showMessage(
          'AI-generated voice. This is a reading of saved support text.');
    } catch (error) {
      if (mounted) _showMessage(_friendlyError(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: background,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        titleSpacing: 18,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'ServicePay AI Support',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 2),
            Text(
              'Instant help for your ServicePay account and services',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w500,
                color: Color(0xFFD9F4E4),
              ),
            ),
          ],
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'My support tickets',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const SupportTicketsScreen(),
              ),
            ),
            icon: const Icon(Icons.confirmation_number_outlined),
          ),
          IconButton(
            key: const Key('ai-support-new-chat'),
            tooltip: 'Refresh/New Chat',
            onPressed: _isClearing ? null : _startNewChat,
            icon: _isClearing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            _buildSafetyAndLanguage(),
            if (_errorMessage != null)
              _StatusBanner(
                message: _errorMessage!,
                onDismiss: () {
                  setState(() {
                    _errorMessage = null;
                  });
                },
              ),
            Expanded(
              child: _isLoadingHistory
                  ? const _ChatLoadingState()
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 10),
                      itemCount: _messages.length + (_isSending ? 1 : 0),
                      itemBuilder: (BuildContext context, int index) {
                        if (_isSending && index == _messages.length) {
                          return const _TypingIndicator();
                        }

                        if (_evidence != null &&
                            index == _messages.length - 1 &&
                            _messages[index].role == 'ASSISTANT') {
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _ChatBubble(
                                message: _messages[index],
                                onSpeak: _voiceAllowed
                                    ? () =>
                                        _playAssistantMessage(_messages[index])
                                    : null,
                              ),
                              _EvidenceCard(evidence: _evidence!),
                            ],
                          );
                        }
                        return _ChatBubble(
                          message: _messages[index],
                          onSpeak: _voiceAllowed
                              ? () => _playAssistantMessage(_messages[index])
                              : null,
                        );
                      },
                    ),
            ),
            if (_messages.length > 1 && !_feedbackSent) _buildFeedbackPrompt(),
            if (_voicePreviewController.text.isNotEmpty) _buildVoicePreview(),
            if (_aiSupportEnabled) _buildQuickQuestions(),
            _buildHumanSupportButton(),
            _buildComposer(),
          ],
        ),
      ),
    );
  }

  Widget _buildSafetyAndLanguage() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
      decoration: const BoxDecoration(
        color: Color(0xFFE8F3EC),
        border: Border(bottom: BorderSide(color: Color(0xFFD4E6DA))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.verified_user_outlined,
                  color: darkGreen, size: 18),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'AI assistant. Never shares or moves your money.',
                  style: TextStyle(
                    color: darkGreen,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _language,
                  isDense: true,
                  items: const [
                    DropdownMenuItem(value: 'auto', child: Text('Auto')),
                    DropdownMenuItem(value: 'en', child: Text('English')),
                    DropdownMenuItem(value: 'ha', child: Text('Hausa')),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _language = value);
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          const Text(
            'Do not share your password, transaction PIN, or OTP. '
            'Kada ka tura kalmar sirri, PIN ko OTP.',
            style:
                TextStyle(fontSize: 11, height: 1.35, color: Color(0xFF345342)),
          ),
          if (_capabilities['hausaVoiceEnabled'] != true ||
              _capabilities['englishVoiceEnabled'] != true)
            const Padding(
              padding: EdgeInsets.only(top: 5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Voice verification is unavailable. Hausa text support remains available.',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: Color(0xFF52685B),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    'Idan kana bukatar taimako da Hausa, ka rubuta tambayarka da Hausa.',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: Color(0xFF52685B),
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildFeedbackPrompt() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 2, 16, 8),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              'Was this helpful?',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
          for (int rating = 1; rating <= 5; rating++)
            IconButton(
              tooltip: '$rating out of 5',
              visualDensity: VisualDensity.compact,
              onPressed: _feedbackSent ? null : () => _sendFeedback(rating),
              icon: Icon(
                rating <= _rating ? Icons.star : Icons.star_border,
                color: const Color(0xFFB67A18),
                size: 21,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildQuickQuestions() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 9),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: quickQuestions.map((String question) {
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ActionChip(
                label: Text(question),
                labelStyle: const TextStyle(
                  color: darkGreen,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
                backgroundColor: const Color(0xFFE5F4EA),
                side: const BorderSide(color: Color(0xFFCBE8D5)),
                onPressed: _isSending
                    ? null
                    : () {
                        _sendMessage(question);
                      },
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildHumanSupportButton() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 2, 16, 10),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          key: const Key('ai-support-contact-human'),
          onPressed: _contactHumanSupport,
          icon: const Icon(Icons.support_agent_rounded, size: 19),
          label: const Text('Contact Human Support'),
          style: OutlinedButton.styleFrom(
            foregroundColor: primaryGreen,
            side: const BorderSide(color: Color(0xFF9ED3B1)),
            padding: const EdgeInsets.symmetric(vertical: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
            textStyle: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildComposer() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: Color(0xFFE1EDE5)),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_selectedRecord != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: InputChip(
                key: const Key('ai-support-selected-record'),
                avatar: const Icon(Icons.fact_check_outlined, size: 17),
                label: Text(
                  'Record ${_selectedRecord!.reference.isEmpty ? _selectedRecord!.type : _selectedRecord!.reference}',
                  overflow: TextOverflow.ellipsis,
                ),
                onDeleted: () => setState(() => _selectedRecord = null),
              ),
            ),
          if (_isRecording)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  const Icon(Icons.fiber_manual_record,
                      color: Colors.red, size: 16),
                  const SizedBox(width: 7),
                  Expanded(
                      child: Text('Recording · ${_recordingSeconds}s / 30s')),
                  TextButton(
                    key: const Key('ai-support-record-cancel'),
                    onPressed: _cancelVoiceRecording,
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    key: const Key('ai-support-record-stop'),
                    onPressed: _stopVoiceRecording,
                    child: const Text('Stop'),
                  ),
                ],
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              IconButton(
                key: const Key('ai-support-select-record'),
                tooltip: 'Select a transaction or delivery record',
                onPressed: _aiSupportEnabled ? _selectRecord : null,
                icon: const Icon(Icons.receipt_long_outlined),
              ),
              if (_voiceAllowed)
                IconButton(
                  key: const Key('ai-support-record-voice'),
                  tooltip: 'Record a voice question',
                  onPressed: _isRecording || _isTranscribing
                      ? null
                      : _startVoiceRecording,
                  icon: _isTranscribing
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.mic_none_rounded),
                ),
              Expanded(
                child: TextField(
                  controller: _messageController,
                  enabled: _aiSupportEnabled && !_isSending,
                  minLines: 1,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  onSubmitted: (_) => _sendMessage(),
                  decoration: InputDecoration(
                    hintText: _aiSupportEnabled
                        ? 'Ask ServicePay AI Support...'
                        : 'AI Support is currently unavailable',
                    filled: true,
                    fillColor: const Color(0xFFF3F7F4),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 15,
                      vertical: 12,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                key: const Key('ai-support-send'),
                onPressed: _aiSupportEnabled && !_isSending
                    ? () => _sendMessage()
                    : null,
                style: IconButton.styleFrom(
                  backgroundColor: primaryGreen,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: const Color(0xFFD9E8DE),
                  disabledForegroundColor: Colors.white,
                  padding: const EdgeInsets.all(13),
                ),
                icon: const Icon(Icons.send_rounded, size: 20),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildVoicePreview() => Container(
        padding: const EdgeInsets.fromLTRB(14, 9, 14, 10),
        color: const Color(0xFFFFF7E8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Review your transcription. It has not been sent.',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            TextField(
              key: const Key('ai-support-transcription-preview'),
              controller: _voicePreviewController,
              minLines: 1,
              maxLines: 3,
              decoration: const InputDecoration(
                isDense: true,
                border: OutlineInputBorder(),
                filled: true,
                fillColor: Colors.white,
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: () => setState(() {
                      _voicePreviewController.clear();
                    }),
                    child: const Text('Discard'),
                  ),
                  FilledButton(
                    key: const Key('ai-support-use-transcription'),
                    onPressed: () {
                      _messageController.text = _voicePreviewController.text;
                      setState(() => _voicePreviewController.clear());
                    },
                    child: const Text('Use text'),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
}

class _ChatBubble extends StatelessWidget {
  final AiSupportMessage message;
  final VoidCallback? onSpeak;

  const _ChatBubble({required this.message, this.onSpeak});

  @override
  Widget build(BuildContext context) {
    final bool isUser = message.role == 'USER';

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 330),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFF08783E) : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(isUser ? 18 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 18),
          ),
          border: isUser ? null : Border.all(color: const Color(0xFFDDEBE1)),
          boxShadow: const <BoxShadow>[
            BoxShadow(
              color: Color(0x0A163322),
              blurRadius: 8,
              offset: Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message.message,
              style: TextStyle(
                color: isUser ? Colors.white : const Color(0xFF24352B),
                fontSize: 13.5,
                height: 1.4,
                fontWeight: FontWeight.w500,
              ),
            ),
            if (onSpeak != null && message.messageIndex != null)
              Align(
                alignment: Alignment.centerRight,
                child: IconButton(
                  key: Key('ai-support-speak-${message.messageIndex}'),
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Play AI-generated voice',
                  onPressed: onSpeak,
                  icon: const Icon(Icons.volume_up_outlined, size: 18),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RecordPicker extends StatefulWidget {
  const _RecordPicker({required this.selectedId, required this.onSelect});
  final String? selectedId;
  final ValueChanged<AiSupportRecord> onSelect;

  @override
  State<_RecordPicker> createState() => _RecordPickerState();
}

class _RecordPickerState extends State<_RecordPicker> {
  final List<AiSupportRecord> _records = <AiSupportRecord>[];
  String? _cursor;
  String? _error;
  bool _loading = true;
  bool _hasMore = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!_hasMore && !_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page =
          await AiSupportApiService.getRecords(cursor: _cursor, limit: 20);
      if (!mounted) return;
      setState(() {
        _records.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null && page.nextCursor!.isNotEmpty;
      });
    } catch (_) {
      if (mounted)
        setState(() => _error = 'Could not load your records. Try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 12, 8),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Choose a ServicePay record',
                        style: TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w800),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 18),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Read-only records from your account. No payment will be changed.',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: _error != null && _records.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(_error!),
                            TextButton(
                                onPressed: _load, child: const Text('Retry')),
                          ],
                        ),
                      )
                    : _records.isEmpty && !_loading
                        ? const Center(
                            child:
                                Text('No transaction or delivery records yet.'))
                        : ListView.builder(
                            itemCount: _records.length +
                                (_loading || _hasMore ? 1 : 0),
                            itemBuilder: (context, index) {
                              if (index == _records.length) {
                                if (_error != null) {
                                  return TextButton(
                                      onPressed: _load,
                                      child:
                                          const Text('Retry loading records'));
                                }
                                return Center(
                                  child: TextButton(
                                    onPressed: _loading ? null : _load,
                                    child: Text(_loading
                                        ? 'Loading records…'
                                        : 'Load more'),
                                  ),
                                );
                              }
                              final record = _records[index];
                              final date = record.createdAt?.toLocal();
                              return ListTile(
                                key: Key('ai-support-record-${record.id}'),
                                leading:
                                    const Icon(Icons.receipt_long_outlined),
                                title: Text(
                                  record.reference.isEmpty
                                      ? record.type
                                      : record.reference,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(
                                  '${record.type} · ${record.status}${date == null ? '' : ' · ${date.day}/${date.month}/${date.year}'}',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                trailing: widget.selectedId == record.id
                                    ? const Icon(Icons.check_circle,
                                        color: Color(0xFF08783E))
                                    : const Icon(Icons.chevron_right),
                                onTap: () => widget.onSelect(record),
                              );
                            },
                          ),
              ),
            ],
          ),
        ),
      );
}

class _EvidenceCard extends StatelessWidget {
  const _EvidenceCard({required this.evidence});
  final Map<String, dynamic> evidence;

  @override
  Widget build(BuildContext context) {
    final String kind = '${evidence['kind'] ?? 'Service record'}';
    final String status = '${evidence['status'] ?? 'Unavailable'}';
    final String reference = '${evidence['reference'] ?? ''}';
    final String type = '${evidence['type'] ?? ''}';
    final String verifiedAt = '${evidence['verifiedAt'] ?? ''}';
    return Container(
      width: 330,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF3F8),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFC7DCE8)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.fact_check_outlined,
                  size: 17, color: Color(0xFF285A72)),
              SizedBox(width: 7),
              Text('Stored ServicePay record',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 6),
          Text('$kind · $status', style: const TextStyle(fontSize: 12)),
          if (reference.isNotEmpty)
            Text('Reference: $reference', style: const TextStyle(fontSize: 11)),
          if (type.isNotEmpty)
            Text('Type: $type', style: const TextStyle(fontSize: 11)),
          if (verifiedAt.isNotEmpty)
            Text('Checked: $verifiedAt', style: const TextStyle(fontSize: 11)),
          const SizedBox(height: 5),
          const Text(
            'This record is separate from the AI response and does not authorize a financial action.',
            style: TextStyle(fontSize: 10.5, height: 1.3),
          ),
        ],
      ),
    );
  }
}

class _ChatLoadingState extends StatelessWidget {
  const _ChatLoadingState();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(18),
        children: const [
          _LoadingBubble(width: 235),
          SizedBox(height: 14),
          Align(
            alignment: Alignment.centerRight,
            child: _LoadingBubble(width: 180),
          ),
          SizedBox(height: 14),
          _LoadingBubble(width: 260),
        ],
      );
}

class _LoadingBubble extends StatelessWidget {
  const _LoadingBubble({required this.width});
  final double width;

  @override
  Widget build(BuildContext context) => Container(
        width: width,
        height: 62,
        decoration: BoxDecoration(
          color: const Color(0xFFE5EEE8),
          borderRadius: BorderRadius.circular(16),
        ),
      );
}

class _TypingIndicator extends StatelessWidget {
  const _TypingIndicator();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFDDEBE1)),
        ),
        child: const SizedBox(
          width: 42,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              _TypingDot(),
              _TypingDot(),
              _TypingDot(),
            ],
          ),
        ),
      ),
    );
  }
}

class _TypingDot extends StatelessWidget {
  const _TypingDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 7,
      height: 7,
      decoration: const BoxDecoration(
        color: Color(0xFF08783E),
        shape: BoxShape.circle,
      ),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  final String message;
  final VoidCallback onDismiss;

  const _StatusBanner({
    required this.message,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFFF4E5),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(15, 10, 8, 10),
        child: Row(
          children: <Widget>[
            const Icon(
              Icons.info_outline_rounded,
              color: Color(0xFF9A5B00),
              size: 19,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  color: Color(0xFF704400),
                  fontSize: 11.5,
                  height: 1.3,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            IconButton(
              onPressed: onDismiss,
              icon: const Icon(Icons.close_rounded, size: 18),
              color: const Color(0xFF704400),
              tooltip: 'Dismiss',
            ),
          ],
        ),
      ),
    );
  }
}
