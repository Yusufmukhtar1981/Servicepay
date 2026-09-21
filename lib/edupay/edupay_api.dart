import '../services/session_store.dart';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class EduPayApi {
  EduPayApi({http.Client? client}) : _client = client ?? http.Client();
  static const baseUrl = 'https://api.servicepay.ng/api/edupay';
  final http.Client _client;

  Future<String> _token() async {
    await SharedPreferences.getInstance();
    return (await SessionStore.readToken()) ?? '';
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    final token = await _token();
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    };
    final uri = Uri.parse('$baseUrl$path');
    final response = method == 'GET'
        ? await _client.get(uri, headers: headers)
        : method == 'PATCH'
            ? await _client.patch(uri, headers: headers, body: jsonEncode(body))
            : await _client.post(uri, headers: headers, body: jsonEncode(body));
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = {};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 401) {
        await SessionStore.clear();
      }
      throw EduPayException(
        decoded is Map ? decoded['message']?.toString() : null,
        code: decoded is Map ? decoded['code']?.toString() : null,
        statusCode: response.statusCode,
      );
    }
    return decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> dashboard() => _send('GET', '/dashboard');
  Future<List<dynamic>> schools() async =>
      (await _send('GET', '/schools'))['schools'] as List? ?? [];

  Future<Map<String, dynamic>> requestSchool({
    required String schoolName,
    required String location,
    String? contactPhone,
  }) =>
      _send(
        'POST',
        '/school-requests',
        body: {
          'schoolName': schoolName.trim(),
          'location': location.trim(),
          if (contactPhone != null && contactPhone.trim().isNotEmpty)
            'contactPhone': contactPhone.trim(),
        },
      );

  /// The authoritative school-specific fee catalogue used when opening a plan.
  Future<Map<String, dynamic>> catalogue(String schoolId) =>
      _send('GET', '/schools/$schoolId/catalogue');
  Future<List<dynamic>> fees(
    String school, {
    String? session,
    String? term,
    String? classLevel,
  }) async {
    final q = <String, String>{
      if (session != null) 'session': session,
      if (term != null) 'term': term,
      if (classLevel != null) 'classLevel': classLevel,
    };
    final suffix = q.isEmpty
        ? ''
        : '?${q.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&')}';
    return (await _send('GET', '/schools/$school/fees$suffix'))['fees']
            as List? ??
        [];
  }

  Future<List<dynamic>> children() async =>
      (await _send('GET', '/children'))['children'] as List? ?? [];
  Future<List<dynamic>> academicChildren() async =>
      (await _send('GET', '/academic/children'))['children'] as List? ?? [];

  /// Returns only children the authenticated parent is authorized to monitor.
  /// This is deliberately separate from the fee-plan child catalogue: the
  /// activity center must never search for or infer a student by id.
  Future<List<dynamic>> parentActivityChildren() async =>
      (await _send('GET', '/activity-center/parent/children'))['children']
          as List? ??
      [];

  Future<Map<String, dynamic>> acceptGuardianLink(String code) => _send(
        'POST',
        '/activity-center/parent/guardian-links/accept',
        body: {'code': code.trim()},
      );

  Future<Map<String, dynamic>> parentStudentDashboard(String studentId) =>
      _send('GET', '/activity-center/parent/children/$studentId/dashboard');

  Future<Map<String, dynamic>> parentStudentTimeline(
    String studentId, {
    String? type,
    int page = 1,
  }) {
    final query = <String, String>{
      if (type != null && type.isNotEmpty && type != 'All') 'type': type,
      'page': '$page',
    };
    final suffix = query.entries
        .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
        .join('&');
    return _send(
      'GET',
      '/activity-center/parent/children/$studentId/timeline?$suffix',
    );
  }

  Future<Map<String, dynamic>> parentStudentSummary(String studentId) =>
      _send('GET', '/activity-center/parent/children/$studentId/summary');

  Future<Map<String, dynamic>> parentStudentAttendance(String studentId) =>
      parentStudentType(studentId, 'attendance');

  Future<Map<String, dynamic>> parentStudentResults(String studentId) =>
      _send('GET', '/activity-center/parent/children/$studentId/results');

  Future<Map<String, dynamic>> parentStudentAssignments(String studentId) =>
      parentStudentType(studentId, 'assignments');

  Future<Map<String, dynamic>> parentStudentActivities(String studentId) =>
      parentStudentType(studentId, 'activities');

  Future<Map<String, dynamic>> parentStudentAnnouncements(String studentId) =>
      parentStudentType(studentId, 'announcements');

  Future<Map<String, dynamic>> parentStudentConduct(String studentId) =>
      parentStudentType(studentId, 'conduct');

  Future<Map<String, dynamic>> parentStudentType(
    String studentId,
    String type,
  ) =>
      _send('GET', '/activity-center/parent/children/$studentId/$type');

  /// Academic endpoints intentionally return only the authenticated parent's
  /// linked child data. Published results and activities are filtered server
  /// side; the client must not infer visibility from finance records.
  Future<Map<String, dynamic>> academicAttendance(String childId) =>
      _send('GET', '/children/$childId/academic/attendance');

  Future<Map<String, dynamic>> academicResults(String childId) =>
      _send('GET', '/children/$childId/academic/results');

  Future<Map<String, dynamic>> academicActivities(String childId) =>
      _send('GET', '/children/$childId/academic/activities');

  Future<Map<String, dynamic>> academicTimetable(String childId) =>
      _send('GET', '/children/$childId/academic/timetable');
  Future<Map<String, dynamic>> createChild(Map<String, dynamic> data) =>
      _send('POST', '/children', body: data);
  Future<List<dynamic>> plans() async =>
      (await _send('GET', '/plans'))['plans'] as List? ?? [];
  Future<Map<String, dynamic>> createPlan(Map<String, dynamic> data) =>
      _send('POST', '/plans', body: data);
  Future<Map<String, dynamic>> plan(String id) => _send('GET', '/plans/$id');
  Future<Map<String, dynamic>> contribute(
    String id,
    double amount,
    String pin, {
    String? idempotencyKey,
  }) async {
    final canonicalAmount = amount.toStringAsFixed(2);
    final context = await _authContext();
    final prefs = await SharedPreferences.getInstance();
    final storageKey =
        'edupay.pendingContribution.$context.$id.$canonicalAmount';
    final pending = prefs.getString(storageKey);
    final key = pending ??
        idempotencyKey ??
        'edupay-${DateTime.now().microsecondsSinceEpoch}';
    if (pending == null) await prefs.setString(storageKey, key);
    try {
      final result = await _send(
        'POST',
        '/plans/$id/contributions',
        body: {'amount': amount, 'transactionPin': pin},
        idempotencyKey: key,
      ).timeout(const Duration(seconds: 30));
      await prefs.remove(storageKey);
      return result;
    } on EduPayException catch (e) {
      if (e.code == 'IDEMPOTENCY_REPLAY' ||
          e.code == 'DUPLICATE_CONTRIBUTION') {
        await prefs.remove(storageKey);
        return {'success': true, 'duplicate': true};
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> autosave(String id, Map<String, dynamic> data) =>
      _send('PATCH', '/plans/$id/autosave', body: data);
  Future<Map<String, dynamic>> invite(String id, String name) =>
      _send('POST', '/plans/$id/sponsor-invites', body: {'sponsorName': name});
  Future<Map<String, dynamic>> sponsorView(String token) =>
      _send('GET', '/sponsor/$token');
  Future<Map<String, dynamic>> sponsorContribute(
    String token,
    double amount,
    String pin, {
    String? idempotencyKey,
  }) =>
      _send(
        'POST',
        '/sponsor/$token/contribute',
        body: {'amount': amount, 'transactionPin': pin},
        idempotencyKey: idempotencyKey ??
            'edupay-sponsor-${DateTime.now().microsecondsSinceEpoch}',
      );
  Future<Map<String, dynamic>> history() async {
    final result = await _send('GET', '/history');
    await _reconcilePending(result);
    return result;
  }

  Future<String> _authContext() async {
    final token = (await SessionStore.readToken()) ?? '';
    if (token.isEmpty) return 'unauthenticated';
    return sha256.convert(utf8.encode(token)).toString().substring(0, 24);
  }

  Future<void> _reconcilePending(Map<String, dynamic> result) async {
    final prefs = await SharedPreferences.getInstance();
    final rows = <dynamic>[];
    void collect(dynamic value) {
      if (value is List) rows.addAll(value);
      if (value is Map) {
        collect(value['savingHistory']);
        collect(value['savings']);
        collect(value['rows']);
      }
    }

    collect(result);
    for (final row in rows.whereType<Map>()) {
      final key = row['idempotencyKey'] ?? row['clientReference'];
      if (key is String && key.isNotEmpty) {
        final keys = prefs
            .getKeys()
            .where((k) => k.startsWith('edupay.pendingContribution.'))
            .toList();
        for (final storageKey in keys) {
          if (prefs.getString(storageKey) == key)
            await prefs.remove(storageKey);
        }
      }
    }
  }

  Future<List<dynamic>> repayments() async =>
      (await _send('GET', '/repayments'))['repayments'] as List? ?? [];
  Future<Map<String, dynamic>> repay(
    String id,
    double amount,
    String pin, {
    String? idempotencyKey,
  }) =>
      _send(
        'POST',
        '/repayments/$id/payments',
        body: {'amount': amount, 'transactionPin': pin},
        idempotencyKey: idempotencyKey ??
            'edupay-repay-${DateTime.now().microsecondsSinceEpoch}',
      );
  Future<Map<String, dynamic>> receipt(String reference) =>
      _send('GET', '/receipts/$reference');
}

class EduPayException implements Exception {
  EduPayException(this.message, {this.code, this.statusCode});
  final String? message;
  final String? code;
  final int? statusCode;
  @override
  String toString() => message ?? 'Unable to complete that EduPay request.';
}
