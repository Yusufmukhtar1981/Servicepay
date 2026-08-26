import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/solar_screen.dart';

void main() {
  group('Solar customer payment DTO helpers', () {
    test('awaiting-deposit application exposes remaining deposit', () {
      final Map<String, dynamic> application = <String, dynamic>{
        'status': 'AWAITING_DEPOSIT',
        'depositRequired': 120000,
        'depositPaid': 20000,
      };

      expect(solarCanPayDeposit(application), isTrue);
      expect(solarDepositDue(application), 100000);
      expect(
        solarCanPayDeposit(<String, dynamic>{
          ...application,
          'status': 'APPROVED',
        }),
        isFalse,
      );
    });

    test('finance values prioritize next installment and next due date', () {
      final Map<String, dynamic> finance = <String, dynamic>{
        'nextInstallmentAmount': 45000,
        'outstandingBalance': 400000,
        'nextDueDate': '2026-09-30',
        'dueDate': 'legacy-date',
      };

      expect(solarFinanceDue(finance), 45000);
      expect(solarFinanceDueDate(finance), '2026-09-30');
    });
  });
}
