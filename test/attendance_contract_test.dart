import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/edupay/academic_child_profile_screen.dart';
import 'package:servicepay_app/edupay/edupay_api.dart';
import 'package:servicepay_app/edupay/edupay_screen.dart';

class _AttendanceClient extends http.BaseClient {
  final requests = <String>[];
  int attendanceRequests = 0;

  String _day(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    requests.add(path);
    dynamic body;
    if (path.contains('/academic/attendance')) {
      attendanceRequests++;
      body = {
        'attendance': [
          {
            'date': _day(DateTime.now().subtract(const Duration(days: 1))),
            'status': 'Absent',
            'classLevel': {'name': 'Primary 4'},
            'session': {'name': '2025/2026'},
            'term': {'name': 'Second term'},
          },
          {
            'date': _day(DateTime.now()),
            'status': 'Present',
            'classLevel': {'name': 'Primary 4'},
            'session': {'name': '2025/2026'},
            'term': {'name': 'Second term'},
          },
        ],
      };
    } else if (path.contains('/academic/results')) {
      body = {'results': []};
    } else if (path.contains('/academic/activities')) {
      body = {'activities': []};
    } else if (path.contains('/academic/timetable')) {
      body = {'timetable': []};
    } else if (path == '/api/edupay/dashboard') {
      body = {
        'settings': {'enabled': true},
        'summary': {},
      };
    } else if (path == '/api/edupay/children') {
      body = {
        'children': [
          {'_id': 'finance-1', 'fullName': 'Ada Child'},
          {'_id': 'finance-2', 'fullName': 'Bola Child'},
        ],
      };
    } else if (path == '/api/edupay/academic/children') {
      body = {
        'children': [
          {'_id': 'academic-1', 'fullName': 'Ada Child'},
          {'_id': 'academic-2', 'fullName': 'Bola Child'},
        ],
      };
    } else if (path == '/api/edupay/activity-center/parent/children') {
      body = {
        'children': [
          {'id': 'student-center-1', 'fullName': 'Center Only Child'},
        ],
      };
    } else if (path == '/api/edupay/plans') {
      body = {'plans': []};
    } else if (path == '/api/edupay/repayments') {
      body = {'repayments': []};
    } else if (path == '/api/edupay/history') {
      body = {'history': {}, 'ledger': []};
    } else if (path == '/api/edupay/schools') {
      body = {'schools': []};
    } else {
      body = {};
    }
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(body))),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
  });

  testWidgets('attendance uses _id before id/studentId and renders contract', (
    tester,
  ) async {
    final client = _AttendanceClient();
    await tester.pumpWidget(
      MaterialApp(
        home: AcademicChildProfileScreen(
          api: EduPayApi(client: client),
          child: const {
            '_id': 'academic-child-1',
            'id': 'wrong-id',
            'studentId': 'finance-student',
            'fullName': 'Ada Child',
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(client.requests, everyElement(contains('academic-child-1')));
    expect(find.text('Ada Child'), findsWidgets);

    await tester.tap(find.text('Attendance').last);
    await tester.pumpAndSettle();
    expect(find.text("Today's Attendance"), findsOneWidget);
    expect(find.text("Today's status"), findsOneWidget);
    expect(find.text('Today\'s status'), findsOneWidget);
    expect(find.text('Present'), findsWidgets);
    expect(find.text('Absent'), findsWidgets);
    expect(find.text('Attendance rate'), findsOneWidget);
    expect(find.text('50%'), findsOneWidget);
    expect(find.text('Attendance history'), findsOneWidget);
    expect(find.textContaining('${DateTime.now().year}-'), findsWidgets);
    expect(find.text('Primary 4'), findsWidgets);
    expect(find.text('2025/2026 · Second term'), findsWidgets);
  });

  testWidgets(
    'missing authorized child id fails clearly without academic calls',
    (tester) async {
      final client = _AttendanceClient();
      await tester.pumpWidget(
        MaterialApp(
          home: AcademicChildProfileScreen(
            api: EduPayApi(client: client),
            child: const {'studentId': 'finance-only', 'fullName': 'Unlinked'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('authorized academic profile id'),
        findsOneWidget,
      );
      expect(client.requests, isEmpty);
    },
  );

  testWidgets('attendance toolbar refresh refetches without duplicate ids', (
    tester,
  ) async {
    final client = _AttendanceClient();
    await tester.pumpWidget(
      MaterialApp(
        home: AcademicChildProfileScreen(
          api: EduPayApi(client: client),
          child: const {'id': 'academic-child-2', 'fullName': 'Bola Child'},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(client.attendanceRequests, 1);
    await tester.tap(find.byIcon(Icons.refresh));
    await tester.pumpAndSettle();
    expect(client.attendanceRequests, 2);
  });

  testWidgets(
    'My Children keeps academic children separate from activity ids',
    (tester) async {
      final client = _AttendanceClient();
      await tester.pumpWidget(
        MaterialApp(
          home: EduPayScreen(api: EduPayApi(client: client)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Children'));
      await tester.pumpAndSettle();
      expect(find.text('Ada Child'), findsOneWidget);
      expect(find.text('Bola Child'), findsOneWidget);
      expect(find.text('Center Only Child'), findsNothing);
      expect(find.textContaining('1 linked student'), findsOneWidget);
    },
  );
}
