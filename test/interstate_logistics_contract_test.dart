import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/interstate_logistics_screen.dart';

void main() {
  test('canonical quote response and object breakdown are parsed', () {
    final Map<String, dynamic> quote = InterstateLogisticsContracts.quote(
      <String, dynamic>{
        'quote': <String, dynamic>{
          'quoteId': 'quote-1',
          'version': 'route-v2',
          'breakdown': <String, dynamic>{
            'transportFee': 1200,
            'pickupFee': 300,
          },
        },
      },
    );

    expect(quote['quoteId'], 'quote-1');
    expect(
        InterstateLogisticsContracts.breakdownRows(quote),
        <Map<String, dynamic>>[
          <String, dynamic>{'label': 'transport Fee', 'amount': 1200},
          <String, dynamic>{'label': 'pickup Fee', 'amount': 300},
        ]);
  });

  test('shipment detail and public tracking envelopes retain the timeline', () {
    final Map<String, dynamic> shipment =
        InterstateLogisticsContracts.shipmentWithTimeline(<String, dynamic>{
      'shipment': <String, dynamic>{
        'trackingNumber': 'SPX-ABC',
        'status': 'IN_TRANSIT',
      },
      'timeline': <Map<String, dynamic>>[
        <String, dynamic>{'status': 'PAID'},
      ],
    });

    expect(shipment['trackingNumber'], 'SPX-ABC');
    expect(shipment['timeline'], hasLength(1));
  });

  test('verified-weight adjustment exposes only backend-settled amount', () {
    final Map<String, dynamic> shipment = <String, dynamic>{
      'status': 'ADDITIONAL_PAYMENT_REQUIRED',
      'verifiedWeightKg': 3.5,
      'priceAdjustments': <Map<String, dynamic>>[
        <String, dynamic>{'difference': 120},
        <String, dynamic>{
          'declaredWeightKg': 2,
          'verifiedWeightKg': 3.5,
          'previousTotal': 1500,
          'adjustedTotal': 1900,
          'difference': 400,
        },
      ],
    };

    expect(
        InterstateLogisticsContracts.latestWeightAdjustment(
            shipment)['verifiedWeightKg'],
        3.5);
    expect(InterstateLogisticsContracts.adjustmentDue(shipment), 400);
  });
}
