import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AmanaApiException implements Exception {
  const AmanaApiException(this.message, [this.statusCode]);
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class AmanaUploadFile {
  const AmanaUploadFile({
    required this.name,
    required this.bytes,
    required this.mimeType,
  });

  final String name;
  final Uint8List bytes;
  final String mimeType;

  bool get isImage => mimeType == 'image/jpeg' || mimeType == 'image/png';
  bool get isPdf => mimeType == 'application/pdf';
}

String amanaMimeTypeForName(String name) {
  final String extension = name.split('.').last.toLowerCase();
  if (extension == 'jpg' || extension == 'jpeg') return 'image/jpeg';
  if (extension == 'png') return 'image/png';
  if (extension == 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/// Authenticated client for the protected Amana endpoints.
///
/// Multipart uploads deliberately use the same authentication and error
/// handling as JSON requests; callers only need to supply an [AmanaUploadFile].
class AmanaApiService {
  static const String _baseUrl = 'https://api.servicepay.ng/api/amana';
  static const String _adminBaseUrl =
      'https://api.servicepay.ng/api/admin/amana';

  Future<Map<String, String>> _headers({bool json = true}) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    String? token;
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final String? value = preferences.getString(key);
      if (value != null && value.trim().isNotEmpty) {
        token = value.trim();
        break;
      }
    }
    if (token == null)
      throw const AmanaApiException('Please log in to continue.', 401);
    return <String, String>{
      'Accept': 'application/json',
      if (json) 'Content-Type': 'application/json',
      'Authorization': token.startsWith('Bearer ') ? token : 'Bearer $token',
    };
  }

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$_baseUrl$path').replace(queryParameters: query);
  Uri _adminUri(String path, [Map<String, String>? query]) =>
      Uri.parse('$_adminBaseUrl$path').replace(queryParameters: query);

  Future<Map<String, dynamic>> get(String path,
          {Map<String, String>? query}) async =>
      _decode(await http
          .get(_uri(path, query), headers: await _headers())
          .timeout(const Duration(seconds: 45)));

  Future<Map<String, dynamic>> post(String path,
          {Map<String, dynamic> body = const <String, dynamic>{}}) async =>
      _decode(await http
          .post(_uri(path), headers: await _headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 60)));

  Future<Map<String, dynamic>> patch(String path,
          {Map<String, dynamic> body = const <String, dynamic>{}}) async =>
      _decode(await http
          .patch(_uri(path), headers: await _headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 60)));

  Future<Map<String, dynamic>> postMultipart(
    String path, {
    Map<String, dynamic> fields = const <String, dynamic>{},
    AmanaUploadFile? attachment,
    String attachmentField = 'attachment',
  }) async {
    final http.MultipartRequest request =
        http.MultipartRequest('POST', _uri(path));
    request.headers.addAll(await _headers(json: false));
    fields.forEach((String key, dynamic value) {
      if (value != null)
        request.fields[key] = value is String ? value : jsonEncode(value);
    });
    if (attachment != null) {
      request.files.add(http.MultipartFile.fromBytes(
        attachmentField,
        attachment.bytes,
        filename: attachment.name,
        contentType: MediaType.parse(attachment.mimeType),
      ));
    }
    final http.StreamedResponse streamed =
        await request.send().timeout(const Duration(seconds: 90));
    return _decode(await http.Response.fromStream(streamed));
  }

  Future<Map<String, dynamic>> adminGet(String path,
          {Map<String, String>? query}) async =>
      _decode(await http
          .get(_adminUri(path, query), headers: await _headers())
          .timeout(const Duration(seconds: 45)));

  Future<Map<String, dynamic>> adminPost(String path,
          {Map<String, dynamic> body = const <String, dynamic>{}}) async =>
      _decode(await http
          .post(_adminUri(path),
              headers: await _headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 60)));

  Future<Map<String, dynamic>> adminPatch(String path,
          {Map<String, dynamic> body = const <String, dynamic>{}}) async =>
      _decode(await http
          .patch(_adminUri(path),
              headers: await _headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 60)));

  Future<Map<String, dynamic>> adminMultipart(
    String path, {
    Map<String, dynamic> fields = const <String, dynamic>{},
    List<AmanaUploadFile> files = const <AmanaUploadFile>[],
    String fileField = 'attachments',
  }) async {
    final http.MultipartRequest request =
        http.MultipartRequest('POST', _adminUri(path));
    request.headers.addAll(await _headers(json: false));
    fields.forEach((String key, dynamic value) {
      if (value != null)
        request.fields[key] = value is String ? value : jsonEncode(value);
    });
    for (final AmanaUploadFile file in files) {
      request.files.add(http.MultipartFile.fromBytes(
        fileField,
        file.bytes,
        filename: file.name,
        contentType: MediaType.parse(file.mimeType),
      ));
    }
    final http.StreamedResponse streamed =
        await request.send().timeout(const Duration(seconds: 90));
    return _decode(await http.Response.fromStream(streamed));
  }

  Map<String, dynamic> _decode(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = <String, dynamic>{};
    }
    final Map<String, dynamic> body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AmanaApiException(
        body['message']?.toString() ??
            body['error']?.toString() ??
            'Amana request failed.',
        response.statusCode,
      );
    }
    return body;
  }
}
