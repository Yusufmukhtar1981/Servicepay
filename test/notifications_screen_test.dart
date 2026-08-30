import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/notifications_screen.dart';
import 'package:servicepay_app/services/support_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _notification({
  String id = '64b000000000000000000001',
  String title = 'Transfer successful',
  String category = 'TRANSACTION',
  bool isRead = false,
  String action = '',
  String? referenceId,
}) =>
    <String, dynamic>{
      '_id': id,
      'title': title,
      'message': 'Your transfer of NGN 2,500.00 is successful.',
      'type': category == 'SECURITY' ? 'SECURITY' : 'TRANSFER',
      'category': category,
      'reference': 'SPT-100',
      if (referenceId != null) 'referenceId': referenceId,
      'action': action,
      'isRead': isRead,
      'createdAt': '2026-08-30T08:00:00.000Z',
    };

http.Response _listResponse(List<Map<String, dynamic>> items,
        {int unread = 0, bool hasMore = false, String? cursor}) =>
    http.Response(
      jsonEncode(<String, dynamic>{
        'success': true,
        'notifications': items,
        'unreadCount': unread,
        'pagination': <String, dynamic>{
          'hasMore': hasMore,
          'nextCursor': cursor,
        },
      }),
      200,
    );

Future<void> _pump(
  WidgetTester tester,
  http.Client client, {
  Size size = const Size(430, 900),
  SupportApiService? supportApi,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues(<String, Object>{
    'auth_token': 'test-token',
  });
  await tester.pumpWidget(
    MaterialApp(
      home: NotificationsScreen(client: client, supportApi: supportApi),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('loads unread activity and persists a read action',
      (WidgetTester tester) async {
    var readCalls = 0;
    var authorized = false;
    final client = MockClient((http.Request request) async {
      authorized = request.headers.values.contains('Bearer test-token');
      if (request.method == 'PUT' && request.url.path.contains('/read/')) {
        readCalls++;
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'unreadCount': 0,
            'notification': <String, dynamic>{'isRead': true},
          }),
          200,
        );
      }
      return _listResponse(<Map<String, dynamic>>[_notification()], unread: 1);
    });

    await _pump(tester, client);
    expect(authorized, isTrue);
    expect(find.text('Transfer successful'), findsOneWidget);

    await tester.tap(find.text('Transfer successful'));
    await tester.pumpAndSettle();
    expect(find.textContaining('SPT-100'), findsOneWidget);
    expect(readCalls, 1);
  });

  testWidgets('sends category, unread, search, and pagination query parameters',
      (WidgetTester tester) async {
    final requests = <Uri>[];
    final client = MockClient((http.Request request) async {
      requests.add(request.url);
      return _listResponse(const <Map<String, dynamic>>[]);
    });

    await _pump(tester, client, size: const Size(1024, 900));
    await tester.tap(find.text('Security'));
    await tester.pumpAndSettle();
    expect(requests.last.queryParameters['category'], 'SECURITY');

    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();
    expect(requests.last.queryParameters['unread'], 'true');

    await tester.enterText(find.byType(TextField), 'wallet');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(requests.last.queryParameters['search'], 'wallet');
  });

  testWidgets('renders empty, error, and wide layouts safely',
      (WidgetTester tester) async {
    var fail = false;
    final client = MockClient((http.Request request) async {
      if (fail) {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': false,
            'message': 'Unavailable',
          }),
          503,
        );
      }
      return _listResponse(const <Map<String, dynamic>>[]);
    });

    await _pump(tester, client, size: const Size(1024, 900));
    expect(find.text('Nothing here yet'), findsOneWidget);

    fail = true;
    await tester.tap(find.text('Refresh'));
    await tester.pumpAndSettle();
    expect(find.text('Activity is temporarily unavailable'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('support activity exposes the owned ticket deep-link action',
      (WidgetTester tester) async {
    final client = MockClient((http.Request request) async {
      if (request.method == 'PUT') {
        return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'unreadCount': 0,
            }),
            200);
      }
      return _listResponse(<Map<String, dynamic>>[
        _notification(
          title: 'New support reply',
          category: 'OTHER',
          action: 'SUPPORT',
          referenceId: '64b000000000000000000099',
        ),
      ], unread: 1);
    });
    final supportClient =
        MockClient((http.Request request) async => http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'data': <String, dynamic>{
                'id': '64b000000000000000000099',
                'caseReference': 'SPT-20260830-ABC123',
                'subject': 'Transfer issue',
                'description': 'Please investigate.',
                'status': 'IN_REVIEW',
                'category': 'TRANSFER',
                'replies': <dynamic>[],
              },
            }),
            200));
    final supportApi = SupportApiService(client: supportClient);

    await _pump(tester, client, supportApi: supportApi);
    await tester.tap(find.text('New support reply'));
    await tester.pumpAndSettle();
    expect(find.text('Open support ticket'), findsOneWidget);
    await tester.tap(find.text('Open support ticket'));
    await tester.pumpAndSettle();
    expect(find.text('Transfer issue'), findsOneWidget);
    expect(find.text('Reference: SPT-20260830-ABC123'), findsOneWidget);
  });
}
