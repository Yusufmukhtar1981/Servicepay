import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/phone_financing/phone_financing_models.dart';

void main() {
  test('parses product pricing, specifications and images', () {
    final product = PhoneProduct.fromJson({
      '_id': 'p1',
      'name': 'A15',
      'brand': 'Samsung',
      'cashPrice': 180000,
      'financedPrice': 200000,
      'depositPercent': 20,
      'interestPercent': 5,
      'weeklyInstallments': 20,
      'stock': 4,
      'specifications': {'storage': '128GB', 'ram': '6GB', 'color': 'Blue'},
      'images': ['https://cdn.example/phone.jpg'],
    });
    expect(product.id, 'p1');
    expect(product.deposit, 40000);
    expect(product.weekly, 8500);
    expect(product.specifications['ram'], '6GB');
    expect(product.images.single, contains('phone.jpg'));
  });

  test('parses application history and finance schedule', () {
    final application = PhoneApplication.fromJson({
      '_id': 'a1',
      'status': 'AWAITING_DEPOSIT',
      'reference': 'SPF-PHONE-1',
      'depositRequired': 40000,
      'statusHistory': [
        {'status': 'SUBMITTED', 'note': 'Application submitted'}
      ],
      'productSnapshot': {'name': 'A15', 'brand': 'Samsung', 'weeklyInstallments': 20}
    });
    final finance = PhoneFinance.fromJson({
      '_id': 'f1',
      'status': 'ACTIVE',
      'totalPayable': 210000,
      'amountPaid': 40000,
      'outstandingBalance': 170000,
      'paymentSchedule': [
        {'installmentNumber': 1, 'amount': 8500, 'status': 'PENDING'}
      ]
    });
    expect(application.status, 'AWAITING_DEPOSIT');
    expect(application.history.single['note'], 'Application submitted');
    expect(finance.schedule.single['amount'], 8500);
    expect(finance.outstanding, 170000);
  });
}