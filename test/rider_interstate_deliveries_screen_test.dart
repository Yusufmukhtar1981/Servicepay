import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/logistics/logistics_api.dart';
import 'package:servicepay_app/logistics/logistics_operations_screens.dart';

class _RiderApi extends LogisticsApi {
  bool hasAssignment = true;
  int listCalls = 0;
  final List<Map<String, dynamic>> requests = <Map<String, dynamic>>[];

  Map<String, dynamic> get _row => <String, dynamic>{
        '_id': 'shipment-17',
        'trackingNumber': 'SP-INT-RIDER-17',
        'status': 'PICKUP_ASSIGNED',
        'receiverName': 'Nneka Okafor',
        'deliveryAddress': '8 Market Road',
        'receiver': <String, dynamic>{
          'name': 'Nneka Okafor',
          'phone': '08031234567',
          'address': '8 Market Road',
        },
      };

  @override
  Future<List<Map<String, dynamic>>> list(
    String scope,
    String resource, {
    Map<String, String>? query,
  }) async {
    listCalls += 1;
    return hasAssignment
        ? <Map<String, dynamic>>[_row]
        : <Map<String, dynamic>>[];
  }

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    requests.add(<String, dynamic>{
      'method': method,
      'path': path,
      'body': body,
    });
    return <String, dynamic>{
      'shipment': <String, dynamic>{
        ..._row,
        'originState': 'LAGOS',
        'destinationState': 'OGUN',
        'sender': <String, dynamic>{
          'name': 'Ada Bello',
          'phone': '08039876543',
        },
        'parcel': <String, dynamic>{
          'description': 'Medical supplies',
          'quantity': 2,
          'weightKg': 1.4,
        },
      },
      'history': <Map<String, dynamic>>[
        <String, dynamic>{
          'status': 'PICKUP_ASSIGNED',
          'createdAt': '2026-09-20T08:15:00Z',
        },
      ],
    };
  }
}

void main() {
  testWidgets(
      'rider can inspect shipment, act on its status, and refresh away a reassigned order',
      (WidgetTester tester) async {
    final _RiderApi api = _RiderApi();
    await tester.pumpWidget(MaterialApp(
      home: RiderInterstateDeliveriesScreen(api: api),
    ));
    await tester.pumpAndSettle();

    expect(find.text('SP-INT-RIDER-17'), findsOneWidget);
    expect(find.text('OTP delivery'), findsOneWidget);
    await tester.tap(find.text('SP-INT-RIDER-17'));
    await tester.pumpAndSettle();

    expect(find.text('INTERSTATE'), findsOneWidget);
    expect(find.text('Origin: LAGOS'), findsOneWidget);
    expect(find.text('Destination: OGUN'), findsOneWidget);
    expect(find.text('Receiver phone: 08031234567'), findsOneWidget);
    expect(find.text('Parcel: Medical supplies'), findsOneWidget);
    expect(find.text('PICKUP ASSIGNED'), findsWidgets);
    expect(find.text('PICKED UP'), findsOneWidget);
    expect(
      api.requests.first['path'],
      '/rider/logistics/interstate/shipments/shipment-17',
    );

    await tester.tap(find.text('PICKED UP'));
    await tester.pumpAndSettle();
    expect(
      api.requests.last,
      <String, dynamic>{
        'method': 'PATCH',
        'path': '/rider/logistics/interstate/shipments/shipment-17/status',
        'body': <String, dynamic>{'status': 'PICKED_UP'},
      },
    );

    // A reassignment by dispatch removes the shipment from this rider's
    // authorized queue; refreshing should not retain the stale card.
    api.hasAssignment = false;
    await tester.tap(find.byTooltip('Refresh interstate assignments'));
    await tester.pumpAndSettle();
    expect(find.text('No interstate deliveries assigned.'), findsOneWidget);
    expect(find.text('SP-INT-RIDER-17'), findsNothing);
    expect(api.listCalls, greaterThanOrEqualTo(3));

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}