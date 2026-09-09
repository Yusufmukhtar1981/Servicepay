import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AiSupportApiException implements Exception {
  final String message;
  final int? statusCode;
  final String? code;

  const AiSupportApiException(
    this.message, {
    this.statusCode,
    this.code,
  });

  @override
  String toString() => message;
}

class AiSupportMessage {
  final String role;
  final String message;
  final DateTime? createdAt;

  const AiSupportMessage({
    required this.role,
    required this.message,
    this.createdAt,
  });

  factory AiSupportMessage.fromJson(Map<String, dynamic> json) {
    final String rawRole = (json['role'] ?? '').toString().toUpperCase();
    final String role = rawRole == 'USER' ? 'USER' : 'ASSISTANT';

    DateTime? createdAt;
    final dynamic rawCreatedAt = json['createdAt'];
    if (rawCreatedAt is String) {
      createdAt = DateTime.tryParse(rawCreatedAt);
    }

    return AiSupportMessage(
      role: role,
      message: (json['message'] ?? '').toString(),
      createdAt: createdAt,
    );
  }
}

class AiSupportHistory {
  final List<AiSupportMessage> messages;
  final bool aiSupportEnabled;
  final bool humanEscalationEnabled;
  final String? conversationId;

  const AiSupportHistory({
    required this.messages,
    required this.aiSupportEnabled,
    required this.humanEscalationEnabled,
    this.conversationId,
  });
}

class AiSupportReply {
  final String reply;
  final String? conversationId;
  final bool escalationRecommended;

  const AiSupportReply({
    required this.reply,
    this.conversationId,
    required this.escalationRecommended,
  });
}

class AiSupportApiService {
  static const String baseUrl = 'https://api.servicepay.ng/api/ai-support';
  static const Duration requestTimeout = Duration(seconds: 35);

  static Future<AiSupportHistory> getHistory() async {
    final http.Response response = await http.get(
      Uri.parse('$baseUrl/history'),
      headers: await _authHeaders(),
    ).timeout(requestTimeout);

    final Map<String, dynamic> data = _handleResponse(response);
    final dynamic rawMessages = data['messages'];

    final List<AiSupportMessage> messages = rawMessages is List
        ? rawMessages
            .whereType<Map>()
            .map(
              (dynamic item) => AiSupportMessage.fromJson(
                Map<String, dynamic>.from(item as Map),
              ),
            )
            .where((AiSupportMessage item) => item.message.trim().isNotEmpty)
            .toList()
        : <AiSupportMessage>[];

    return AiSupportHistory(
      messages: messages,
      aiSupportEnabled: data['aiSupportEnabled'] != false,
      humanEscalationEnabled: data['humanEscalationEnabled'] != false,
      conversationId: _nullableString(data['conversationId']),
    );
  }

  static Future<AiSupportReply> sendMessage(String message) async {
    final http.Response response = await http
        .post(
          Uri.parse('$baseUrl/chat'),
          headers: await _authHeaders(),
          body: jsonEncode(<String, dynamic>{
            'message': message.trim(),
          }),
        )
        .timeout(requestTimeout);

    final Map<String, dynamic> data = _handleResponse(response);
    final String reply = (data['reply'] ?? '').toString().trim();

    if (reply.isEmpty) {
      throw const AiSupportApiException(
        'ServicePay AI Support returned an empty response.',
      );
    }

    return AiSupportReply(
      reply: reply,
      conversationId: _nullableString(data['conversationId']),
      escalationRecommended: data['escalationRecommended'] == true,
    );
  }

  static Future<void> deleteHistory() async {
    final http.Response response = await http.delete(
      Uri.parse('$baseUrl/history'),
      headers: await _authHeaders(),
    ).timeout(requestTimeout);

    _handleResponse(response);
  }

  static Future<Map<String, String>> _authHeaders() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String? token = prefs.getString('auth_token')?.trim();

    if (token == null || token.isEmpty) {
      throw const AiSupportApiException(
        'Your login session was not found. Please sign in again.',
      );
    }

    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  static Map<String, dynamic> _handleResponse(http.Response response) {
    Map<String, dynamic> data;

    try {
      final dynamic decoded = jsonDecode(response.body);
      data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      data = <String, dynamic>{};
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    }

    final String message = (data['message'] ?? '').toString().trim();

    throw AiSupportApiException(
      message.isNotEmpty ? message : _defaultError(response.statusCode),
      statusCode: response.statusCode,
      code: _nullableString(data['code']),
    );
  }

  static String _defaultError(int statusCode) {
    switch (statusCode) {
      case 401:
        return 'Your login session has expired. Please sign in again.';
      case 408:
      case 504:
        return 'AI Support took too long to respond. Please try again.';
      case 429:
        return 'AI Support is receiving too many messages. Please wait a moment.';
      case 500:
      case 502:
      case 503:
        return 'AI Support is temporarily unavailable. Please contact ServicePay Support.';
      default:
        return 'AI Support could not process your request.';
    }
  }

  static String? _nullableString(dynamic value) {
    final String result = (value ?? '').toString().trim();
    return result.isEmpty ? null : result;
  }
}