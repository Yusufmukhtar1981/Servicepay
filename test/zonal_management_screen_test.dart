import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/services/session_store.dart';
import 'package:servicepay_app/zonal_management_screen.dart';

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SessionStore.writeToken('secure-test-token');
  });

  test('promotion keys are stable for replay and target scoped', () {
    expect(
      zonalPromotionIdempotencyKey('agg-17'),
      zonalPromotionIdempotencyKey('agg-17'),
    );
    expect(
      zonalPromotionIdempotencyKey('agg-17'),
      isNot(zonalPromotionIdempotencyKey('agg-18')),
    );
    expect(zonalPromotionIdempotencyKey('agg-17'), contains('STATE_MANAGER'));
  });

  testWidgets('renders all zonal sections and sends secure bearer header',
      (tester) async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path.endsWith('/overview')) {
        return http.Response(jsonEncode({
          'stateManagers': 1,
          'aggregators': 2,
          'customers': 3,
          'transactions': 4,
          'deliveries': 5,
          'edupaySchools': 6,
          'empowerment': 7,
          'organizations': 8,
          'deliverySummary': {
            'total': 12,
            'pending': 2,
            'inProgress': 3,
            'completed': 5,
            'failed': 1,
            'cancelled': 1,
            'totalValue': 12345.67,
          },
        }), 200);
      }
      return http.Response(jsonEncode({
        'items': [
          {'id': 'agg-1', 'name': 'Aggregator One', 'status': 'ACTIVE'}
        ],
        'total': 1,
      }), 200);
    });
    await tester.pumpWidget(MaterialApp(
      home: ZonalManagementScreen(client: client),
    ));
    await tester.pumpAndSettle();
    expect(find.text('State Managers'), findsWidgets);
    expect(find.text('Aggregators'), findsWidgets);
    expect(find.text('Customers'), findsWidgets);
    expect(find.text('Delivery'), findsWidgets);
    expect(find.text('EduPay'), findsWidgets);
    expect(find.text('Empowerment'), findsWidgets);
    expect(find.text('Organizations'), findsWidgets);
    expect(zonalOverviewCount({
      'stateManagers': 1,
      'aggregators': 2,
    }, 'stateManagers'), 1);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(MaterialApp(
      home: ZonalManagementScreen(initialSection: 'delivery', client: client),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Delivery overview'), findsOneWidget);
    expect(find.text('Total deliveries'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
    expect(find.textContaining('12345.67'), findsOneWidget);
    expect(requests, isNotEmpty);
    expect(requests.every((r) => r.headers['authorization'] == 'Bearer secure-test-token'), isTrue);
    expect(requests.every((r) => !r.url.queryParameters.containsKey('token')), isTrue);
  });

  testWidgets('empty and forbidden responses show safe states', (tester) async {
    final emptyClient = MockClient((request) async {
      if (request.url.path.endsWith('/overview')) {
        return http.Response(jsonEncode({'counts': {}}), 200);
      }
      return http.Response(jsonEncode({'items': [], 'total': 0}), 200);
    });
    await tester.pumpWidget(MaterialApp(
      home: ZonalManagementScreen(client: emptyClient),
    ));
    await tester.pumpAndSettle();
    expect(find.text('No records found for this area.'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    final forbiddenClient = MockClient((request) async {
      if (request.url.path.endsWith('/overview')) {
        return http.Response(jsonEncode({'counts': {}}), 200);
      }
      return http.Response(jsonEncode({'message': 'forbidden'}), 403);
    });
    await tester.pumpWidget(MaterialApp(
      home: ZonalManagementScreen(client: forbiddenClient),
    ));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
  });

  testWidgets('detail contract exposes permitted fields and customer transactions',
      (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/overview')) {
        return http.Response(jsonEncode({'counts': {}}), 200);
      }
      if (request.url.path.endsWith('/customers/c-1')) {
        return http.Response(jsonEncode({
          'item': {'id': 'c-1', 'name': 'Customer One', 'status': 'ACTIVE'},
          'counts': {'transactions': 2},
        }), 200);
      }
      if (request.url.path.endsWith('/transactions')) {
        return http.Response(jsonEncode({
          'items': [
            {'serviceType': 'AIRTIME', 'status': 'SUCCESS', 'amount': 100},
            {'serviceType': 'DATA', 'status': 'SUCCESS', 'amount': 200},
          ]
        }), 200);
      }
      return http.Response(jsonEncode({'items': []}), 200);
    });
    await tester.pumpWidget(MaterialApp(
      home: ZonalDetailScreen(section: 'customers', id: 'c-1', client: client),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Customer One'), findsOneWidget);
    expect(find.text('View transactions'), findsOneWidget);
    await tester.tap(find.text('View transactions'));
    await tester.pumpAndSettle();
    expect(find.text('AIRTIME'), findsOneWidget);
    expect(find.text('DATA'), findsOneWidget);
    expect(find.text('SUCCESS'), findsNWidgets(2));
  });
}