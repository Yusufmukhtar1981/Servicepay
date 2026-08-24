import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminKycApplication {
  const AdminKycApplication({
    required this.id,
    required this.status,
    required this.level,
    required this.requestedLevel,
    required this.firstName,
    required this.middleName,
    required this.lastName,
    required this.phone,
    required this.email,
    required this.address,
    required this.state,
    required this.lga,
    required this.gender,
    required this.dateOfBirth,
    required this.submittedAt,
    required this.reviewedAt,
    required this.rejectionReason,
    required this.selfieUploaded,
    required this.idDocumentUploaded,
    required this.idDocumentBackUploaded,
    required this.proofOfAddressUploaded,
    required this.selfieNeedsSecureReupload,
    required this.idDocumentNeedsSecureReupload,
    required this.proofOfAddressNeedsSecureReupload,
    required this.documentType,
    required this.ninVerified,
    required this.bvnVerified,
    required this.ninLast4,
    required this.bvnLast4,
    required this.identityMatchStatus,
    required this.reviewReason,
    required this.reviewHistory,
    required this.nin,
    required this.bvn,
    required this.verificationMethod,
    required this.verifiedAt,
  });

  final String id;
  final String status;
  final String level;
  final String requestedLevel;
  final String firstName;
  final String middleName;
  final String lastName;
  final String phone;
  final String email;
  final String address;
  final String state;
  final String lga;
  final String gender;
  final String dateOfBirth;
  final String submittedAt;
  final String reviewedAt;
  final String rejectionReason;
  final bool selfieUploaded;
  final bool idDocumentUploaded;
  final bool idDocumentBackUploaded;
  final bool proofOfAddressUploaded;
  final bool selfieNeedsSecureReupload;
  final bool idDocumentNeedsSecureReupload;
  final bool proofOfAddressNeedsSecureReupload;
  final String documentType;
  final bool ninVerified;
  final bool bvnVerified;
  final String ninLast4;
  final String bvnLast4;
  final String identityMatchStatus;
  final String reviewReason;
  final List<AdminKycReviewEvent> reviewHistory;
  final String nin;
  final String bvn;
  final String verificationMethod;
  final String verifiedAt;

  String get displayName => <String>[firstName, middleName, lastName]
      .where((name) => name.isNotEmpty)
      .join(' ');

  factory AdminKycApplication.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> user = json['user'] is Map
        ? Map<String, dynamic>.from(json['user'] as Map)
        : <String, dynamic>{};
    final Map<String, dynamic> documents = json['documents'] is Map
        ? Map<String, dynamic>.from(json['documents'] as Map)
        : <String, dynamic>{};
    final Map<String, dynamic> identity = json['identity'] is Map
        ? Map<String, dynamic>.from(json['identity'] as Map)
        : <String, dynamic>{};
    final Map<String, dynamic> verification = json['verification'] is Map
        ? Map<String, dynamic>.from(json['verification'] as Map)
        : <String, dynamic>{};
    String value(String key) =>
        (json[key] ?? user[key] ?? '').toString().trim();
    bool documentFlag(String key) {
      final dynamic value = documents[key] ?? json[key];
      if (value is bool) return value;
      return value?.toString().trim().toLowerCase() == 'true';
    }

    bool documentUploaded(String flagKey, String legacyUrlKey) {
      final dynamic flag = documents[flagKey] ?? json[flagKey];
      if (flag != null) return documentFlag(flagKey);
      // Legacy responses may contain document URLs. Only use their presence
      // to determine availability; never retain or display those URLs.
      final dynamic legacyUrl = documents[legacyUrlKey] ?? json[legacyUrlKey];
      return legacyUrl?.toString().trim().isNotEmpty == true;
    }

    return AdminKycApplication(
      id: value('_id').isNotEmpty ? value('_id') : value('id'),
      status: value('status').toUpperCase(),
      level: value('level').toUpperCase(),
      requestedLevel: value('requestedLevel').toUpperCase(),
      firstName: value('firstName'),
      middleName: value('middleName'),
      lastName: value('lastName'),
      phone: value('phone'),
      email: value('email'),
      address: value('address'),
      state: value('state'),
      lga: value('lga'),
      gender: value('gender'),
      dateOfBirth: value('dateOfBirth'),
      submittedAt: value('submittedAt'),
      reviewedAt: value('reviewedAt'),
      rejectionReason: value('rejectionReason'),
      selfieUploaded: documentUploaded('selfieUploaded', 'selfieUrl'),
      idDocumentUploaded:
          documentUploaded('idDocumentUploaded', 'idDocumentUrl'),
      idDocumentBackUploaded: documentUploaded(
        'idDocumentBackUploaded',
        'idDocumentBackUrl',
      ),
      proofOfAddressUploaded:
          documentUploaded('proofOfAddressUploaded', 'proofOfAddressUrl'),
      selfieNeedsSecureReupload: documentFlag('selfieNeedsSecureReupload'),
      idDocumentNeedsSecureReupload:
          documentFlag('idDocumentNeedsSecureReupload'),
      proofOfAddressNeedsSecureReupload:
          documentFlag('proofOfAddressNeedsSecureReupload'),
      documentType: (documents['documentType'] ?? json['documentType'] ?? '')
          .toString()
          .trim(),
      ninVerified: identity['ninVerified'] == true,
      bvnVerified: identity['bvnVerified'] == true,
      ninLast4: (identity['ninLast4'] ?? '').toString().trim(),
      bvnLast4: (identity['bvnLast4'] ?? '').toString().trim(),
      identityMatchStatus:
          (identity['matchStatus'] ?? 'NOT_VERIFIED').toString().trim(),
      reviewReason: value('reviewReason').isNotEmpty
          ? value('reviewReason')
          : value('rejectionReason'),
      reviewHistory: (json['reviewHistory'] as List<dynamic>? ?? <dynamic>[])
          .whereType<Map>()
          .map((Map entry) => AdminKycReviewEvent.fromJson(
                Map<String, dynamic>.from(entry),
              ))
          .toList(),
      nin: (json['nin'] ?? '').toString().trim(),
      bvn: (json['bvn'] ?? '').toString().trim(),
      verificationMethod:
          (verification['method'] ?? json['verificationMethod'] ?? '')
              .toString()
              .trim(),
      verifiedAt: (verification['verifiedAt'] ?? json['verifiedAt'] ?? '')
          .toString()
          .trim(),
    );
  }
}

class AdminKycApiService {
  static const String _baseUrl = 'https://api.servicepay.ng/api';

  static Future<List<AdminKycApplication>> applications({
    String search = '',
    String status = '',
  }) async {
    final Map<String, String> query = <String, String>{
      'limit': '50',
      if (search.trim().isNotEmpty) 'search': search.trim(),
      if (status.isNotEmpty) 'status': status,
    };
    final Map<String, dynamic> body = await _request(
      'GET',
      Uri.parse('$_baseUrl/admin/kyc').replace(queryParameters: query),
    );
    final dynamic raw = body['kycApplications'] ??
        (body['data'] is Map ? body['data']['kycApplications'] : null);
    if (raw is! List) return <AdminKycApplication>[];
    return raw
        .whereType<Map>()
        .map((Map item) =>
            AdminKycApplication.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  static Future<AdminKycApplication> application(String kycId) async {
    final Map<String, dynamic> body = await _request(
      'GET',
      Uri.parse('$_baseUrl/admin/kyc/${Uri.encodeComponent(kycId)}'),
    );
    final dynamic raw =
        body['kyc'] ?? (body['data'] is Map ? body['data']['kyc'] : null);
    if (raw is! Map) {
      throw Exception('The server returned an invalid KYC application.');
    }
    return AdminKycApplication.fromJson(Map<String, dynamic>.from(raw));
  }

  static Future<AdminKycApplication> updateStatus(
    String kycId, {
    required String status,
    String reviewReason = '',
  }) async {
    final Map<String, dynamic> body = await _request(
      'PATCH',
      Uri.parse('$_baseUrl/admin/kyc/${Uri.encodeComponent(kycId)}/status'),
      payload: <String, dynamic>{
        'status': status,
        if (status == 'REJECTED' || status == 'REQUEST_MORE_INFORMATION')
          'reviewReason': reviewReason.trim(),
        if (status == 'APPROVED' || status == 'VERIFIED')
          'manualOverride': true,
      },
    );
    final dynamic raw =
        body['kyc'] ?? (body['data'] is Map ? body['data']['kyc'] : null);
    if (raw is! Map) {
      throw Exception('The server returned an invalid KYC application.');
    }
    return AdminKycApplication.fromJson(Map<String, dynamic>.from(raw));
  }

  static Future<String> documentUrl(
    String kycId,
    String documentType,
  ) async {
    final Map<String, dynamic> body = await _request(
      'GET',
      Uri.parse(
        '$_baseUrl/admin/kyc/${Uri.encodeComponent(kycId)}/document/'
        '${Uri.encodeComponent(documentType)}',
      ),
    );
    final String url = (body['url'] ??
            (body['data'] is Map ? body['data']['url'] : null) ??
            '')
        .toString()
        .trim();
    if (url.isEmpty) {
      throw Exception(
          'The server did not provide an authorized document link.');
    }
    return url;
  }

  static Future<Map<String, dynamic>> _request(
    String method,
    Uri uri, {
    Map<String, dynamic>? payload,
  }) async {
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
      final String? value = preferences.getString(key)?.trim();
      if (value != null && value.isNotEmpty) {
        token = value.toLowerCase().startsWith('bearer ')
            ? value.substring(7).trim()
            : value;
        break;
      }
    }
    if (token == null || token.isEmpty) {
      throw Exception(
          'Your login session was not found. Please sign in again.');
    }
    final http.Response response = method == 'PATCH'
        ? await http.patch(
            uri,
            headers: <String, String>{
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(payload),
          )
        : await http.get(uri, headers: <String, String>{
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
          });
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final Map<String, dynamic> body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        body['message']?.toString() ?? 'Unable to complete this request.',
      );
    }
    return body;
  }
}

class AdminKycReviewEvent {
  const AdminKycReviewEvent({
    required this.action,
    required this.reason,
    required this.occurredAt,
  });

  final String action;
  final String reason;
  final String occurredAt;

  factory AdminKycReviewEvent.fromJson(Map<String, dynamic> json) {
    return AdminKycReviewEvent(
      action: (json['action'] ?? '').toString().trim(),
      reason: (json['reason'] ?? '').toString().trim(),
      occurredAt: (json['occurredAt'] ?? '').toString().trim(),
    );
  }
}
