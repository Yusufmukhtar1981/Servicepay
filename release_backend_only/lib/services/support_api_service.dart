import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class SupportApiException implements Exception {
  const SupportApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class SupportTicket {
  const SupportTicket(this.data);
  final Map<String, dynamic> data;
  String get id => (data['_id'] ?? data['id'] ?? '').toString();
  String get reference => (data['caseReference'] ??
          data['reference'] ??
          data['ticketReference'] ??
          id)
      .toString();
  String get subject => (data['subject'] ?? 'Support request').toString();
  String get description => (data['description'] ?? '').toString();
  String get status => (data['status'] ?? 'OPEN').toString().toUpperCase();
  String get statusLabel {
    final supplied = (data['statusLabel'] ?? '').toString().trim();
    if (supplied.isNotEmpty) return supplied;
    if (status == 'IN_PROGRESS' || status == 'IN_REVIEW') return 'IN REVIEW';
    if (status == 'WAITING_ON_CUSTOMER') return 'AWAITING CUSTOMER';
    if (status == 'REJECTED') return 'CLOSED';
    return status.replaceAll('_', ' ');
  }

  String get category => (data['category'] ?? 'OTHER').toString().toUpperCase();
  String get categoryLabel => category
      .replaceAll('_', ' ')
      .toLowerCase()
      .split(' ')
      .where((word) => word.isNotEmpty)
      .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
      .join(' ');
  DateTime? get createdAt =>
      DateTime.tryParse((data['createdAt'] ?? '').toString())?.toLocal();
  Map<String, dynamic>? get transactionContext =>
      data['transactionContext'] is Map
          ? Map<String, dynamic>.from(data['transactionContext'] as Map)
          : null;
  String get priority =>
      (data['priority'] ?? 'NORMAL').toString().toUpperCase();
  String get resolution =>
      (data['resolution'] ?? data['resolutionNote'] ?? '').toString();
  List<Map<String, dynamic>> get replies =>
      _maps(data['replies'] ?? data['messages']);
  static List<Map<String, dynamic>> _maps(dynamic raw) => raw is List
      ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];
  factory SupportTicket.fromJson(Map<String, dynamic> json) =>
      SupportTicket(json);
}

class SupportTicketPage {
  const SupportTicketPage({
    required this.tickets,
    this.total = 0,
    this.page = 1,
    this.limit = 20,
  });
  final List<SupportTicket> tickets;
  final int total;
  final int page;
  final int limit;
  bool get hasMore => page * limit < total;
}

class TransactionIssueSubmissionKeys {
  TransactionIssueSubmissionKeys({
    Future<SharedPreferences> Function()? preferencesLoader,
  }) : _preferencesLoader = preferencesLoader ?? SharedPreferences.getInstance;

  static const String _prefix = 'pending_transaction_issue';
  final Future<SharedPreferences> Function() _preferencesLoader;

  String _accountScope(SharedPreferences preferences) {
    final String token = preferences.getString('auth_token') ?? '';
    var hash = 2166136261;
    for (final int byte in utf8.encode(token)) {
      hash ^= byte;
      hash = (hash * 16777619) & 0xffffffff;
    }
    return hash.toRadixString(16);
  }

  String _storageKey(SharedPreferences preferences, String lookupId) {
    return '${_prefix}_${_accountScope(preferences)}_${Uri.encodeComponent(lookupId)}';
  }

  Future<String> forTransaction(String lookupId) async {
    final SharedPreferences preferences = await _preferencesLoader();
    final String storageKey = _storageKey(preferences, lookupId);
    final String existing = preferences.getString(storageKey) ?? '';
    if (existing.isNotEmpty) return existing;

    final String normalized =
        lookupId.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '-');
    final String safeId =
        normalized.length > 60 ? normalized.substring(0, 60) : normalized;
    final String created =
        'transaction-issue-$safeId-${DateTime.now().microsecondsSinceEpoch}';
    await preferences.setString(storageKey, created);
    return created;
  }

  Future<void> complete(String lookupId) async {
    final SharedPreferences preferences = await _preferencesLoader();
    await preferences.remove(_storageKey(preferences, lookupId));
  }
}

class SupportApiService {
  SupportApiService({http.Client? client})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;
  static const String baseUrl = 'https://api.servicepay.ng/api/support';
  final http.Client _client;
  final bool _ownsClient;

  Future<SupportTicketPage> tickets({
    int page = 1,
    int limit = 20,
    String status = '',
    String category = '',
    String search = '',
  }) async {
    final body = await _request('GET', 'tickets', query: <String, String>{
      'page': '$page',
      'limit': '$limit',
      if (status.isNotEmpty) 'status': status,
      if (category.isNotEmpty) 'category': category,
      if (search.isNotEmpty) 'search': search,
    });
    final pageData =
        body['data'] is Map ? Map<String, dynamic>.from(body['data']) : body;
    final raw = pageData['tickets'] ?? pageData['items'];
    final tickets = raw is List
        ? raw
            .whereType<Map>()
            .map((e) => SupportTicket.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <SupportTicket>[];
    return SupportTicketPage(
        tickets: tickets,
        total: (pageData['total'] as num?)?.toInt() ?? tickets.length,
        page: (pageData['page'] as num?)?.toInt() ?? page,
        limit: (pageData['limit'] as num?)?.toInt() ?? limit);
  }

  Future<SupportTicket> ticket(String id) async {
    final body = await _request('GET', 'tickets/${Uri.encodeComponent(id)}');
    final raw = body['data'] is Map ? body['data'] : body;
    return SupportTicket.fromJson(Map<String, dynamic>.from(raw as Map));
  }

  Future<SupportTicket> createTicket({
    required String subject,
    required String description,
    required String priority,
    required String category,
    required String idempotencyKey,
    String? transactionLookupId,
  }) async {
    final body = await _request('POST', 'tickets', payload: {
      'subject': subject.trim(),
      'description': description.trim(),
      'priority': priority,
      'category': category,
      'idempotencyKey': idempotencyKey,
      if (transactionLookupId != null && transactionLookupId.trim().isNotEmpty)
        'transactionLookupId': transactionLookupId.trim(),
    });
    final raw = body['data'] is Map
        ? body['data']
        : body['ticket'] is Map
            ? body['ticket']
            : body;
    return SupportTicket.fromJson(Map<String, dynamic>.from(raw as Map));
  }

  Future<SupportTicket> reply(String id, String message,
      {required String idempotencyKey}) async {
    final body = await _request(
        'POST', 'tickets/${Uri.encodeComponent(id)}/replies',
        payload: {'message': message.trim(), 'idempotencyKey': idempotencyKey});
    final raw = body['data'] is Map
        ? body['data']
        : body['ticket'] is Map
            ? body['ticket']
            : body;
    return SupportTicket.fromJson(Map<String, dynamic>.from(raw as Map));
  }

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query, Map<String, dynamic>? payload}) async {
    final uri = Uri.parse('$baseUrl/$path').replace(queryParameters: query);
    final headers = await _headers(payload != null);
    final response = method == 'POST'
        ? await _client
            .post(uri, headers: headers, body: jsonEncode(payload))
            .timeout(const Duration(seconds: 30))
        : await _client
            .get(uri, headers: headers)
            .timeout(const Duration(seconds: 30));
    return _decode(response);
  }

  Future<Map<String, String>> _headers(bool json) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token')?.trim() ??
        prefs.getString('token')?.trim() ??
        '';
    if (token.isEmpty) {
      throw const SupportApiException(
          'Your login session was not found. Please sign in again.');
    }
    return {
      'Accept': 'application/json',
      'Authorization':
          'Bearer ${token.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')}',
      if (json) 'Content-Type': 'application/json'
    };
  }

  Map<String, dynamic> _decode(http.Response response) {
    dynamic raw;
    try {
      raw = jsonDecode(response.body);
    } catch (_) {}
    final data =
        raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        data['success'] == false) {
      throw SupportApiException(
          (data['message'] ?? 'Unable to contact support. Please try again.')
              .toString(),
          statusCode: response.statusCode);
    }
    return data;
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
