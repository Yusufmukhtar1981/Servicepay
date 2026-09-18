import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/edupay/edupay_api.dart';
import 'package:servicepay_app/edupay/edupay_screen.dart';
import 'package:servicepay_app/edupay/student_activity_center.dart';
import 'package:servicepay_app/dashboard_screen.dart';

class _DashboardClient extends http.BaseClient {
  _DashboardClient({this.enabled = true});
  final bool enabled;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    final body = path.endsWith('/dashboard')
        ? {
            'success': true,
            'settings': {'enabled': enabled},
            'summary': {}
          }
        : path.endsWith('/plans')
            ? {'success': true, 'plans': []}
            : path.endsWith('/children')
                ? {'success': true, 'children': []}
                : path.endsWith('/repayments')
                    ? {'success': true, 'repayments': []}
                    : path.endsWith('/history')
                        ? {
                            'success': true,
                            'contributions': [],
                            'repayments': [],
                            'ledger': [],
                          }
                        : {'success': true, 'schools': []};
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(body))),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

class _RequestSchoolClient extends _DashboardClient {
  _RequestSchoolClient({super.enabled});
  String? requestPath;
  Map<String, dynamic>? requestBody;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path.endsWith('/school-requests')) {
      requestPath = request.url.path;
      requestBody =
          jsonDecode((request as http.Request).body) as Map<String, dynamic>;
      return http.StreamedResponse(
        Stream.value(utf8.encode(jsonEncode({'success': true}))),
        201,
        headers: {'content-type': 'application/json'},
      );
    }
    return super.send(request);
  }
}

class _PlanFlowClient extends http.BaseClient {
  Map<String, dynamic>? createdPlan;
  String? cataloguePath;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    dynamic body;
    if (request is http.Request && request.body.isNotEmpty) {
      body = jsonDecode(request.body);
      if (path.endsWith('/plans')) createdPlan = body as Map<String, dynamic>;
    }
    if (path.contains('/catalogue')) cataloguePath = path;
    final response = path.endsWith('/dashboard')
        ? {
            'success': true,
            'settings': {'enabled': true},
            'summary': {},
          }
        : path.endsWith('/children')
            ? {
                'success': true,
                'children': [
                  {
                    '_id': 'child-1',
                    'fullName': 'Ada Child',
                    'school': {'_id': 'school-2', 'name': 'Child School'},
                  }
                ]
              }
            : path.endsWith('/schools')
                ? {
                    'success': true,
                    'schools': [
                      {
                        '_id': 'school-1',
                        'name': 'Other School',
                        'active': true
                      },
                      {
                        '_id': 'school-2',
                        'name': 'Approved School',
                        'active': true
                      },
                    ]
                  }
                : path.endsWith('/catalogue')
                    ? {
                        'success': true,
                        'sessions': [
                          {'_id': 'session-1', 'name': '2026/2027'}
                        ],
                        'terms': [
                          {'_id': 'term-1', 'name': 'First term'}
                        ],
                        'classes': [
                          {'_id': 'class-1', 'name': 'Primary 1'}
                        ],
                      }
                    : path.endsWith('/fees')
                        ? {
                            'success': true,
                            'fees': [
                              {
                                '_id': 'fee-1',
                                'name': 'Primary 1 fees',
                                'amount': 100000,
                              }
                            ]
                          }
                        : path.endsWith('/plans')
                            ? {'success': true, 'plan': createdPlan ?? {}}
                            : {'success': true, 'schools': []};
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(response))),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

class _ActivityCenterClient extends http.BaseClient {
  _ActivityCenterClient({this.forbidden = false});
  final bool forbidden;
  String? lastPath;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    lastPath = request.url.path;
    final path = request.url.path;
    if (forbidden && path.endsWith('/dashboard')) {
      return http.StreamedResponse(
        Stream.value(utf8.encode(jsonEncode({
          'success': false,
          'code': 'EDUPAY_FORBIDDEN',
          'message': 'Student is not linked',
        }))),
        403,
        headers: {'content-type': 'application/json'},
      );
    }
    final body = path.endsWith('/dashboard')
        ? {
            'student': {
              'fullName': 'Ada Student',
              'admissionNumber': 'ST-1',
              'school': {'name': 'Bright Future Academy'},
            },
            'attendance': {
              'today': 'Present',
              'presentDays': 12,
              'absentDays': 1,
              'percentage': 92,
            },
            'latestPublishedResult': {
              'term': 'First term',
              'session': '2026/2027',
              'overallAverage': 81,
              'subjects': [
                {'subject': 'Mathematics', 'total': 81, 'grade': 'A'}
              ],
            },
            'assignments': [
              {'title': 'Fractions', 'dueDate': '2026-10-02'}
            ],
            'activities': [],
            'announcements': [],
            'conduct': [],
          }
        : {
            'timeline': [
              {'type': 'Attendance', 'title': 'Present', 'date': 'Today'}
            ]
          };
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(body))),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

class _GuardianLinkClient extends _ActivityCenterClient {
  bool accepted = false;
  String? acceptedCode;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.endsWith('/guardian-links/accept')) {
      accepted = true;
      acceptedCode = jsonDecode((request as http.Request).body)['code'];
      return http.StreamedResponse(
        Stream.value(utf8.encode(jsonEncode({'success': true}))),
        201,
        headers: {'content-type': 'application/json'},
      );
    }
    if (path.endsWith('/activity-center/parent/children')) {
      final body = accepted
          ? {
              'success': true,
              'children': [
                {'id': 'student-1', 'fullName': 'Ada Student'},
                {'id': 'student-2', 'fullName': 'Bola Student'},
              ],
            }
          : {
              'success': true,
              'children': [
                {'id': 'student-1', 'fullName': 'Ada Student'},
              ],
            };
      return http.StreamedResponse(
        Stream.value(utf8.encode(jsonEncode(body))),
        200,
        headers: {'content-type': 'application/json'},
      );
    }
    return super.send(request);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('EduPay renders authoritative empty overview state',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    await tester.pumpWidget(
      MaterialApp(
        home: EduPayScreen(api: EduPayApi(client: _DashboardClient())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('School fees, made manageable.'), findsOneWidget);
    expect(find.text('No plans yet'), findsNothing);
    expect(find.text('ServicePay EduPay'), findsNothing);
  });

  testWidgets('history remains available when new EduPay initiation is paused',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EduPayScreen(
          api: EduPayApi(client: _DashboardClient(enabled: false)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('School fees, made manageable.'), findsOneWidget);
    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.text('Transaction history'), findsOneWidget);
    expect(find.text('No EduPay transactions yet'), findsOneWidget);
  });

  testWidgets('paused EduPay still exposes a mobile-safe school request',
      (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    final client = _RequestSchoolClient(enabled: false);
    await tester.pumpWidget(
      MaterialApp(
        home: EduPayScreen(api: EduPayApi(client: client)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Children').last);
    await tester.pumpAndSettle();
    expect(find.text("Can't find your school?"), findsOneWidget);
    await tester.tap(find.text("Can't find your school?"));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextField, 'School name'), 'Bright Future Academy');
    await tester.enterText(
      find.widgetWithText(TextField, 'Location'),
      'Ikeja, Lagos',
    );
    await tester.tap(find.text('Request School'));
    await tester.pumpAndSettle();
    expect(client.requestPath, '/api/edupay/school-requests');
    expect(client.requestBody, {
      'schoolName': 'Bright Future Academy',
      'location': 'Ikeja, Lagos',
    });
    expect(
      find.textContaining('School request submitted'),
      findsOneWidget,
    );
  });

  testWidgets('compact mobile layout keeps all primary destinations reachable',
      (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(
      MaterialApp(
        home: EduPayScreen(api: EduPayApi(client: _DashboardClient())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Overview'), findsOneWidget);
    expect(find.text('Plans'), findsOneWidget);
    expect(find.text('Children'), findsWidgets);
    expect(find.text('Repayments'), findsOneWidget);
    expect(find.text('History'), findsOneWidget);
  });

  testWidgets('dashboard premium EduPay card opens the real disabled screen',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: DashboardScreen(client: _DashboardClient(enabled: false)),
      ),
    );
    await tester.pump();
    final card = find.text('Servicepay EduPay');
    expect(card, findsOneWidget);
    await tester.tap(card);
    await tester.pumpAndSettle();
    expect(find.byType(EduPayScreen), findsOneWidget);
  });

  testWidgets('plan flow sends selected backend DTO fields', (tester) async {
    final client = _PlanFlowClient();
    await tester.pumpWidget(
      MaterialApp(home: EduPayScreen(api: EduPayApi(client: client))),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start a school-fee plan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ada Child'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2026/2027'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('First term'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Primary 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Primary 1 fees'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '2026-09-01');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(client.createdPlan, {
      'child': 'child-1',
      'school': 'school-2',
      'session': 'session-1',
      'term': 'term-1',
      'classLevel': 'class-1',
      'feeStructure': 'fee-1',
      'targetDate': '2026-09-01',
      'savingFrequency': 'MONTHLY',
    });
    expect(client.cataloguePath, '/api/edupay/schools/school-2/catalogue');
  });

  testWidgets('parent can switch linked children and view activity timeline',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    final client = _ActivityCenterClient();
    await tester.pumpWidget(
      MaterialApp(
        home: StudentActivityCenter(
          api: EduPayApi(client: client),
          children: const [
            {'id': 'student-1', 'fullName': 'Ada Student'},
            {'id': 'student-2', 'fullName': 'Bola Student'},
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Ada Student'), findsWidgets);
    expect(find.textContaining('Present'), findsWidgets);
    await tester.tap(find.byType(DropdownButtonFormField<int>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bola Student').last);
    await tester.pumpAndSettle();
    expect(find.text('Bola Student'), findsWidgets);
    await tester.drag(
      find.byType(ListView).first,
      const Offset(0, -1200),
    );
    await tester.pumpAndSettle();
    expect(find.text('Activity timeline'), findsOneWidget);

    // The dashboard remains available after switching children; timeline
    // content is intentionally paginated and may not be in the viewport.
    await tester.drag(
      find.byType(ListView).first,
      const Offset(0, 1200),
    );
    await tester.pumpAndSettle();
    expect(find.byType(DropdownButtonFormField<int>), findsOneWidget);
  });

  testWidgets('parent activity center displays isolation failure',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    await tester.pumpWidget(
      MaterialApp(
        home: StudentActivityCenter(
          api: EduPayApi(client: _ActivityCenterClient(forbidden: true)),
          children: const [
            {'id': 'unrelated', 'fullName': 'Unrelated Student'},
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('no longer linked'), findsOneWidget);
  });

  testWidgets('guardian code acceptance reloads backend-linked children',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    final client = _GuardianLinkClient();
    await tester.pumpWidget(
      MaterialApp(
        home: StudentActivityCenter(
          api: EduPayApi(client: client),
          children: const [
            {'id': 'student-1', 'fullName': 'Ada Student'},
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Link another child'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), ' SCHOOL-CODE ');
    await tester.tap(find.text('Link child'));
    await tester.pumpAndSettle();

    expect(client.accepted, isTrue);
    expect(client.acceptedCode, 'SCHOOL-CODE');
    await tester.tap(find.byType(DropdownButtonFormField<int>));
    await tester.pumpAndSettle();
    expect(find.text('Bola Student'), findsOneWidget);
  });
}
