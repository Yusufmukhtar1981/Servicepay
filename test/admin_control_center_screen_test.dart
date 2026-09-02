import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_control_center_api.dart';
import 'package:servicepay_app/admin/admin_control_center_screen.dart';

class _Api extends AdminControlCenterApi {
  _Api({this.serviceRows, this.serviceData});
  final List<Map<String, dynamic>>? serviceRows;
  final Map<String, dynamic>? serviceData;
  @override
  Future<Map<String, dynamic>> catalog() async => <String, dynamic>{
        'success': true,
        'data': <Map<String, dynamic>>[
          <String, dynamic>{
            'key': 'executive-dashboard',
            'endpoint': '/analytics/executive',
            'live': true
          },
          if (serviceRows != null || serviceData != null)
            <String, dynamic>{
              'key': 'service-performance',
              'endpoint': '/analytics/services',
              'live': true
            },
        ]
      };
  @override
  Future<Map<String, dynamic>> module(String value,
          {String search = '',
          String filter = '',
          String method = '',
          int page = 1,
          int limit = 25,
          DateTime? start,
          DateTime? end,
          String action = '',
          String status = '',
          String actorId = '',
          String moduleFilter = '',
          String eventType = '',
          String severity = '',
          String workflow = '',
          String outcome = '',
          String statusCode = '',
          String path = '',
          String ip = '',
          String serviceType = '',
          String provider = '',
          String branchId = '',
          String customerId = '',
          String state = '',
          String role = '',
          String kycStatus = '',
          String type = '',
          String subjectUser = ''}) async =>
      value == 'executive-dashboard'
          ? <String, dynamic>{
              'success': true,
              'data': <String, dynamic>{
                'transactions': <String, dynamic>{'activeUsers': 12},
                'pendingOperations': <String, dynamic>{'kycReview': 2}
              }
            }
          : value == 'service-performance'
              ? <String, dynamic>{
                  'success': true,
                  'data': serviceData ?? serviceRows
                }
              : <String, dynamic>{
                  'success': true,
                  'data': <String, dynamic>{'items': <Map<String, dynamic>>[]}
                };
}

void main() {
  test('allows only legal security workflow transitions', () {
    expect(controlCenterSecurityActions(<String, dynamic>{'status': 'OPEN'}),
        <String>['ACKNOWLEDGE']);
    expect(
        controlCenterSecurityActions(
            <String, dynamic>{'workflowStatus': 'ACKNOWLEDGED'}),
        <String>['RESOLVE']);
    expect(
        controlCenterSecurityActions(<String, dynamic>{'workflow': 'RESOLVED'}),
        <String>['REOPEN']);
    expect(
        controlCenterSecurityActions(
            <String, dynamic>{'status': 'OPEN', 'outcome': 'SUCCESS'}),
        isEmpty);
    expect(
        controlCenterSecurityActions(
            <String, dynamic>{'status': 'OPEN', 'nonActionable': true}),
        isEmpty);
  });

  testWidgets('renders all ten protected control modules',
      (WidgetTester tester) async {
    await tester
        .pumpWidget(MaterialApp(home: AdminControlCenterScreen(api: _Api())));
    await tester.pump();

    expect(find.text('Audit Logs'), findsOneWidget);
    expect(find.text('Customer Analytics'), findsOneWidget);
    expect(find.text('Open operational workspace'), findsOneWidget);
    expect(find.text('Unavailable for this session'), findsNWidgets(9));
  });

  testWidgets('production catalog disables an endpoint marked unavailable',
      (WidgetTester tester) async {
    await tester
        .pumpWidget(MaterialApp(home: AdminControlCenterScreen(api: _Api())));
    await tester.pump();

    expect(find.text('Unavailable for this session'), findsNWidgets(9));
    await tester.tap(find.text('Audit Logs'));
    await tester.pump();
    expect(find.text('Control Center'), findsOneWidget);
  });

  testWidgets('renders executive analytics labels from the returned contract',
      (WidgetTester tester) async {
    await tester
        .pumpWidget(MaterialApp(home: AdminControlCenterScreen(api: _Api())));
    await tester.pump();
    await tester.tap(find.text('Executive Dashboard'));
    await tester.pump();

    expect(find.text('Executive operations'), findsOneWidget);
    expect(find.text('Pending operations'), findsOneWidget);
    await tester.drag(find.byType(ListView).last, const Offset(0, -300));
    await tester.pump();
    expect(find.textContaining('Active Users'), findsOneWidget);
  });

  testWidgets('labels lifecycle service values as non-additive',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
        home: AdminControlCenterScreen(
            api: _Api(serviceRows: <Map<String, dynamic>>[
      <String, dynamic>{
        'service': 'Finance schedules',
        'source': 'financing',
        'valueMeaning': 'Scheduled repayment amount',
        'additive': false,
        'count': 3,
        'value': 4200,
      }
    ]))));
    await tester.pump();
    await tester.tap(find.text('Service Performance'));
    await tester.pump();

    expect(find.text('Lifecycle operational views'), findsOneWidget);
    expect(find.textContaining('separate lifecycle views'), findsOneWidget);
    expect(find.textContaining('must not be summed'), findsOneWidget);
    expect(find.textContaining('Value meaning: Scheduled repayment amount'),
        findsOneWidget);
    expect(find.textContaining('Additive: false'), findsOneWidget);
    expect(find.textContaining('(non-additive)'), findsOneWidget);
    expect(find.text('Unified operational services'), findsNothing);
  });

  testWidgets('renders service rows from the production map response',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
        home: AdminControlCenterScreen(
            api: _Api(serviceData: <String, dynamic>{
      'unifiedTotalAvailable': false,
      'message':
          'Lifecycle values are separate views and cannot be added together.',
      'rows': <Map<String, dynamic>>[
        <String, dynamic>{
          'service': 'Solar applications',
          'source': 'solarApplications',
          'valueMeaning': 'Submitted applications',
          'additive': false,
          'count': 7,
          'value': 7,
          'successful': 3,
          'pending': 4,
          'failed': 0,
        }
      ],
    }))));
    await tester.pump();
    await tester.tap(find.text('Service Performance'));
    await tester.pump();

    expect(find.text('Solar applications'), findsOneWidget);
    expect(find.textContaining('Source: solarApplications'), findsOneWidget);
    expect(
        find.text(
            'Lifecycle values are separate views and cannot be added together.'),
        findsOneWidget);
    expect(find.textContaining('must not be summed'), findsOneWidget);
    expect(find.text('No matching records for this date range.'), findsNothing);
  });
}
