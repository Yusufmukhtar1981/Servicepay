import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_control_center_api.dart';
import 'package:servicepay_app/admin/admin_control_center_screen.dart';

class _Api extends AdminControlCenterApi {
  _Api();
  @override
  Future<Map<String, dynamic>> catalog() async => <String, dynamic>{
        'success': true,
        'data': <Map<String, dynamic>>[
          <String, dynamic>{
            'key': 'executive-dashboard',
            'endpoint': '/analytics/executive',
            'available': true
          }
        ]
      };
  @override
  Future<Map<String, dynamic>> module(String value,
          {String search = '',
          String filter = '',
          String method = '',
          int page = 1}) async =>
      value == 'executive-dashboard'
          ? <String, dynamic>{
              'success': true,
              'data': <String, dynamic>{
                'transactions': <String, dynamic>{'activeUsers': 12},
                'pendingOperations': <String, dynamic>{'kycReview': 2}
              }
            }
          : <String, dynamic>{
              'success': true,
              'data': <String, dynamic>{'items': <Map<String, dynamic>>[]}
            };
}

void main() {
  testWidgets('renders all ten protected control modules',
      (WidgetTester tester) async {
    await tester
        .pumpWidget(MaterialApp(home: AdminControlCenterScreen(api: _Api())));
    await tester.pump();

    expect(find.text('Audit Logs'), findsOneWidget);
    expect(find.text('Customer Analytics'), findsOneWidget);
    expect(find.text('NOT CHECKED'), findsOneWidget);
    expect(find.text('UNAVAILABLE'), findsNWidgets(9));
  });

  testWidgets('production catalog disables an endpoint marked unavailable',
      (WidgetTester tester) async {
    await tester
        .pumpWidget(MaterialApp(home: AdminControlCenterScreen(api: _Api())));
    await tester.pump();

    expect(find.text('UNAVAILABLE'), findsNWidgets(9));
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

    expect(find.text('Executive KPIs'), findsOneWidget);
    expect(find.text('Pending operations'), findsOneWidget);
    await tester.drag(find.byType(ListView).last, const Offset(0, -300));
    await tester.pump();
    expect(find.textContaining('Active Users'), findsOneWidget);
  });
}
