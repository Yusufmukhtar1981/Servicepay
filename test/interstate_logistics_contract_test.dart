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

  test('active configured routes are selected by directed state pair', () {
    final List<Map<String, dynamic>> routes = <Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'kano-abuja',
        'originState': 'KANO',
        'destinationState': 'ABUJA'
      },
      <String, dynamic>{
        'id': 'kano-lagos',
        'originState': 'KANO',
        'destinationState': 'LAGOS'
      },
      <String, dynamic>{
        'id': 'abuja-kano',
        'originState': 'ABUJA',
        'destinationState': 'KANO'
      },
      <String, dynamic>{
        'id': 'kano-kano-other-branch',
        'originState': 'KANO',
        'destinationState': 'KANO'
      },
    ];

    expect(InterstateLogisticsContracts.pickupStates(routes),
        <String>['ABUJA', 'KANO']);
    expect(InterstateLogisticsContracts.destinationStates(routes),
        <String>['ABUJA', 'KANO', 'LAGOS']);
    expect(
        InterstateLogisticsContracts.routesForStatePair(routes, 'Kano', 'Abuja')
            .single['id'],
        'kano-abuja');
    expect(
        InterstateLogisticsContracts.routesForStatePair(routes, 'KANO', 'KANO')
            .single['id'],
        'kano-kano-other-branch');
    expect(
        InterstateLogisticsContracts.routesForStatePair(
            routes, 'LAGOS', 'ABUJA'),
        isEmpty);
  });

  test('disabled logistics is not reported as a route loading failure', () {
    expect(
      InterstateLogisticsContracts.routeLoadError(
        statusCode: 503,
        code: 'FEATURE_DISABLED',
      ),
      'Interstate Logistics is temporarily unavailable. Please try again later.',
    );
    expect(
      InterstateLogisticsContracts.routeLoadError(
        statusCode: 502,
        code: 'UPSTREAM_ERROR',
      ),
      'We could not load configured routes (502). Please retry.',
    );
  });
}
