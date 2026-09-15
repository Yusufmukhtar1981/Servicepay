import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/referral_service.dart';

void main() {
  test('builds an encoded canonical registration referral link', () {
    expect(
      ReferralLinkBuilder.build('SP/AB 12'),
      'https://servicepay.ng/register?ref=SP%2FAB%2012',
    );
  });

  test('parses current and legacy referral summary fields safely', () {
    final summary = parseReferralResponse(<String, dynamic>{
      'success': true,
      'referralCode': 'SP-AB12',
      'totalReferrals': 3,
      'qualifiedReferrals': 1,
      'pendingReferrals': 2,
      'totalReferralRewards': 1500,
      'referrals': <Map<String, dynamic>>[
        <String, dynamic>{
          'firstName': 'Ada',
          'joinedAt': '2025-01-02T00:00:00Z',
          'qualificationProgress': 50,
          'rewardStatus': 'PENDING',
        },
      ],
    });

    expect(summary.code, 'SP-AB12');
    expect(summary.total, 3);
    expect(summary.qualified, 1);
    expect(summary.pending, 2);
    expect(summary.totalRewards, 1500);
    expect(summary.rewardProgramStatus, 'NOT_CONFIGURED');
    expect(summary.referrals.single.firstName, 'Ada');
    expect(summary.referrals.single.qualificationProgress, '50');
    expect(summary.referrals.single.rewardStatus, 'PENDING');
  });
}
