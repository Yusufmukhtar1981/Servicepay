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
      'customerPhone': 'not retained',
    });

    expect(payload, isNotNull);
    expect(payload!.orderId, 'delivery-42');
    expect(payload.reference, 'SP-42');
    expect(payload.pickup, '1 Pickup Way');
    expect(payload.dropoff, '2 Dropoff Way');
    expect(payload.toJson().keys,
        containsAll(<String>['orderId', 'reference', 'pickup', 'dropoff']));
    expect(payload.toJson(), isNot(contains('customerPhone')));
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
}
