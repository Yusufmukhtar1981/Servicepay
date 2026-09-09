import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'services/ai_support_api_service.dart';

class AiSupportScreen extends StatefulWidget {
  const AiSupportScreen({super.key});

  @override
  State<AiSupportScreen> createState() => _AiSupportScreenState();
}

class _AiSupportScreenState extends State<AiSupportScreen> {
  static const Color primaryGreen = Color(0xFF08783E);
  static const Color darkGreen = Color(0xFF075B30);
  static const Color background = Color(0xFFF5FAF7);
  static const String supportPhone = '2349136151515';
  static const String supportMessage =
      'Hello ServicePay Support, I need assistance with my ServicePay account.';
  static const String welcomeMessage =
      'Hello 👋 I’m ServicePay AI Support. I can help with transfers, wallet funding, airtime, data, electricity, cable TV, delivery, KYC, Empowerment, transaction PIN, withdrawals and other ServicePay services.';
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

  bool _isLoadingHistory = true;
  bool _isSending = false;
  bool _isClearing = false;
  bool _aiSupportEnabled = false;
  bool _humanEscalationEnabled = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoadingHistory = true;
      _errorMessage = null;
    });

    try {
      final AiSupportHistory history = await AiSupportApiService.getHistory();

      if (!mounted) {
        return;
      }

      setState(() {
        _messages
          ..clear()
          ..addAll(history.messages);
        _aiSupportEnabled = history.aiSupportEnabled;
        _humanEscalationEnabled = history.humanEscalationEnabled;
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
      final AiSupportReply response =
          await AiSupportApiService.sendMessage(message);

      if (!mounted) {
        return;
      }

      setState(() {
        _messages.add(
          AiSupportMessage(
            role: 'ASSISTANT',
            message: response.reply,
            createdAt: DateTime.now(),
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

    final Uri uri = Uri.https(
      'wa.me',
      '/$supportPhone',
      <String, String>{'text': supportMessage},
    );

    try {
      final bool opened = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );

      if (!opened && mounted) {
        _showMessage('Unable to open WhatsApp. Please try again.');
      }
    } catch (_) {
      if (mounted) {
        _showMessage('Unable to open WhatsApp. Please try again.');
      }
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
                  ? const Center(
                      child: CircularProgressIndicator(
                        color: primaryGreen,
                      ),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 10),
                      itemCount: _messages.length + (_isSending ? 1 : 0),
                      itemBuilder: (BuildContext context, int index) {
                        if (_isSending && index == _messages.length) {
                          return const _TypingIndicator();
                        }

                        return _ChatBubble(message: _messages[index]);
                      },
                    ),
            ),
            if (_aiSupportEnabled) _buildQuickQuestions(),
            _buildHumanSupportButton(),
            _buildComposer(),
          ],
        ),
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
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: <Widget>[
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
            onPressed:
                _aiSupportEnabled && !_isSending ? () => _sendMessage() : null,
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
    );
  }
}

class _ChatBubble extends StatelessWidget {
  final AiSupportMessage message;

  const _ChatBubble({required this.message});

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
        child: Text(
          message.message,
          style: TextStyle(
            color: isUser ? Colors.white : const Color(0xFF24352B),
            fontSize: 13.5,
            height: 1.4,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
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
