import 'dart:convert';

import 'package:http/http.dart' as http;

import '../services/session_store.dart';

class BranchOperationalRequestsException implements Exception {
  const BranchOperationalRequestsException(this.message);

  final String message;

  @override
  String toString() => message;
}

abstract class BranchOperationalRequestsApi {
  Future<List<Map<String, dynamic>>> list();

  Future<Map<String, dynamic>> create({
    required String type,
    required String title,
    required String description,
  });

  Future<Map<String, dynamic>> update({
    required String requestId,
    String? assignedStaffId,
    bool updateAssignment = false,
    String? status,
    required String reason,
  });
}

class BranchOperationalRequestsHttpApi implements BranchOperationalRequestsApi {
  BranchOperationalRequestsHttpApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.tokenReader = SessionStore.readToken,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<String?> Function() tokenReader;

  Uri get _uri {
    final String root = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    final String apiRoot = root.endsWith('/api') ? root : '$root/api';
    return Uri.parse('$apiRoot/branches/operational-requests');
  }

  Future<Map<String, String>> _headers() async {
    final String token = (await tokenReader() ?? '')
        .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
        .trim();
    if (token.isEmpty) {
      throw const BranchOperationalRequestsException(
          'Your session has expired. Sign in again.');
    }
    return <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _decode(http.Response response) async {
    dynamic decoded;
    try {
      decoded = response.body.trim().isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
    } on FormatException {
      throw const BranchOperationalRequestsException(
          'The branch request service returned an invalid response.');
    }
    final Map<String, dynamic> root = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw BranchOperationalRequestsException(
          '${root['message'] ?? 'Unable to complete the operational request.'}');
    }
    return root;
  }

  @override
  Future<List<Map<String, dynamic>>> list() async {
    final http.Response response =
        await _client.get(_uri, headers: await _headers());
    final Map<String, dynamic> root = await _decode(response);
    final dynamic rows = root['requests'] ??
        (root['data'] is Map ? (root['data'] as Map)['requests'] : null);
    return rows is List
        ? rows
            .whereType<Map>()
            .map((Map row) => Map<String, dynamic>.from(row))
            .toList()
        : <Map<String, dynamic>>[];
  }

  @override
  Future<Map<String, dynamic>> create({
    required String type,
    required String title,
    required String description,
  }) async {
    final Map<String, String> headers = await _headers()
      ..['Content-Type'] = 'application/json';
    final http.Response response = await _client.post(
      _uri,
      headers: headers,
      body: jsonEncode(<String, dynamic>{
        'type': type.trim().toUpperCase(),
        'title': title.trim(),
        'description': description.trim(),
        'metadata': <String, dynamic>{},
      }),
    );
    final Map<String, dynamic> root = await _decode(response);
    final dynamic request = root['request'] ??
        (root['data'] is Map ? (root['data'] as Map)['request'] : null);
    return request is Map ? Map<String, dynamic>.from(request) : root;
  }

  @override
  Future<Map<String, dynamic>> update({
    required String requestId,
    String? assignedStaffId,
    bool updateAssignment = false,
    String? status,
    required String reason,
  }) async {
    final Map<String, dynamic> body = <String, dynamic>{
      if (updateAssignment) 'assignedStaffId': assignedStaffId,
      if (status != null) 'status': status,
      'reason': reason.trim(),
    };
    final Map<String, dynamic> root = await _request(
      'PATCH',
      '${_uri.path}/${Uri.encodeComponent(requestId)}',
      body: body,
    );
    final dynamic request = root['request'] ??
        (root['data'] is Map ? (root['data'] as Map)['request'] : null);
    return request is Map ? Map<String, dynamic>.from(request) : root;
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final Map<String, String> headers = await _headers();
    if (body != null) headers['Content-Type'] = 'application/json';
    final Uri uri = _uri.replace(path: path);
    final http.Response response = switch (method) {
      'POST' => await _client.post(
          uri,
          headers: headers,
          body: body == null ? null : jsonEncode(body),
        ),
      'PATCH' => await _client.patch(
          uri,
          headers: headers,
          body: body == null ? null : jsonEncode(body),
        ),
      _ => await _client.get(uri, headers: headers),
    };
    return _decode(response);
  }
}
