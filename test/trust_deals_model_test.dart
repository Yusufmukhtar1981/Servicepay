import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/trust/trust_models.dart';

void main() {
  test('parses a protected deal and nested dispute from JSON', () {
    final TrustDeal deal = TrustDeal.fromJson(<String, dynamic>{
      'id': 'deal-12',
      'title': 'Laptop repair',
      'amount': '12500.50',
      'status': 'funded',
      'buyerName': 'Ada',
      'sellerName': 'Tayo',
      'createdAt': '2025-01-01T10:00:00Z',
      'dispute': <String, dynamic>{
        'id': 'dispute-3',
        'status': 'open',
        'reason': 'Not as described',
      },
    });

    expect(deal.id, 'deal-12');
    expect(deal.amount, 12500.50);
    expect(deal.canFund, isFalse);
    expect(deal.canRaiseDispute, isTrue);
    expect(deal.dispute!.reason, 'Not as described');
  });

  test('only pending funding deals permit PIN funding', () {
    const TrustDeal pending = TrustDeal(
      id: 'deal-1',
      title: 'A deal',
      amount: 50,
      status: 'pending_funding',
      buyerName: 'Buyer',
      sellerName: 'Seller',
    );
    const TrustDeal released = TrustDeal(
      id: 'deal-2',
      title: 'A deal',
      amount: 50,
      status: 'released',
      buyerName: 'Buyer',
      sellerName: 'Seller',
    );
    expect(pending.canFund, isTrue);
    expect(released.canFund, isFalse);
    expect(released.canRaiseDispute, isFalse);
  });

  test('parses Mongo IDs, populated participants and role lifecycle actions',
      () {
    final TrustDeal deal = TrustDeal.fromJson(<String, dynamic>{
      '_id': 'mongo-deal',
      'title': 'Design work',
      'amount': 3000,
      'status': 'CREATED',
      'buyer': <String, dynamic>{'_id': 'buyer-id', 'displayName': 'Ada'},
      'seller': <String, dynamic>{'_id': 'seller-id', 'displayName': 'Bola'},
      'participantRole': 'buyer',
    });
    final TrustDispute dispute = TrustDispute.fromJson(<String, dynamic>{
      '_id': 'mongo-dispute',
      'status': 'OPEN',
      'reason': 'Other',
      'deal': <String, dynamic>{'_id': 'mongo-deal'},
    });

    expect(deal.id, 'mongo-deal');
    expect(deal.buyerId, 'buyer-id');
    expect(deal.sellerName, 'Bola');
    expect(deal.canFund, isTrue);
    expect(deal.canBuyerRelease, isFalse);
    expect(dispute.id, 'mongo-dispute');
    expect(dispute.dealId, 'mongo-deal');
    expect(dispute.isOpen, isTrue);
  });
}
