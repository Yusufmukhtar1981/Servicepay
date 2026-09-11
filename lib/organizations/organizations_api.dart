import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'organization_models.dart';

class OrganizationsApi {
  static final Random _secureRandom = Random.secure();

  static String _createIdempotencyKey() {
    final List<int> randomBytes = List<int>.generate(
      18,
      (_) => _secureRandom.nextInt(256),
    );
    return 'organization-${DateTime.now().microsecondsSinceEpoch}-'
        '${base64UrlEncode(randomBytes)}';
  }

  OrganizationsApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/organizations',
  }) : _client = client ?? http.Client();
  final http.Client _client;
  final String baseUrl;

  Future<List<Organization>> mine() async {
    final data = await _request('GET', '/mine');
    final owned = data['organizations'] is List
        ? data['organizations'] as List
        : const [];
    final memberships =
        data['memberships'] is List ? data['memberships'] as List : const [];
    final result = <Organization>[];
    for (final item in owned.whereType<Map>()) {
      result.add(Organization.fromJson(Map<String, dynamic>.from(item)));
    }
    for (final item in memberships.whereType<Map>()) {
      final membership = Map<String, dynamic>.from(item);
      final rawOrg = membership['organization'];
      if (rawOrg is Map) {
        final json = Map<String, dynamic>.from(rawOrg);
        json['membership'] = membership;
        result.add(Organization.fromJson(json));
      }
    }
    return result;
  }

  Future<List<Organization>> explore({String query = ''}) async =>
      _list('/explore', query.isEmpty ? null : {'search': query});
  Future<Organization> detail(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}');
    final raw = data['organization'];
    final organization =
        raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    if (data['membership'] is Map) {
      organization['membership'] = data['membership'];
    }
    if ('${organization['id'] ?? organization['_id'] ?? ''}'.trim().isEmpty) {
      organization['id'] = id;
    }
    return Organization.fromJson(organization);
  }

  Future<Map<String, dynamic>> membership(String id) async =>
      _request('GET', '/${Uri.encodeComponent(id)}/membership');
  Future<Map<String, dynamic>> card(String id) async =>
      _request('GET', '/${Uri.encodeComponent(id)}/card');
  Future<Map<String, dynamic>> dashboard(String id) async =>
      _request('GET', '/${Uri.encodeComponent(id)}/dashboard');
  Future<List<Map<String, dynamic>>> members(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}/members');
    final raw = data['members'] ?? data['data'] ?? const [];
    return (raw is List ? raw : const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  Future<Map<String, dynamic>> approveMember({
    required String organizationId,
    required String memberId,
  }) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(organizationId)}/members/${Uri.encodeComponent(memberId)}/approve',
      );

  /// Owner-safe, read-only section resources. The API returns the envelope
  /// unchanged so the UI never has to invent fields.
  Future<Map<String, dynamic>> ownerSection(
    String id,
    String section, {
    int page = 1,
    int limit = 25,
    String search = '',
    String status = '',
    String branchId = '',
  }) {
    final query = <String, String>{
      'page': '$page',
      'limit': '$limit',
      if (search.trim().isNotEmpty) 'search': search.trim(),
      if (status.trim().isNotEmpty) 'status': status.trim(),
      if (branchId.trim().isNotEmpty) 'branchId': branchId.trim(),
    };
    // section is an API route and may intentionally contain a slash.
    return _request(
      'GET',
      '/${Uri.encodeComponent(id)}/$section',
      query: query,
    );
  }

  Future<Map<String, dynamic>> ownerDashboard(String id) => dashboard(id);
  Future<Map<String, dynamic>> membersSearch(
    String id, {
    String search = '',
    String status = '',
    String branchId = '',
    int page = 1,
  }) =>
      ownerSection(
        id,
        'members/search',
        search: search,
        status: status,
        page: page,
        branchId: branchId,
      );
  Future<Map<String, dynamic>> applications(
    String id, {
    String status = '',
    int page = 1,
  }) =>
      ownerSection(id, 'applications', status: status, page: page);
  Future<Map<String, dynamic>> applicationDetail(
    String id,
    String applicationId,
  ) =>
      _request(
        'GET',
        '/${Uri.encodeComponent(id)}/applications/${Uri.encodeComponent(applicationId)}',
      );
  Future<Map<String, dynamic>> paymentHistory(
    String id, {
    String status = '',
    String memberId = '',
    String branchId = '',
    String feeType = '',
    String from = '',
    String to = '',
    int page = 1,
  }) =>
      _request(
        'GET',
        '/${Uri.encodeComponent(id)}/payment-history',
        query: {
          'page': '$page',
          'limit': '25',
          if (status.trim().isNotEmpty) 'status': status.trim(),
          if (memberId.trim().isNotEmpty) 'memberId': memberId.trim(),
          if (branchId.trim().isNotEmpty) 'branchId': branchId.trim(),
          if (feeType.trim().isNotEmpty) 'feeType': feeType.trim(),
          if (from.trim().isNotEmpty) 'from': from.trim(),
          if (to.trim().isNotEmpty) 'to': to.trim(),
        },
      );
  Future<Map<String, dynamic>> fees(String id, {int page = 1}) =>
      ownerSection(id, 'fees', page: page);
  Future<Map<String, dynamic>> walletDetails(String id) =>
      ownerSection(id, 'wallet/details');
  Future<Map<String, dynamic>> branches(String id, {int page = 1}) =>
      ownerSection(id, 'branches', page: page);
  Future<Map<String, dynamic>> staffList(String id, {int page = 1}) =>
      ownerSection(id, 'staff/list', page: page);
  Future<Map<String, dynamic>> announcements(String id, {int page = 1}) =>
      ownerSection(id, 'announcements', page: page);
  Future<Map<String, dynamic>> cards(String id, {int page = 1}) =>
      ownerSection(id, 'cards', page: page);
  Future<Map<String, dynamic>> reports(
    String id, {
    int page = 1,
    String kind = '',
    String period = '',
  }) =>
      _request(
        'GET',
        '/${Uri.encodeComponent(id)}/reports',
        query: {
          'page': '$page',
          'limit': '25',
          if (kind.trim().isNotEmpty) 'kind': kind.trim(),
          if (period.trim().isNotEmpty) 'period': period.trim(),
        },
      );
  Future<Map<String, dynamic>> audit(
    String id, {
    int page = 1,
    String action = '',
    String actor = '',
    String entityType = '',
    String from = '',
    String to = '',
  }) =>
      _request(
        'GET',
        '/${Uri.encodeComponent(id)}/audit',
        query: {
          'page': '$page',
          'limit': '25',
          if (action.trim().isNotEmpty) 'action': action.trim(),
          if (actor.trim().isNotEmpty) 'actor': actor.trim(),
          if (entityType.trim().isNotEmpty) 'entityType': entityType.trim(),
          if (from.trim().isNotEmpty) 'from': from.trim(),
          if (to.trim().isNotEmpty) 'to': to.trim(),
        },
      );
  Future<Map<String, dynamic>> settings(String id) =>
      ownerSection(id, 'settings');

  // Owner mutations are deliberately named so callers cannot accidentally
  // send a mutation to the read endpoint for another dashboard section.
  Future<Map<String, dynamic>> approveApplication(
    String id,
    String applicationId,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/applications/${Uri.encodeComponent(applicationId)}/approve',
        body: {},
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> rejectApplication(
    String id,
    String applicationId,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/applications/${Uri.encodeComponent(applicationId)}/reject',
        body: {},
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> createFee(
    String id,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/fees',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> updateFee(
    String id,
    String feeId,
    Map<String, dynamic> body,
  ) =>
      _request(
        'PATCH',
        '/${Uri.encodeComponent(id)}/fees/${Uri.encodeComponent(feeId)}',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> setFeeStatus(
    String id,
    String feeId,
    String status,
  ) =>
      updateFee(id, feeId, {
        'active': status.toUpperCase() == 'ACTIVE',
        'status': status,
      });
  Future<Map<String, dynamic>> createBranch(
    String id,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/branches',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> updateBranch(
    String id,
    String branchId,
    Map<String, dynamic> body,
  ) =>
      _request(
        'PATCH',
        '/${Uri.encodeComponent(id)}/branches/${Uri.encodeComponent(branchId)}',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> setBranchStatus(
    String id,
    String branchId,
    String status,
  ) =>
      updateBranch(id, branchId, {
        'active': status.toUpperCase() == 'ACTIVE',
        'status': status,
      });
  Future<Map<String, dynamic>> createStaff(
    String id,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/staff',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> updateStaff(
    String id,
    String staffId,
    Map<String, dynamic> body,
  ) =>
      _request(
        'PATCH',
        '/${Uri.encodeComponent(id)}/staff/${Uri.encodeComponent(staffId)}',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> setStaffStatus(
    String id,
    String staffId,
    String status,
  ) =>
      updateStaff(id, staffId, {
        'active': status.toUpperCase() == 'ACTIVE',
        'status': status,
      });
  Future<Map<String, dynamic>> publishAnnouncement(
    String id,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/announcements',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> patchSettings(
    String id,
    Map<String, dynamic> body,
  ) =>
      _request('PATCH', '/${Uri.encodeComponent(id)}/settings', body: body);
  Future<Map<String, dynamic>> memberStatus(
    String id,
    String memberId,
    String status,
  ) =>
      _request(
        'PATCH',
        '/${Uri.encodeComponent(id)}/members/${Uri.encodeComponent(memberId)}/status',
        body: {'status': status},
      );
  Future<Map<String, dynamic>> memberDetail(
    String id,
    String memberId,
  ) =>
      _request(
        'GET',
        '/${Uri.encodeComponent(id)}/members/${Uri.encodeComponent(memberId)}/detail',
      );
  Future<Map<String, dynamic>> patchMemberDetail(
    String id,
    String memberId,
    Map<String, dynamic> body,
  ) =>
      _request(
        'PATCH',
        '/${Uri.encodeComponent(id)}/members/${Uri.encodeComponent(memberId)}/detail',
        body: body,
      );
  Future<Map<String, dynamic>> cardDetail(String id, String cardId) => _request(
        'GET',
        '/${Uri.encodeComponent(id)}/cards/${Uri.encodeComponent(cardId)}',
      );
  Future<Map<String, dynamic>> feeAssignments(String id) =>
      ownerSection(id, 'fee-assignments/summary');
  Future<Map<String, dynamic>> assignFee(
    String id,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/fee-assignments',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> messageMember(
    String id,
    String memberId,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(id)}/members/${Uri.encodeComponent(memberId)}/message',
        body: body,
        idempotencyKey: _createIdempotencyKey(),
      );

  Future<Map<String, dynamic>> apply(String id, Map<String, dynamic> fields) =>
      _request('POST', '/${Uri.encodeComponent(id)}/apply', body: fields);

  Future<Map<String, dynamic>> create(Map<String, dynamic> payload) =>
      _request('POST', '', body: payload);

  Future<Map<String, dynamic>> submit(String id) =>
      _request('POST', '/${Uri.encodeComponent(id)}/submit');
  Future<List<OrganizationPayment>> payments(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}/payments');
    final raw = data['payments'] ?? data['data'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map(
              (e) => OrganizationPayment.fromJson(Map<String, dynamic>.from(e)),
            )
            .toList()
        : <OrganizationPayment>[];
  }

  Future<List<Map<String, dynamic>>> dues(String id) async {
    final data = await _request('GET', '/${Uri.encodeComponent(id)}/dues');
    final raw = data['dues'] ?? data['data'];
    final list = raw is List ? raw : <dynamic>[];
    return list
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  Future<Map<String, dynamic>> payAnnual({
    required String organizationId,
    required String pin,
  }) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(organizationId)}/annual-payment',
        body: {'transactionPin': pin},
        idempotencyKey: _createIdempotencyKey(),
      );
  Future<Map<String, dynamic>> pay({
    required String organizationId,
    required String dueId,
    required String pin,
  }) =>
      _request(
        'POST',
        '/${Uri.encodeComponent(organizationId)}/payments',
        body: {'dueId': dueId, 'transactionPin': pin},
        idempotencyKey: _createIdempotencyKey(),
      );

  Future<List<Organization>> _list(
    String path, [
    Map<String, String>? query,
  ]) async {
    final data = await _request('GET', path, query: query);
    final raw = data['organizations'] ?? data['data'] ?? data['items'];
    final list = raw is List
        ? raw
        : raw is Map
            ? <dynamic>[raw]
            : <dynamic>[];
    return list
        .whereType<Map>()
        .map((e) => Organization.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    String? idempotencyKey,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    var token = prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('access_token');
    if (token == null || token.trim().isEmpty) {
      throw Exception(
        'Your login session was not found. Please sign in again.',
      );
    }
    token = token.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${token.trim()}',
    };
    if (idempotencyKey != null) headers['X-Idempotency-Key'] = idempotencyKey;
    final response = method == 'GET'
        ? await _client.get(uri, headers: headers)
        : method == 'PATCH'
            ? await _client.patch(
                uri,
                headers: headers,
                body: jsonEncode(body ?? {}),
              )
            : await _client.post(
                uri,
                headers: headers,
                body: jsonEncode(body ?? {}),
              );
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        data['success'] == false) {
      throw OrganizationApiException(
        response.statusCode,
        data['message']?.toString() ??
            'Organization request failed. Please try again.',
      );
    }
    return data;
  }
}

/// Backwards-compatible short name for screens and integrations.
typedef OrganizationApi = OrganizationsApi;

class OrganizationApiException implements Exception {
  const OrganizationApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  @override
  String toString() => message;
}
