import 'dart:convert';
import 'dart:typed_data';

import 'session_store.dart';

import 'package:http/http.dart' as http;

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
  final int? messageIndex;

  const AiSupportMessage({
    required this.role,
    required this.message,
    this.createdAt,
    this.messageIndex,
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
      messageIndex: _asInt(
        json['messageIndex'] ?? json['index'] ?? json['serverMessageIndex'],
      ),
    );
  }
}

class AiSupportHistory {
  final List<AiSupportMessage> messages;
  final bool aiSupportEnabled;
  final bool humanEscalationEnabled;
  final String? conversationId;
  final Map<String, dynamic> capabilities;

  const AiSupportHistory({
    required this.messages,
    required this.aiSupportEnabled,
    required this.humanEscalationEnabled,
    this.conversationId,
    this.capabilities = const <String, dynamic>{},
  });
}

class AiSupportReply {
  final String reply;
  final String? conversationId;
  final bool escalationRecommended;
  final String language;
  final String source;
  final Map<String, dynamic>? ticket;
  final Map<String, dynamic>? evidence;
  final int? assistantMessageIndex;

  const AiSupportReply({
    required this.reply,
    this.conversationId,
    required this.escalationRecommended,
    this.language = 'en',
    this.source = 'ai',
    this.ticket,
    this.evidence,
    this.assistantMessageIndex,
  });
}

class AiSupportRecord {
  const AiSupportRecord({
    required this.id,
    required this.type,
    required this.status,
    required this.reference,
    required this.createdAt,
  });

  final String id;
  final String type;
  final String status;
  final String reference;
  final DateTime? createdAt;

  factory AiSupportRecord.fromJson(Map<String, dynamic> json) {
    return AiSupportRecord(
      id: (json['id'] ?? '').toString(),
      type: (json['type'] ?? 'Service record').toString(),
      status: (json['status'] ?? 'Unknown').toString(),
      reference: (json['reference'] ?? '').toString(),
      createdAt: DateTime.tryParse((json['createdAt'] ?? '').toString()),
    );
  }
}

class AiSupportRecordPage {
  const AiSupportRecordPage({required this.items, this.nextCursor});
  final List<AiSupportRecord> items;
  final String? nextCursor;
}

class AiSupportTicket {
  const AiSupportTicket({
    required this.id,
    required this.caseReference,
    required this.status,
  });
  final String id;
  final String caseReference;
  final String status;
}

class AiSupportApiService {
  static const String apiRoot = String.fromEnvironment(
    'SERVICEPAY_API_BASE_URL',
    defaultValue: 'https://api.servicepay.ng/api',
  );
  static String get baseUrl {
    final String root = apiRoot.replaceFirst(RegExp(r'/+$'), '');
    return '${root.endsWith('/api') ? root : '$root/api'}/ai-support';
  }

  static const Duration requestTimeout = Duration(seconds: 35);

  static Future<AiSupportHistory> getHistory({http.Client? client}) async {
    final http.Response response = await (client ?? http.Client())
        .get(
          Uri.parse('$baseUrl/history'),
          headers: await _authHeaders(),
        )
        .timeout(requestTimeout);

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
      aiSupportEnabled: data['aiSupportEnabled'] != false &&
          (data['capabilities'] is! Map ||
              (data['capabilities'] as Map)['smartSupportEnabled'] != false),
      humanEscalationEnabled: data['humanEscalationEnabled'] != false,
      conversationId: _nullableString(data['conversationId']),
      capabilities: data['capabilities'] is Map
          ? Map<String, dynamic>.from(data['capabilities'] as Map)
          : const <String, dynamic>{},
    );
  }

  static Future<AiSupportReply> sendMessage(
    String message, {
    String language = 'auto',
    String? transactionLookupId,
    http.Client? client,
  }) async {
    final http.Client requestClient = client ?? http.Client();
    late final http.Response response;
    try {
      response = await requestClient
          .post(
            Uri.parse('$baseUrl/chat'),
            headers: await _authHeaders(),
            body: jsonEncode(<String, dynamic>{
              'message': message.trim(),
              'language': language,
              if (transactionLookupId != null &&
                  transactionLookupId.trim().isNotEmpty)
                'transactionLookupId': transactionLookupId.trim(),
            }),
          )
          .timeout(requestTimeout);
    } finally {
      if (client == null) requestClient.close();
    }

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
      language: _nullableString(data['language']) ?? 'en',
      source: _nullableString(data['source']) ?? 'ai',
      ticket: data['ticket'] is Map
          ? Map<String, dynamic>.from(data['ticket'] as Map)
          : null,
      evidence: data['evidence'] is Map
          ? Map<String, dynamic>.from(data['evidence'] as Map)
          : null,
      assistantMessageIndex: _nullableInt(
        data['assistantMessageIndex'] ?? data['messageIndex'],
      ),
    );
  }

  static Future<AiSupportRecordPage> getRecords({
    String? cursor,
    int limit = 20,
    http.Client? client,
  }) async {
    final Map<String, String> query = <String, String>{'limit': '$limit'};
    if (cursor != null && cursor.isNotEmpty) query['cursor'] = cursor;
    final Uri uri =
        Uri.parse('$baseUrl/records').replace(queryParameters: query);
    final http.Client requestClient = client ?? http.Client();
    late final http.Response response;
    try {
      response = await requestClient
          .get(uri, headers: await _authHeaders())
          .timeout(requestTimeout);
    } finally {
      if (client == null) requestClient.close();
    }
    final Map<String, dynamic> data = _handleResponse(response);
    final dynamic rawData = data['data'];
    final Map<String, dynamic> result =
        rawData is Map ? Map<String, dynamic>.from(rawData) : data;
    final dynamic rawItems = result['items'];
    return AiSupportRecordPage(
      items: rawItems is List
          ? rawItems
              .whereType<Map>()
              .map((dynamic item) =>
                  AiSupportRecord.fromJson(Map<String, dynamic>.from(item)))
              .where((AiSupportRecord item) => item.id.isNotEmpty)
              .toList()
          : <AiSupportRecord>[],
      nextCursor: _nullableString(result['nextCursor']),
    );
  }

  static Future<String> transcribeVoice(
    Uint8List wavBytes, {
    required String language,
    http.Client? client,
  }) async {
    final http.Client requestClient = client ?? http.Client();
    late final http.Response response;
    try {
      response = await requestClient
          .post(
            Uri.parse('$baseUrl/voice/transcribe'),
            headers: await _authHeaders(),
            body: jsonEncode(<String, dynamic>{
              'audioBase64': base64Encode(wavBytes),
              'language': language,
              'consent': true,
            }),
          )
          .timeout(requestTimeout);
    } finally {
      if (client == null) requestClient.close();
    }
    final Map<String, dynamic> data = _handleResponse(response);
    final dynamic rawData = data['data'];
    final Map<String, dynamic> result =
        rawData is Map ? Map<String, dynamic>.from(rawData) : data;
    final String text = (result['text'] ?? '').toString().trim();
    if (text.isEmpty) {
      throw const AiSupportApiException(
          'No speech was detected. Please try again.');
    }
    return text;
  }

  static Future<Uint8List> synthesizeVoice({
    required int messageIndex,
    required String messageText,
    required String language,
    http.Client? client,
  }) async {
    final http.Client requestClient = client ?? http.Client();
    late final http.Response response;
    try {
      response = await requestClient
          .post(
            Uri.parse('$baseUrl/voice/speech'),
            headers: await _authHeaders(),
            body: jsonEncode(<String, dynamic>{
              'messageIndex': messageIndex,
              'messageText': messageText,
              'language': language,
              'consent': true,
            }),
          )
          .timeout(requestTimeout);
    } finally {
      if (client == null) requestClient.close();
    }
    final Map<String, dynamic> data = _handleResponse(response);
    final dynamic rawData = data['data'];
    final Map<String, dynamic> result =
        rawData is Map ? Map<String, dynamic>.from(rawData) : data;
    final String encoded = (result['audioBase64'] ?? '').toString();
    if (encoded.isEmpty || result['mimeType'] != 'audio/mpeg') {
      throw const AiSupportApiException(
          'Voice playback is unavailable right now.');
    }
    return base64Decode(encoded);
  }

  static Future<AiSupportTicket> escalate(
    String message, {
    String? transactionLookupId,
    http.Client? client,
  }) async {
    final http.Client requestClient = client ?? http.Client();
    late final http.Response response;
    try {
      response = await requestClient
          .post(
            Uri.parse('$baseUrl/escalate'),
            headers: await _authHeaders(),
            body: jsonEncode(<String, dynamic>{
              'message': message.trim(),
              if (transactionLookupId != null &&
                  transactionLookupId.trim().isNotEmpty)
                'transactionLookupId': transactionLookupId.trim(),
            }),
          )
          .timeout(requestTimeout);
    } finally {
      if (client == null) requestClient.close();
    }
    final Map<String, dynamic> data = _handleResponse(response);
    final Map<String, dynamic> ticket = data['data'] is Map
        ? Map<String, dynamic>.from(data['data'] as Map)
        : data;
    final String id = _nullableString(ticket['id']) ?? '';
    if (id.isEmpty) {
      throw const AiSupportApiException(
        'Support request was not created. Please try again.',
      );
    }
    return AiSupportTicket(
      id: id,
      caseReference:
          _nullableString(ticket['caseReference']) ?? 'Support request',
      status: _nullableString(ticket['status']) ?? 'OPEN',
    );
  }

  static Future<Map<String, dynamic>?> getFeedback() async {
    final http.Response response = await http
        .get(Uri.parse('$baseUrl/feedback'), headers: await _authHeaders())
        .timeout(requestTimeout);
    final Map<String, dynamic> data = _handleResponse(response);
    return data['data'] is Map
        ? Map<String, dynamic>.from(data['data'] as Map)
        : null;
  }

  static Future<void> submitFeedback(int rating, {String? comment}) async {
    final http.Response response = await http
        .post(
          Uri.parse('$baseUrl/feedback'),
          headers: await _authHeaders(),
          body: jsonEncode(<String, dynamic>{
            'rating': rating,
            if (comment != null && comment.trim().isNotEmpty)
              'comment': comment.trim(),
          }),
        )
        .timeout(requestTimeout);
    _handleResponse(response);
  }

  static Future<void> deleteHistory() async {
    final http.Response response = await http
        .delete(
          Uri.parse('$baseUrl/history'),
          headers: await _authHeaders(),
        )
        .timeout(requestTimeout);

    _handleResponse(response);
  }

  static Future<Map<String, String>> _authHeaders() async {
    final String? token = (await SessionStore.readToken())?.trim();

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

  static int? _nullableInt(dynamic value) =>
      value is num ? value.toInt() : int.tryParse((value ?? '').toString());
}

int? _asInt(dynamic value) =>
    value is num ? value.toInt() : int.tryParse((value ?? '').toString());
