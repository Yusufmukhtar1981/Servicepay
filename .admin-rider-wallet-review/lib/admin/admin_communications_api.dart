import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Authenticated client for the admin communications workspace.
class AdminCommunicationsApi {
  AdminCommunicationsApi({http.Client? client})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;

  static const _baseUrl = 'https://api.servicepay.ng/api/admin/communications';
  static const _timeout = Duration(seconds: 30);
  final http.Client _client;
  final bool _ownsClient;

  Future<Map<String, dynamic>> capabilities() =>
      _request('GET', 'capabilities');

  Future<Map<String, dynamic>> customers({
    String search = '',
    String role = '',
    String status = '',
    int page = 1,
    int limit = 20,
  }) =>
      _request('GET', 'customers', query: {
        if (search.trim().isNotEmpty) 'search': search.trim(),
        if (role.trim().isNotEmpty) 'role': role.trim(),
        if (status.trim().isNotEmpty) 'status': status.trim(),
        'page': '$page',
        'limit': '$limit',
      });

  Future<Map<String, dynamic>> preview({
    required String channel,
    required Map<String, dynamic> audience,
  }) =>
      _request('POST', 'audience/preview', payload: {
        'channel': channel,
        'audience': audience,
      });

  Future<Map<String, dynamic>> sendTest({
    required String subject,
    required String message,
    String heading = '',
    String buttonText = '',
    String buttonUrl = '',
    String? email,
  }) =>
      _request('POST', 'email/test', payload: {
        'subject': subject.trim(),
        'message': message.trim(),
        'heading': heading.trim(),
        'buttonText': buttonText.trim(),
        'buttonUrl': buttonUrl.trim(),
        if (email?.trim().isNotEmpty == true) 'email': email!.trim(),
      });

  Future<Map<String, dynamic>> broadcastEmail({
    required String subject,
    required String message,
    required Map<String, dynamic> audience,
    required String idempotencyKey,
    String heading = '',
    String buttonText = '',
    String buttonUrl = '',
  }) =>
      _request('POST', 'email/broadcast', payload: {
        'subject': subject.trim(),
        'message': message.trim(),
        'heading': heading.trim(),
        'buttonText': buttonText.trim(),
        'buttonUrl': buttonUrl.trim(),
        'audience': audience,
        'confirmation': true,
        'idempotencyKey': idempotencyKey,
      });

  Future<Map<String, dynamic>> broadcastNotification({
    required String title,
    required String message,
    required Map<String, dynamic> audience,
    required String idempotencyKey,
  }) =>
      _request('POST', 'notifications/broadcast', payload: {
        'title': title.trim(),
        'message': message.trim(),
        'audience': audience,
        'idempotencyKey': idempotencyKey,
      });

  Future<Map<String, dynamic>> history(String channel) =>
      _request('GET', '$channel/history');
  Future<Map<String, dynamic>> historyDetail(String channel, String id) =>
      _request('GET', '$channel/history/${Uri.encodeComponent(id)}');

  Future<Map<String, dynamic>> saveDraft({
    String? id,
    required String subject,
    required String message,
    required Map<String, dynamic> audience,
    String heading = '',
    String buttonText = '',
    String buttonUrl = '',
  }) =>
      _request(
          id == null ? 'POST' : 'PUT',
          id == null
              ? 'email/drafts'
              : 'email/drafts/${Uri.encodeComponent(id)}',
          payload: {
            'subject': subject.trim(),
            'message': message.trim(),
            'heading': heading.trim(),
            'buttonText': buttonText.trim(),
            'buttonUrl': buttonUrl.trim(),
            'audience': audience,
          });

  Future<Map<String, dynamic>> deleteDraft(String id) =>
      _request('DELETE', 'email/drafts/${Uri.encodeComponent(id)}');

  Future<Map<String, dynamic>> cancelCampaign(String id) =>
      _request('POST', 'email/history/${Uri.encodeComponent(id)}/cancel');

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query, Map<String, dynamic>? payload}) async {
    final uri = Uri.parse('$_baseUrl/$path').replace(queryParameters: query);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer ${await _token()}',
      if (payload != null) 'Content-Type': 'application/json',
    };
    late final http.Response response;
    if (method == 'POST') {
      response = await _client
          .post(uri, headers: headers, body: jsonEncode(payload))
          .timeout(_timeout);
    } else if (method == 'PUT') {
      response = await _client
          .put(uri, headers: headers, body: jsonEncode(payload))
          .timeout(_timeout);
    } else if (method == 'DELETE') {
      response = await _client.delete(uri, headers: headers).timeout(_timeout);
    } else {
      response = await _client.get(uri, headers: headers).timeout(_timeout);
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['success'] != true) {
      throw Exception(body['message']?.toString() ??
          'Unable to complete this communication request.');
    }
    return body;
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt'
    ]) {
      var value = prefs.getString(key)?.trim() ?? '';
      if (value.toLowerCase().startsWith('bearer ')) {
        value = value.substring(7).trim();
      }
      if (value.isNotEmpty) {
        return value;
      }
    }
    throw Exception('Your login session was not found. Please sign in again.');
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
