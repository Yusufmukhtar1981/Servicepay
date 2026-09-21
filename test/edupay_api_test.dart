import 'dart:convert';
import 'dart:async';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/edupay/edupay_api.dart';

class _Client extends http.BaseClient {
  http.Request? last;
  int status = 200;
  dynamic response = {'success': true};
  bool timeout = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    last = request as http.Request;
    if (timeout) throw TimeoutException('network timeout');
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(response))),
      status,
      headers: {'content-type': 'application/json'},
    );
  }
}

String _contextForTest(String token) =>
    sha256.convert(utf8.encode(token)).toString().substring(0, 24);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
  });

  test('contribution uses backend keys and idempotency header', () async {
    final client = _Client();
    final api = EduPayApi(client: client);
    await api.contribute('plan-1', 12500, '4821', idempotencyKey: 'same-key');
    expect(client.last?.url.path, '/api/edupay/plans/plan-1/contributions');
    expect(client.last?.headers['authorization'], 'Bearer test-token');
    expect(client.last?.headers['idempotency-key'], 'same-key');
    expect(jsonDecode(client.last!.body), {
      'amount': 12500.0,
      'transactionPin': '4821',
    });
  });

  test('contribution reuses pending idempotency key after timeout', () async {
    final client = _Client()..timeout = true;
    final api = EduPayApi(client: client);
    await expectLater(
      api.contribute('plan-timeout', 12500, '4821'),
      throwsA(isA<TimeoutException>()),
    );
    final firstKey = client.last!.headers['idempotency-key'];
    client.timeout = false;
    await api.contribute('plan-timeout', 12500, '4821');
    expect(client.last!.headers['idempotency-key'], firstKey);
    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getString('edupay.pendingContribution.'
          '${_contextForTest('test-token')}.plan-timeout.12500.00'),
      isNull,
    );
  });

  test('school-fee plan payload preserves savings preferences', () async {
    final client = _Client();
    final api = EduPayApi(client: client);
    await api.createPlan({
      'child': 'child-1',
      'school': 'school-1',
      'classLevel': 'class-1',
      'session': 'session-1',
      'term': 'term-1',
      'feeStructure': 'fee-1',
      'targetDate': '2027-01-01',
      'targetAmount': 45000.0,
      'savingFrequency': 'WEEKLY',
      'preferredContributionAmount': 12500.0,
    });
    expect(client.last?.url.path, '/api/edupay/plans');
    expect(jsonDecode(client.last!.body)['savingFrequency'], 'WEEKLY');
    expect(jsonDecode(client.last!.body)['targetAmount'], 45000.0);
    expect(
        jsonDecode(client.last!.body)['preferredContributionAmount'], 12500.0);
    expect(jsonDecode(client.last!.body).containsKey('recommendedContribution'),
        false);
  });

  test('authenticated sponsor contribution uses token route and PIN', () async {
    final client = _Client();
    final api = EduPayApi(client: client);
    await api.sponsorContribute('invite-token', 5000, '1234',
        idempotencyKey: 'sponsor-key');
    expect(
        client.last?.url.path, '/api/edupay/sponsor/invite-token/contribute');
    expect(client.last?.headers['idempotency-key'], 'sponsor-key');
    expect(jsonDecode(client.last!.body)['transactionPin'], '1234');
  });

  test('disabled response preserves authoritative backend code', () async {
    final client = _Client()
      ..status = 403
      ..response = {
        'success': false,
        'code': 'EDUPAY_DISABLED',
        'message': 'temporarily unavailable',
      };
    expect(
      () => EduPayApi(client: client).createPlan({}),
      throwsA(isA<EduPayException>()
          .having((e) => e.code, 'code', 'EDUPAY_DISABLED')),
    );
  });

  test('history reads contributions, repayments, and ledger from customer API',
      () async {
    final client = _Client()
      ..response = {
        'success': true,
        'contributions': [
          {'id': 'contribution-1'}
        ],
        'repayments': [
          {'id': 'repayment-1'}
        ],
        'ledger': [],
      };
    final history = await EduPayApi(client: client).history();
    expect(client.last?.url.path, '/api/edupay/history');
    expect(history['contributions'], isNotEmpty);
    expect(history['repayments'], isNotEmpty);
  });

  test('catalogue uses the authoritative customer catalogue endpoint',
      () async {
    final client = _Client()
      ..response = {
        'success': true,
        'schools': [],
        'sessions': [],
        'terms': [],
        'classes': [],
      };
    final catalogue = await EduPayApi(client: client).catalogue('school-1');
    expect(client.last?.url.path, '/api/edupay/schools/school-1/catalogue');
    expect(catalogue['classes'], isEmpty);
  });

  test('requestSchool posts a non-financial school onboarding request',
      () async {
    final client = _Client();
    final api = EduPayApi(client: client);

    await api.requestSchool(
      schoolName: 'Bright Future Academy',
      location: 'Ikeja, Lagos',
      contactPhone: '08012345678',
    );

    expect(client.last?.url.path, '/api/edupay/school-requests');
    expect(jsonDecode(client.last!.body), {
      'schoolName': 'Bright Future Academy',
      'location': 'Ikeja, Lagos',
      'contactPhone': '08012345678',
    });
    expect(client.last?.headers['authorization'], 'Bearer test-token');
  });

  test('parent activity center uses verified-child endpoints only', () async {
    final client = _Client()
      ..response = {
        'children': [
          {'id': 'student-1', 'fullName': 'Ada Student'}
        ]
      };
    final api = EduPayApi(client: client);
    final linked = await api.parentActivityChildren();
    expect(linked.single['id'], 'student-1');
    expect(
        client.last?.url.path, '/api/edupay/activity-center/parent/children');

    await api.parentStudentDashboard('student-1');
    expect(client.last?.url.path,
        '/api/edupay/activity-center/parent/children/student-1/dashboard');
    await api.parentStudentTimeline('student-1', type: 'Attendance', page: 2);
    expect(client.last?.url.path,
        '/api/edupay/activity-center/parent/children/student-1/timeline');
    expect(
        client.last?.url.queryParameters, {'type': 'Attendance', 'page': '2'});
    await api.parentStudentSummary('student-1');
    expect(client.last?.url.path,
        '/api/edupay/activity-center/parent/children/student-1/summary');
    await api.parentStudentAttendance('student-1');
    expect(client.last?.url.path,
        '/api/edupay/activity-center/parent/children/student-1/attendance');
    await api.parentStudentAssignments('student-1');
    expect(client.last?.url.path,
        '/api/edupay/activity-center/parent/children/student-1/assignments');
  });

  test('parent activity center preserves backend isolation errors', () async {
    final client = _Client()
      ..status = 403
      ..response = {
        'success': false,
        'code': 'EDUPAY_FORBIDDEN',
        'message': 'Student is not linked',
      };
    expect(
      () => EduPayApi(client: client).parentStudentDashboard('unrelated'),
      throwsA(isA<EduPayException>()
          .having((e) => e.code, 'code', 'EDUPAY_FORBIDDEN')),
    );
  });

  test('guardian invite acceptance posts the one-time code without storing it',
      () async {
    final client = _Client()
      ..response = {
        'success': true,
        'link': {'id': 'link-1'},
      };
    final api = EduPayApi(client: client);
    await api.acceptGuardianLink(' SCHOOL-ONE-TIME ');
    expect(client.last?.url.path,
        '/api/edupay/activity-center/parent/guardian-links/accept');
    expect(jsonDecode(client.last!.body), {'code': 'SCHOOL-ONE-TIME'});
  });

  test('guardian invite acceptance preserves invalid and expired errors',
      () async {
    for (final failure in [
      (400, 'Guardian code is invalid.'),
      (410, 'Guardian code has expired.'),
      (409, 'Guardian code has already been used.'),
    ]) {
      final client = _Client()
        ..status = failure.$1
        ..response = {'success': false, 'message': failure.$2};
      expect(
        () => EduPayApi(client: client).acceptGuardianLink('one-time-code'),
        throwsA(isA<EduPayException>().having(
          (e) => e.message,
          'message',
          failure.$2,
        )),
      );
    }
  });
}
