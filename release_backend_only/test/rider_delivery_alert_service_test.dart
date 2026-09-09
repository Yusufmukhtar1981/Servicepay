import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/rider/rider_delivery_alert_service.dart';

void main() {
  test('parses assigned delivery payload and retains only launch fields', () {
    final RiderDeliveryAlertPayload? payload =
        RiderDeliveryAlertPayload.fromData(<String, dynamic>{
      'type': 'DELIVERY_ASSIGNED',
      'orderId': 'delivery-42',
      'deliveryReference': 'SP-42',
      'pickupLocation': '1 Pickup Way',
      'dropoffLocation': '2 Dropoff Way',
      'assignmentEventId': 'assignment-42',
      'customerPhone': 'not retained',
    });

    expect(payload, isNotNull);
    expect(payload!.orderId, 'delivery-42');
    expect(payload.assignmentEventId, 'assignment-42');
    expect(payload.reference, 'SP-42');
    expect(payload.pickup, '1 Pickup Way');
    expect(payload.dropoff, '2 Dropoff Way');
    expect(payload.toJson().keys,
        containsAll(<String>[
          'orderId',
          'assignmentEventId',
          'reference',
          'pickup',
          'dropoff'
        ]));
    expect(payload.toJson(), isNot(contains('customerPhone')));
  });

  test('deduplicates by assignment event and builds a safe route summary', () {
    const RiderDeliveryAlertPayload first = RiderDeliveryAlertPayload(
      orderId: 'delivery-42',
      assignmentEventId: 'assignment-42',
      reference: 'SP-42',
      pickup: '1 Pickup Way',
      dropoff: '2 Dropoff Way',
    );
    const RiderDeliveryAlertPayload duplicate = RiderDeliveryAlertPayload(
      orderId: 'delivery-42',
      assignmentEventId: 'assignment-42',
      reference: 'SP-42',
      pickup: '1 Pickup Way',
      dropoff: '2 Dropoff Way',
    );
    const RiderDeliveryAlertPayload reassignment = RiderDeliveryAlertPayload(
      orderId: 'delivery-42',
      assignmentEventId: 'assignment-43',
      reference: 'SP-42',
      pickup: '1 Pickup Way',
      dropoff: '2 Dropoff Way',
    );

    expect(
      RiderDeliveryAlertService.deduplicationKeyFor(first),
      RiderDeliveryAlertService.deduplicationKeyFor(duplicate),
    );
    expect(
      RiderDeliveryAlertService.deduplicationKeyFor(first),
      isNot(RiderDeliveryAlertService.deduplicationKeyFor(reassignment)),
    );
    expect(
      RiderDeliveryAlertService.notificationBodyFor(first),
      'Delivery SP-42 is ready. Tap to view details.',
    );
  });

  test('cancellation only matches the assignment event it belongs to', () {
    expect(
      RiderDeliveryAlertService.cancellationMatches(
        pendingAssignmentEventId: 'assignment-42',
        cancellationAssignmentEventId: 'assignment-42',
      ),
      isTrue,
    );
    expect(
      RiderDeliveryAlertService.cancellationMatches(
        pendingAssignmentEventId: 'assignment-43',
        cancellationAssignmentEventId: 'assignment-42',
      ),
      isFalse,
    );
  });

  test('notification IDs are deterministic and order-specific', () {
    expect(
      RiderDeliveryAlertService.notificationIdFor('delivery-42'),
      RiderDeliveryAlertService.notificationIdFor('delivery-42'),
    );
    expect(
      RiderDeliveryAlertService.notificationIdFor('delivery-42'),
      isNot(RiderDeliveryAlertService.notificationIdFor('delivery-43')),
    );
  });

  test('ignores cancellation and unrelated delivery data as assignments', () {
    expect(
      RiderDeliveryAlertPayload.fromData(<String, dynamic>{
        'event': 'DELIVERY_ASSIGNMENT_CANCELLED',
        'deliveryId': 'delivery-42',
      }),
      isNull,
    );
  });

  test('diagnostic payload rings but is marked as non-navigating test data', () {
    final RiderDeliveryAlertPayload? payload =
        RiderDeliveryAlertPayload.fromData(<String, dynamic>{
      'event': 'DELIVERY_ASSIGNED',
      'deliveryId': 'diagnostic-42',
      'assignmentEventId': 'diagnostic-42',
      'diagnostic': 'true',
    });

    expect(payload, isNotNull);
    expect(payload!.isDiagnostic, isTrue);
    expect(
      RiderDeliveryAlertPayload.fromJson(
        jsonEncode(payload.toJson()),
      )?.isDiagnostic,
      isTrue,
    );
  });
}
