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
    expect(summary.paid, 0);
    expect(summary.referrals.single.firstName, 'Ada');
    expect(summary.referrals.single.qualificationProgress, '50');
    expect(summary.referrals.single.rewardStatus, 'PENDING');
  });

  test('parses configured reward policy totals and best category progress', () {
    final summary = parseReferralResponse(<String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'referralCode': 'SP-CONFIGURED',
        'rewardProgramStatus': 'CONFIGURED',
        'rewardPolicy': <String, dynamic>{
          'status': 'CONFIGURED',
          'categories': <Map<String, dynamic>>[
            <String, dynamic>{
              'category': 'DATA',
              'target': 10,
              'rewardAmount': 2500,
            },
          ],
        },
        'total': 4,
        'pending': 1,
        'qualified': 3,
        'paid': 2,
        'rewardsEarned': 5000,
        'referrals': <Map<String, dynamic>>[
          <String, dynamic>{
            // The customer app must never show this surname.
            'firstName': 'Ada Lovelace',
            'category': 'DATA',
            'qualificationProgress': <String, dynamic>{
              'category': 'DATA',
              'completed': 7,
              'target': 10,
            },
            'rewardStatus': 'PAID',
          },
        ],
      },
    });

    expect(summary.code, 'SP-CONFIGURED');
    expect(summary.rewardProgramStatus, 'CONFIGURED');
    expect(summary.rewardPolicy.isConfigured, isTrue);
    expect(summary.rewardPolicy.categories.single.category, 'Data');
    expect(summary.rewardPolicy.categories.single.target, 10);
    expect(summary.rewardPolicy.categories.single.reward, 2500);
    expect(summary.total, 4);
    expect(summary.pending, 1);
    expect(summary.qualified, 3);
    expect(summary.paid, 2);
    expect(summary.rewardsEarned, 5000);
    expect(summary.referrals.single.firstName, 'Ada');
    expect(summary.referrals.single.category, 'Data');
    expect(summary.referrals.single.bestCategoryProgress, 'Data 7/10');
    expect(summary.referrals.single.bestProgress, 'Data 7/10');
    expect(summary.referrals.single.rewardStatus, 'PAID');
  });

  test('selects the best category from legacy category-map progress', () {
    final summary = parseReferralResponse(<String, dynamic>{
      'referralCode': 'SP-LEGACY',
      'referredCount': 1,
      'referrals': <Map<String, dynamic>>[
        <String, dynamic>{
          'fullName': 'Bola Adeyemi',
          'progress': <String, dynamic>{
            'DATA': <String, dynamic>{'completed': 7, 'target': 10},
            'AIRTIME': <String, dynamic>{'completed': 2, 'target': 10},
          },
          'status': 'QUALIFIED',
        },
      ],
    });

    expect(summary.total, 1);
    expect(summary.qualified, 1);
    expect(summary.pending, 0);
    expect(summary.referrals.single.firstName, 'Bola');
    expect(summary.referrals.single.bestCategoryProgress, 'Data 7/10');
    expect(summary.referrals.single.category, 'Data');
    expect(summary.referrals.single.rewardStatus, 'QUALIFIED');
  });

  test('supports the approved configured policy category rules shape', () {
    final summary = parseReferralResponse(<String, dynamic>{
      'rewardProgramStatus': 'CONFIGURED',
      'rewardPolicy': <String, dynamic>{
        'status': 'CONFIGURED',
        'target': 10,
        'rewardAmount': 2000,
        'categories': <Map<String, dynamic>>[
          <String, dynamic>{
            'category': 'DATA',
            'minimumTransactionAmount': 500,
          },
          <String, dynamic>{'category': 'DELIVERY'},
          <String, dynamic>{
            'category': 'MARKETPLACE',
            'minimumTransactionAmount': 1000,
          },
        ],
      },
    });

    expect(summary.rewardProgramStatus, 'CONFIGURED');
    expect(
      summary.rewardPolicy.categories.map((rule) => rule.category),
      containsAll(<String>['Data', 'Delivery', 'Marketplace']),
    );
    expect(summary.rewardPolicy.categories.first.target, 10);
    expect(summary.rewardPolicy.categories.first.reward, 2000);
    expect(summary.rewardPolicy.categories.first.minimumTransaction, 500);
  });

  test('keeps malformed and non-map responses safe', () {
    final malformed = parseReferralResponse(<String, dynamic>{
      'referralCode': 'SP-SAFE',
      'totalReferrals': '2',
      'pendingReferrals': '-3',
      'referrals': <dynamic>[
        'not a referral',
        <String, dynamic>{'fullName': '  '},
      ],
    });

    expect(malformed.total, 2);
    expect(malformed.pending, 0);
    expect(malformed.referrals.single.firstName, 'ServicePay User');
    expect(parseReferralResponse(null).total, 0);
    expect(decodeReferralJson('not json'), isEmpty);
  });
}
