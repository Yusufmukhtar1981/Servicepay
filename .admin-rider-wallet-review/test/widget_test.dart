import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_empowerment_screen.dart';
import 'package:servicepay_app/admin/admin_kyc_screen.dart';
import 'package:servicepay_app/admin/admin_platform_configuration_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('Admin empowerment organization management', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({
        'auth_token': 'test-admin-token',
        'user_role': 'HEAD_OFFICE',
      });
    });

    testWidgets(
      'approves a PENDING organization with an ACTIVE status payload',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: [
            organization('Pending Org', 'PENDING'),
          ],
        );

        await openOrganizationDetails(tester, client);

        await tester.tap(find.text('Approve / Verify'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Approve / Verify').last);
        await tester.pumpAndSettle();

        expect(client.lastPatchPath, '/api/empowerment/organizations/org-1/status');
        expect(client.lastPatchPayload, {'status': 'ACTIVE'});
      },
    );

    testWidgets(
      'rejects a PENDING organization with a REJECTED status payload',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: [
            organization('Pending Org', 'PENDING'),
          ],
        );

        await openOrganizationDetails(tester, client);

        await tester.tap(find.text('Reject').last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Reject').last);
        await tester.pumpAndSettle();

        expect(client.lastPatchPath, '/api/empowerment/organizations/org-1/status');
        expect(client.lastPatchPayload, {'status': 'REJECTED'});
      },
    );

    testWidgets(
      'suspends an ACTIVE organization with a SUSPENDED status payload',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: [
            organization('Active Org', 'ACTIVE'),
          ],
        );

        await openOrganizationDetails(tester, client);

        await tester.tap(find.text('Suspend'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Suspend').last);
        await tester.pumpAndSettle();

        expect(client.lastPatchPath, '/api/empowerment/organizations/org-1/status');
        expect(client.lastPatchPayload, {'status': 'SUSPENDED'});
      },
    );

    testWidgets(
      'reactivates a SUSPENDED organization with an ACTIVE status payload',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: [
            organization('Suspended Org', 'SUSPENDED'),
          ],
        );

        await openOrganizationDetails(tester, client);

        await tester.tap(find.text('Reactivate'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Reactivate').last);
        await tester.pumpAndSettle();

        expect(client.lastPatchPath, '/api/empowerment/organizations/org-1/status');
        expect(client.lastPatchPayload, {'status': 'ACTIVE'});
      },
    );

    testWidgets(
      'lists only ACTIVE organizations in Create Program',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: [
            organization('Active Org', 'ACTIVE'),
            organization('Pending Org', 'PENDING', id: 'org-2'),
            organization('Suspended Org', 'SUSPENDED', id: 'org-3'),
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Create and manage empowerment programs'),
          400,
        );
        await tester.tap(find.text('Create and manage empowerment programs'));
        await tester.pumpAndSettle();

        expect(
          find.text('Only ACTIVE / verified organizations can run programs.'),
          findsOneWidget,
        );

        await tester.tap(
          find.byType(DropdownButtonFormField<Map<String, dynamic>>),
        );
        await tester.pumpAndSettle();

        expect(find.text('Active Org'), findsOneWidget);
        expect(find.text('Pending Org'), findsNothing);
        expect(find.text('Suspended Org'), findsNothing);
      },
    );

    testWidgets(
      'verifies a beneficiary through the protected verification endpoint',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program()],
          beneficiaries: [beneficiary()],
        );

        await openBeneficiaryDetails(tester, client);

        await tester.tap(find.text('Verify Beneficiary'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Verify Beneficiary').last);
        await tester.pumpAndSettle();

        expect(
          client.lastPatchPath,
          '/api/empowerment/beneficiaries/beneficiary-1/verify',
        );
        expect(
          client.lastPatchPayload,
          {'verificationStatus': 'VERIFIED'},
        );
      },
    );

    testWidgets(
      'hides financial and approval statuses before verification',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program()],
          beneficiaries: [beneficiary()],
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Update Application Status'));
        await tester.pumpAndSettle();

        expect(find.text('SUBMITTED'), findsNothing);
        expect(find.text('UNDER REVIEW'), findsOneWidget);
        expect(find.text('APPROVED'), findsNothing);
        expect(find.text('PAYMENT PENDING'), findsNothing);
        expect(find.text('PAID'), findsNothing);
        expect(find.text('FAILED'), findsNothing);
        expect(find.text('REVERSED'), findsNothing);
      },
    );

    testWidgets(
      'does not offer approval before a verified application reaches review',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program()],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'SUBMITTED',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Update Application Status'));
        await tester.pumpAndSettle();

        expect(find.text('UNDER REVIEW'), findsOneWidget);
        expect(find.text('APPROVED'), findsNothing);
      },
    );

    testWidgets(
      'offers approval only for a verified application under review',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program()],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'UNDER_REVIEW',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Update Application Status'));
        await tester.pumpAndSettle();

        expect(find.text('APPROVED'), findsOneWidget);
      },
    );

    testWidgets(
      'recognizes verified KYC nested on the persisted customer record',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program()],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'UNDER_REVIEW',
              verificationStatus: 'PENDING',
            )..['user'] = {'kycVerified': true},
          ],
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Update Application Status'));
        await tester.pumpAndSettle();

        expect(find.text('APPROVED'), findsOneWidget);
      },
    );

    testWidgets(
      'recognizes a verified nested customer KYC status',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program()],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'UNDER_REVIEW',
              verificationStatus: 'PENDING',
            )..['customer'] = {
                'kyc': {'status': 'VERIFIED'},
              },
          ],
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Update Application Status'));
        await tester.pumpAndSettle();

        expect(find.text('APPROVED'), findsOneWidget);
      },
    );

    testWidgets(
      'Head Office disburses a verified beneficiary while a program is DISBURSING',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'DISBURSING')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
          refreshedBeneficiaries: [
            beneficiary(
              applicationStatus: 'PAID',
              verificationStatus: 'VERIFIED',
              paymentStatus: 'PAID',
              paidAt: '2026-08-24T16:00:00.000Z',
              paymentReference: 'EMP-PAID-001',
            ),
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Review applications and beneficiaries'),
          400,
        );
        await tester.tap(find.text('Review applications and beneficiaries'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Youth Grant'));
        await tester.pumpAndSettle();
        expect(find.text('Pay Beneficiary'), findsOneWidget);
        await tester.tap(find.text('Pending Beneficiary'));
        await tester.pumpAndSettle();

        expect(find.text('Pay Beneficiary'), findsOneWidget);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();

        expect(find.text('Confirm beneficiary payment'), findsOneWidget);
        expect(find.text('Beneficiary'), findsOneWidget);
        expect(find.text('Youth Grant'), findsOneWidget);
        expect(find.text('₦25,000'), findsOneWidget);
        expect(find.text('Current program balance'), findsOneWidget);
        expect(find.text('Program balance after payment'), findsOneWidget);
        expect(find.text('SPW-1234'), findsOneWidget);
        expect(
          find.textContaining('This payment uses the program’s reserved balance.'),
          findsOneWidget,
        );

        await tester.tap(find.text('Pay Beneficiary').last);
        await tester.pumpAndSettle();

        expect(
          client.lastPostPath,
          '/api/empowerment/programs/program-1/beneficiaries/'
           'beneficiary-1/pay',
        );
        expect(client.lastPostHeaders['authorization'], 'Bearer test-admin-token');
        expect(
          client.lastPostHeaders['idempotency-key']!.length,
          greaterThanOrEqualTo(12),
        );
        expect(client.lastPostPayload, <String, dynamic>{});
        expect(find.textContaining('Payment: PAID'), findsOneWidget);
      },
    );

    testWidgets(
      'Head Office funds a program through the protected funding endpoint',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [
            program(
              status: 'APPROVED',
              totalFunded: 25000,
              remainingBalance: 25000,
            ),
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Create and manage empowerment programs'),
          400,
        );
        await tester.tap(find.text('Create and manage empowerment programs'));
        await tester.pumpAndSettle();

        expect(find.text('Add Funds'), findsOneWidget);
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();
        expect(find.text('Fund Youth Grant'), findsOneWidget);

        await tester.enterText(find.byType(TextField), '50000');
        await tester.enterText(find.byType(TextField).at(1), 'FY26-RESERVE');
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();

        expect(client.fundingCount, 1);
        expect(
          client.lastFundingRequest.url.path,
          '/api/empowerment/programs/program-1/fund',
        );
        expect(
          client.lastFundingPayload,
          {'amount': 50000.0, 'reference': 'FY26-RESERVE'},
        );
        expect(
          client.lastFundingHeaders['authorization'],
          'Bearer test-admin-token',
        );
        expect(
          client.lastFundingHeaders['idempotency-key']!.length,
          greaterThanOrEqualTo(12),
        );
        expect(find.textContaining('Total Funded: ₦75,000'), findsOneWidget);
        expect(
          find.textContaining('Remaining Balance: ₦75,000'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'blocks an eligible beneficiary payment when program funding is insufficient',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [
            program(
              status: 'APPROVED',
              totalFunded: 0,
              remainingBalance: 0,
            ),
          ],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);

        expect(find.text('Pay Beneficiary'), findsOneWidget);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();

        expect(
          find.text(
            'Program funding is insufficient. Fund this program before disbursement.',
          ),
          findsWidgets,
        );
        expect(client.disburseCount, 0);
      },
    );

    testWidgets(
      'funding enables payout and refreshes the persisted remaining balance',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [
            program(
              status: 'APPROVED',
              totalFunded: 0,
              remainingBalance: 0,
            ),
          ],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
          refreshedBeneficiaries: [
            beneficiary(
              applicationStatus: 'PAID',
              verificationStatus: 'VERIFIED',
              paymentStatus: 'PAID',
              paymentReference: 'EMP-PAID-002',
            ),
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Create and manage empowerment programs'),
          400,
        );
        await tester.tap(find.text('Create and manage empowerment programs'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), '25000');
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Close'));
        await tester.pumpAndSettle();

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Pay Beneficiary').last);
        await tester.pumpAndSettle();

        final financials =
            client.programs.first['financials'] as Map<String, dynamic>;
        expect(client.fundingCount, 1);
        expect(client.disburseCount, 1);
        expect(financials['totalFundedAmount'], 25000);
        expect(financials['totalDisbursedAmount'], 25000);
        expect(financials['availableFundingAmount'], 0);
        expect(client.programGetCount, greaterThanOrEqualTo(1));
      },
    );

    testWidgets(
      'renders persisted program funding audit activity',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          auditTrail: [
            {
              'action': 'PROGRAM_FUNDED',
              'description': '₦25,000 funded for Youth Grant',
              'createdAt': '2026-08-24T18:00:00.000Z',
            },
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(find.text('Audit Trail'), 400);
        await tester.tap(find.text('Audit Trail'));
        await tester.pumpAndSettle();

        expect(find.text('PROGRAM_FUNDED'), findsOneWidget);
        expect(
          find.text('₦25,000 funded for Youth Grant'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'reuses the funding idempotency key when a funding response is uncertain',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          fundingStatusCode: 500,
          fundingResponse: {
            'success': false,
            'message': 'Temporary funding response failure.',
          },
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Create and manage empowerment programs'),
          400,
        );
        await tester.tap(find.text('Create and manage empowerment programs'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), '50000');
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();
        final firstIdempotencyKey =
            client.lastFundingHeaders['idempotency-key'];

        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), '50000');
        await tester.tap(find.text('Add Funds'));
        await tester.pumpAndSettle();

        expect(client.fundingCount, 2);
        expect(client.lastFundingHeaders['idempotency-key'], firstIdempotencyKey);
      },
    );

    testWidgets(
      'does not expose program funding outside Head Office',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'auth_token': 'test-admin-token',
          'user_role': 'STATE_MANAGER',
        });
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Create and manage empowerment programs'),
          400,
        );
        await tester.tap(find.text('Create and manage empowerment programs'));
        await tester.pumpAndSettle();

        expect(find.text('Add Funds'), findsNothing);
        expect(client.fundingCount, 0);
      },
    );

    testWidgets(
      'does not expose payout when the program is not approved',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'OPEN')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);

        expect(find.text('Pay Beneficiary'), findsNothing);
        expect(client.disburseCount, 0);
      },
    );

    testWidgets(
      'fails closed when current program funding cannot be refreshed',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
          programGetStatusCode: 500,
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();

        expect(
          find.textContaining('Unable to confirm current program funding.'),
          findsOneWidget,
        );
        expect(find.text('Confirm beneficiary payment'), findsNothing);
        expect(client.disburseCount, 0);
      },
    );

    testWidgets(
      'shows Pay Beneficiary for an approved verified unpaid production record',
      (tester) async {
        final productionBeneficiary = beneficiary(
          applicationStatus: '',
          verificationStatus: 'PENDING',
        )
          ..remove('applicationStatus')
          ..['application'] = {'status': 'APPROVED'}
          ..['verification'] = {'status': 'VERIFIED'}
          ..['paymentReference'] = ''
          ..['paidAt'] = null;
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [productionBeneficiary],
        );

        await openBeneficiaryDetails(tester, client);

        expect(find.text('Pay Beneficiary'), findsOneWidget);
        expect(find.text('Update Application Status'), findsOneWidget);
        expect(
          tester
              .widget<OutlinedButton>(
                find.widgetWithText(
                  OutlinedButton,
                  'Update Application Status',
                ),
              )
              .onPressed,
          isNull,
        );
      },
    );

    testWidgets(
      'hides Pay Beneficiary when verification is pending',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'PENDING',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);

        expect(find.text('Pay Beneficiary'), findsNothing);
      },
    );

    testWidgets(
      'hides Pay Beneficiary while an application is under review',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'UNDER_REVIEW',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);

        expect(find.text('Pay Beneficiary'), findsNothing);
      },
    );

    testWidgets(
      'hides Pay Beneficiary after a completed payment',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'PAID',
              verificationStatus: 'VERIFIED',
              paymentReference: 'EMP-PAID-001',
              paidAt: '2026-08-24T16:00:00.000Z',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);

        expect(find.text('Payment status'), findsOneWidget);
        expect(find.text('PAID'), findsNWidgets(2));
        expect(find.text('Pay Beneficiary'), findsNothing);
      },
    );

    testWidgets(
      'keeps Pay Beneficiary reachable in a mobile detail dialog',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(360, 640));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await openBeneficiaryDetails(tester, client);
        final payButton = find.text('Pay Beneficiary');
        await tester.ensureVisible(payButton);
        await tester.tap(payButton);
        await tester.pumpAndSettle();

        expect(find.text('Confirm beneficiary payment'), findsOneWidget);
      },
    );

    testWidgets(
      'handles an idempotent beneficiary payment response without a duplicate action',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
          refreshedBeneficiaries: [
            beneficiary(
              applicationStatus: 'PAID',
              verificationStatus: 'VERIFIED',
              paymentStatus: 'PAID',
            ),
          ],
          disburseResponse: {
            'success': true,
            'idempotent': true,
            'batch': {'batchReference': 'EMP-PAID-001'},
          },
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Pay Beneficiary').last);
        await tester.pumpAndSettle();

        expect(client.disburseCount, 1);
        expect(
          find.text(
            'Payment was already processed. The latest beneficiary data has been refreshed.',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('Payment: PAID'), findsOneWidget);
      },
    );

    testWidgets(
      'does not show payment actions to a non-Head-Office role',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'auth_token': 'test-admin-token',
          'user_role': 'STATE_MANAGER',
        });
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await pumpAdminScreen(tester, client);
        expect(find.text('Disbursements'), findsNothing);

        await tester.scrollUntilVisible(
          find.text('Review applications and beneficiaries'),
          400,
        );
        await tester.tap(find.text('Review applications and beneficiaries'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Youth Grant'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Pending Beneficiary'));
        await tester.pumpAndSettle();

        expect(find.text('Pay Beneficiary'), findsNothing);
        expect(client.disburseCount, 0);
      },
    );

    testWidgets(
      'lists and refreshes Head Office disbursement history',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          disbursements: [
            {
              'batchReference': 'EMP-BATCH-001',
              'status': 'COMPLETED',
              'createdAt': '2026-08-24T16:00:00.000Z',
              'results': [
                {
                  'beneficiary': {'fullName': 'Paid Beneficiary'},
                  'amount': 25000,
                  'status': 'SUCCESSFUL',
                  'transactionReference': 'EMP-PAID-001',
                },
                {
                  'beneficiary': {'fullName': 'Reversed Beneficiary'},
                  'amount': 25000,
                  'status': 'REVERSED',
                  'transactionReference': 'EMP-REV-001',
                },
              ],
            },
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(find.text('Disbursements'), 400);
        await tester.tap(find.text('Disbursements'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Youth Grant'));
        await tester.pumpAndSettle();

        expect(find.text('Paid Beneficiary'), findsOneWidget);
        expect(find.text('Reversed Beneficiary'), findsOneWidget);
        expect(find.textContaining('Status: SUCCESSFUL'), findsOneWidget);
        expect(find.textContaining('Status: REVERSED'), findsOneWidget);
        expect(find.textContaining('EMP-PAID-001'), findsOneWidget);

        await tester.tap(find.text('Refresh'));
        await tester.pumpAndSettle();

        expect(client.disbursementHistoryGetCount, greaterThanOrEqualTo(2));
      },
    );

    testWidgets(
      'does not expose payout controls for existing payment states',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
              paymentStatus: 'PROCESSING',
            ),
            {
              ...beneficiary(
                applicationStatus: 'APPROVED',
                verificationStatus: 'VERIFIED',
                paymentStatus: 'REVERSED',
              ),
              '_id': 'beneficiary-2',
              'fullName': 'Reversed Beneficiary',
            },
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Review applications and beneficiaries'),
          400,
        );
        await tester.tap(find.text('Review applications and beneficiaries'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Youth Grant'));
        await tester.pumpAndSettle();

        expect(find.textContaining('Payment: PROCESSING'), findsOneWidget);
        expect(find.textContaining('Payment: REVERSED'), findsOneWidget);
        expect(find.text('Pay Beneficiary'), findsNothing);
      },
    );

    testWidgets(
      'reconciles a conflicting payout with refreshed server status',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
          refreshedBeneficiaries: [
            beneficiary(
              applicationStatus: 'PAID',
              verificationStatus: 'VERIFIED',
              paymentStatus: 'PAID',
            ),
          ],
          disburseStatusCode: 409,
          disburseResponse: {
            'success': false,
            'message': 'Payout state no longer allows disbursement.',
          },
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Pay Beneficiary').last);
        await tester.pumpAndSettle();

        expect(client.disburseCount, 1);
        expect(
          find.text(
            'Payout state no longer allows disbursement. '
            'The latest beneficiary data has been refreshed.',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('Payment: PAID'), findsOneWidget);
      },
    );

    testWidgets(
      'reports production authorization denial without duplicating a payout',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [program(status: 'APPROVED')],
          beneficiaries: [
            beneficiary(
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
          disburseStatusCode: 403,
          disburseResponse: {
            'success': false,
            'message': 'Forbidden',
          },
        );

        await openBeneficiaryDetails(tester, client);
        await tester.tap(find.text('Pay Beneficiary'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Pay Beneficiary').last);
        await tester.pumpAndSettle();

        expect(client.disburseCount, 1);
        expect(
          find.text('Only Head Office can disburse Empowerment funds.'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'selects only eligible beneficiaries and completes a confirmed bulk disbursement',
      (tester) async {
        final client = RecordingHttpClient(
          organizations: const [],
          programs: [
            program(
              status: 'DISBURSING',
              amountPerBeneficiary: 1000,
              totalFunded: 3000,
              remainingBalance: 3000,
            ),
          ],
          beneficiaries: [
            beneficiary(
              id: 'eligible-1',
              fullName: 'Eligible One',
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
            beneficiary(
              id: 'eligible-2',
              fullName: 'Eligible Two',
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
            beneficiary(
              id: 'already-paid',
              fullName: 'Already Paid',
              applicationStatus: 'PAID',
              verificationStatus: 'VERIFIED',
              paymentStatus: 'PAID',
            ),
            beneficiary(
              id: 'unverified',
              fullName: 'Unverified Person',
              applicationStatus: 'APPROVED',
              verificationStatus: 'PENDING',
            ),
            beneficiary(
              id: 'unlinked',
              fullName: 'No Linked Account',
              servicePayAccount: '',
              applicationStatus: 'APPROVED',
              verificationStatus: 'VERIFIED',
            ),
          ],
        );

        await pumpAdminScreen(tester, client);
        await tester.scrollUntilVisible(
          find.text('Review applications and beneficiaries'),
          400,
        );
        await tester.tap(find.text('Review applications and beneficiaries'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Youth Grant'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Bulk Disbursement'));
        await tester.pumpAndSettle();

        expect(find.text('Eligible beneficiaries'), findsOneWidget);
        expect(find.text('Eligible One'), findsOneWidget);
        expect(find.text('Eligible Two'), findsOneWidget);
        expect(find.text('Already Paid'), findsNothing);
        expect(find.text('Unverified Person'), findsNothing);
        expect(find.text('No Linked Account'), findsNothing);

        await tester.tap(find.text('Select All Eligible'));
        await tester.pumpAndSettle();
        expect(find.text('₦2,000'), findsOneWidget);
        expect(find.text('₦1,000'), findsOneWidget);

        await tester.tap(find.text('Review & Continue'));
        await tester.pumpAndSettle();
        expect(find.text('Confirm bulk disbursement'), findsOneWidget);
        expect(find.text('Number of beneficiaries'), findsOneWidget);
        expect(find.text('Total amount to disburse'), findsOneWidget);

        await tester.tap(find.text('Confirm Bulk Disbursement'));
        await tester.pumpAndSettle();

        expect(client.bulkDisburseCount, 1);
        expect(
          client.lastBulkDisbursementPayload['beneficiaryIds'],
          ['eligible-1', 'eligible-2'],
        );
        expect(
          client.lastBulkDisbursementHeaders['idempotency-key'],
          startsWith('empowerment-bulk-program-1-'),
        );
        expect(find.text('Bulk Disbursement Result'), findsOneWidget);
        expect(find.text('Successful'), findsOneWidget);
        expect(find.text('Total amount paid'), findsOneWidget);
        expect(find.text('Eligible One'), findsOneWidget);
        expect(find.textContaining('EMP-BULK-eligible-1'), findsOneWidget);
      },
    );
  });

  group('Head Office admin KYC review', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({
        'auth_token': 'test-admin-token',
        'user_role': 'HEAD_OFFICE',
      });
    });

    testWidgets(
      'searches with an encoded query and renders KYC metadata and details',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
        );

        await pumpKycScreen(tester, client);
        expect(find.text('Jane Customer'), findsOneWidget);
        expect(find.text('08000000000'), findsOneWidget);
        expect(find.text('jane@example.com'), findsOneWidget);
        expect(find.text('NIN: 12345678901'), findsOneWidget);
        expect(find.text('BVN: 10987654321'), findsOneWidget);
        expect(client.lastGetHeaders['authorization'], 'Bearer test-admin-token');

        await tester.enterText(find.byType(TextField), 'Jane Customer & Co');
        await tester.tap(find.widgetWithText(FilledButton, 'Search'));
        await tester.pumpAndSettle();

        expect(client.lastGetUri.queryParameters['search'], 'Jane Customer & Co');
        expect(client.lastGetUri.path, '/api/admin/kyc');

        await tester.tap(find.text('Jane Customer').first);
        await tester.pumpAndSettle();

        expect(find.text('Submitted NIN'), findsOneWidget);
        expect(find.text('Verification method'), findsOneWidget);
        expect(find.text('Document Url'), findsOneWidget);
        expect(find.text('Open'), findsOneWidget);
      },
    );

    testWidgets(
      'manual verification validates both identifiers and sends exact payload',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
          refreshedRecords: [verifiedKycRecord()],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.lastPatchUri.path, '/api/admin/kyc/kyc-1/status');
        expect(
          client.lastPatchPayload,
          {'status': 'VERIFIED', 'manualOverride': true},
        );
        expect(client.lastPatchHeaders['authorization'], 'Bearer test-admin-token');
        expect(client.getCount, greaterThanOrEqualTo(2));
        expect(find.textContaining('MANUAL_ADMIN_OVERRIDE'), findsOneWidget);
        expect(find.textContaining('Head Office Admin'), findsOneWidget);
        expect(find.text('2026-08-24T12:00:00.000Z'), findsOneWidget);
      },
    );

    testWidgets(
      'Head Office can manually verify without NIN or BVN',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [
            kycRecord(nin: '', bvn: ''),
          ],
          refreshedRecords: [
            verifiedKycRecord(nin: '', bvn: ''),
          ],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(
          client.lastPatchPayload,
          {'status': 'VERIFIED', 'manualOverride': true},
        );
        expect(find.textContaining('MANUAL_ADMIN_OVERRIDE'), findsOneWidget);
        expect(find.text('NIN: Not provided'), findsOneWidget);
        expect(find.text('BVN: Not provided'), findsOneWidget);
      },
    );

    testWidgets(
      'Head Office can manually verify with only NIN',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [
            kycRecord(bvn: ''),
          ],
          refreshedRecords: [
            verifiedKycRecord(bvn: ''),
          ],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(find.textContaining('MANUAL_ADMIN_OVERRIDE'), findsOneWidget);
        expect(find.text('NIN: 12345678901'), findsOneWidget);
        expect(find.text('BVN: Not provided'), findsOneWidget);
      },
    );

    testWidgets(
      'Head Office can manually verify with only BVN',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [
            kycRecord(nin: ''),
          ],
          refreshedRecords: [
            verifiedKycRecord(nin: ''),
          ],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(find.textContaining('MANUAL_ADMIN_OVERRIDE'), findsOneWidget);
        expect(find.text('NIN: Not provided'), findsOneWidget);
        expect(find.text('BVN: 10987654321'), findsOneWidget);
      },
    );

    testWidgets(
      'does not block Head Office override for invalid identifiers',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [
            kycRecord(
              nin: '1234567890',
              bvn: '1098765432',
            ),
          ],
          refreshedRecords: [
            verifiedKycRecord(
              nin: '1234567890',
              bvn: '1098765432',
            ),
          ],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(
          client.lastPatchPayload,
          {'status': 'VERIFIED', 'manualOverride': true},
        );
        expect(find.textContaining('MANUAL_ADMIN_OVERRIDE'), findsOneWidget);
      },
    );

    testWidgets(
      'keeps the detail open and shows an error when the server rejects override',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
          patchStatusCode: 422,
          patchResponse: {
            'success': false,
            'message': 'KYC provider requirements not met.',
          },
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(find.text('KYC provider requirements not met.'), findsOneWidget);
        expect(find.text('Manual Verify / Approve'), findsOneWidget);
      },
    );

    testWidgets(
      'does not report approval when the required server refresh fails',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
          refreshStatusCode: 500,
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(
          find.text(
            'KYC was updated, but the latest server state could not be loaded. Please refresh and confirm it before continuing.',
          ),
          findsOneWidget,
        );
        expect(find.text('Manual Verify / Approve'), findsOneWidget);
      },
    );

    testWidgets(
      'does not report approval when refreshed server data is still pending',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
          refreshedRecords: [kycRecord()],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(
          find.text(
            'KYC was updated, but the refreshed record does not confirm manual verification. Please refresh and reconcile it before continuing.',
          ),
          findsOneWidget,
        );
        expect(find.text('Manual Verify / Approve'), findsOneWidget);
      },
    );

    testWidgets(
      'does not report approval when refreshed metadata omits manual audit fields',
      (tester) async {
        final incompleteRefresh = verifiedKycRecord()
          ..remove('verificationMethod')
          ..remove('verifiedBy')
          ..remove('verifiedAt');
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
          refreshedRecords: [incompleteRefresh],
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
        expect(
          find.text(
            'KYC was updated, but the refreshed record does not confirm manual verification. Please refresh and reconcile it before continuing.',
          ),
          findsOneWidget,
        );
        expect(find.text('Manual Verify / Approve'), findsOneWidget);
      },
    );

    testWidgets(
      'submits only one manual override while an approval is in progress',
      (tester) async {
        final client = KycRecordingHttpClient(
          records: [kycRecord()],
          refreshedRecords: [verifiedKycRecord()],
          patchDelay: const Duration(seconds: 1),
        );

        await pumpKycScreen(tester, client);
        await tester.tap(find.text('Jane Customer'));
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Manual Verify / Approve'),
          500,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Manual Verify / Approve'));
        await tester.pump();
        await tester.tap(
          find.text('Manual Verify / Approve'),
          warnIfMissed: false,
        );
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle();

        expect(client.patchCount, 1);
      },
    );

    testWidgets(
      'does not expose the KYC workflow outside Head Office',
      (tester) async {
        final client = KycRecordingHttpClient(records: [kycRecord()]);

        await tester.pumpWidget(
          MaterialApp(
            home: AdminKycScreen(
              httpClient: client,
              headOfficeOverride: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Head Office access is required for KYC review.'), findsOneWidget);
        expect(find.text('Search customers'), findsNothing);
        expect(find.text('Manual Verify / Approve'), findsNothing);
        expect(client.getCount, 0);
      },
    );

    testWidgets(
      'does not allow a non-Head-Office role to override KYC',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'auth_token': 'test-admin-token',
          'user_role': 'STATE_MANAGER',
        });
        final client = KycRecordingHttpClient(records: [kycRecord()]);

        await tester.pumpWidget(
          MaterialApp(
            home: AdminKycScreen(httpClient: client),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Head Office access is required for KYC review.'), findsOneWidget);
        expect(find.text('Manual Verify / Approve'), findsNothing);
        expect(client.getCount, 0);
        expect(client.patchCount, 0);
      },
    );
  });

  group('Admin fintech control response contract', () {
    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'head-office-test-token',
        'user_role': 'HEAD_OFFICE',
      });
    });

    testWidgets(
      'parses the canonical fintech-control response contract',
      (tester) async {
        final client = MockClient((request) async {
          expect(
            request.url.path,
            '/api/settings/admin/fintech-control',
          );
          expect(
            request.headers['authorization'],
            'Bearer head-office-test-token',
          );
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'data': <String, dynamic>{
                'maintenance': <String, dynamic>{
                  'enabled': true,
                  'customerAppEnabled': true,
                  'apiEnabled': false,
                  'message': 'Scheduled verification window.',
                },
                'serviceLimits': <String, dynamic>{
                  'tier1Daily': 2500,
                  'tier1PerTransaction': 500,
                  'tier2Daily': 0,
                  'tier2PerTransaction': 0,
                  'tier3Daily': 0,
                  'tier3PerTransaction': 0,
                  'servicepayTransfer': 0,
                  'bankTransfer': 0,
                  'walletFunding': 0,
                  'withdrawal': 0,
                },
                'transactionFees': <String, dynamic>{},
                'legalPolicies': <String, dynamic>{},
                'featureToggles': <String, dynamic>{'airtime': true},
              },
            }),
            200,
          );
        });

        await tester.pumpWidget(
          MaterialApp(
            home: AdminPlatformConfigurationScreen(client: client),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Maintenance Mode'), findsWidgets);
        expect(
          find.text('Scheduled verification window.'),
          findsOneWidget,
        );
        final maintenanceSwitch = tester.widget<SwitchListTile>(
          find.widgetWithText(SwitchListTile, 'Global Maintenance'),
        );
        final apiSwitch = tester.widget<SwitchListTile>(
          find.widgetWithText(SwitchListTile, 'API Enabled'),
        );
        expect(maintenanceSwitch.value, isTrue);
        expect(apiSwitch.value, isFalse);

        await tester.tap(find.text('Service Limits').first);
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<TextField>(
                find.widgetWithText(TextField, 'Tier 1 Daily'),
              )
              .controller!
              .text,
          '2500',
        );
        expect(
          tester
              .widget<TextField>(
                find.widgetWithText(
                  TextField,
                  'Tier 1 Per Transaction',
                ),
              )
              .controller!
              .text,
          '500',
        );
      },
    );

    testWidgets(
      'blocks fintech controls before a non-Head Office request',
      (tester) async {
        SharedPreferences.setMockInitialValues(<String, Object>{
          'auth_token': 'staff-test-token',
          'user_role': 'STAFF',
        });
        var requests = 0;
        final client = MockClient((request) async {
          requests += 1;
          return http.Response('{}', 200);
        });

        await tester.pumpWidget(
          MaterialApp(
            home: AdminPlatformConfigurationScreen(client: client),
          ),
        );
        await tester.pumpAndSettle();

        expect(
          find.text(
            'Head Office access is required for Fintech Control settings.',
          ),
          findsOneWidget,
        );
        expect(requests, 0);
      },
    );
  });
}

Map<String, dynamic> organization(
  String name,
  String status, {
  String id = 'org-1',
}) {
  return {
    '_id': id,
    'name': name,
    'status': status,
  };
}

Map<String, dynamic> program({
  String status = 'OPEN',
  num amountPerBeneficiary = 25000,
  num totalFunded = 25000,
  num totalDisbursed = 0,
  num remainingBalance = 25000,
}) {
  return {
    '_id': 'program-1',
    'name': 'Youth Grant',
    'status': status,
    'amountPerBeneficiary': amountPerBeneficiary,
    'financials': {
      'totalFunded': totalFunded,
      'totalFundedAmount': totalFunded,
      'totalDisbursed': totalDisbursed,
      'totalDisbursedAmount': totalDisbursed,
      'remainingBalance': remainingBalance,
      'availableFundingAmount': remainingBalance,
    },
  };
}

Map<String, dynamic> beneficiary({
  String id = 'beneficiary-1',
  String fullName = 'Pending Beneficiary',
  String servicePayAccount = 'SPW-1234',
  String applicationStatus = 'UNDER_REVIEW',
  String verificationStatus = 'PENDING',
  String paymentStatus = '',
  String paymentReference = '',
  String paidAt = '',
}) {
  return {
    '_id': id,
    'fullName': fullName,
    'phone': '08000000000',
    'servicePayAccount': servicePayAccount,
    'applicationStatus': applicationStatus,
    'verificationStatus': verificationStatus,
    if (paymentStatus.isNotEmpty) 'paymentStatus': paymentStatus,
    'paymentReference': paymentReference,
    'paidAt': paidAt.isEmpty ? null : paidAt,
    'createdAt': '2026-08-24T00:00:00.000Z',
  };
}

Map<String, dynamic> kycRecord({
  String nin = '12345678901',
  String bvn = '10987654321',
}) {
  return {
    '_id': 'kyc-1',
    'fullName': 'Jane Customer',
    'phone': '08000000000',
    'email': 'jane@example.com',
    'status': 'PENDING',
    'nin': nin,
    'bvn': bvn,
    'tier': 'TIER_2',
    'verificationMethod': 'PROVIDER',
    'documentUrl': 'https://example.com/document.pdf',
  };
}

Map<String, dynamic> verifiedKycRecord({
  String nin = '12345678901',
  String bvn = '10987654321',
}) {
  return {
    ...kycRecord(),
    'status': 'VERIFIED',
    'nin': nin,
    'bvn': bvn,
    'verificationMethod': 'MANUAL_ADMIN_OVERRIDE',
    'verifiedBy': 'Head Office Admin',
    'verifiedAt': '2026-08-24T12:00:00.000Z',
  };
}

Future<void> pumpAdminScreen(
  WidgetTester tester,
  RecordingHttpClient client,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: AdminEmpowermentScreen(httpClient: client),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> pumpKycScreen(
  WidgetTester tester,
  KycRecordingHttpClient client,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: AdminKycScreen(
        httpClient: client,
        headOfficeOverride: true,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> openOrganizationDetails(
  WidgetTester tester,
  RecordingHttpClient client,
) async {
  await pumpAdminScreen(tester, client);
  await tester.scrollUntilVisible(
    find.text('Government, NGO and private organizations'),
    400,
  );
  await tester.tap(find.text('Government, NGO and private organizations'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(client.organizations.first['name'] as String));
  await tester.pumpAndSettle();
}

Future<void> openBeneficiaryDetails(
  WidgetTester tester,
  RecordingHttpClient client,
) async {
  await pumpAdminScreen(tester, client);
  await tester.scrollUntilVisible(
    find.text('Review applications and beneficiaries'),
    400,
  );
  await tester.tap(find.text('Review applications and beneficiaries'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(client.programs.first['name'] as String));
  await tester.pumpAndSettle();
  await tester.tap(find.text(client.beneficiaries.first['fullName'] as String));
  await tester.pumpAndSettle();
}

class RecordingHttpClient extends http.BaseClient {
  RecordingHttpClient({
    required this.organizations,
    this.programs = const [],
    this.beneficiaries = const [],
    this.refreshedBeneficiaries,
    this.disbursements = const [],
    this.auditTrail = const [],
    this.disburseStatusCode = 201,
    this.disburseResponse,
    this.bulkDisburseStatusCode = 201,
    this.bulkDisburseResponse,
    this.fundingStatusCode = 201,
    this.fundingResponse,
    this.programGetStatusCode = 200,
  });

  final List<Map<String, dynamic>> organizations;
  final List<Map<String, dynamic>> programs;
  final List<Map<String, dynamic>> beneficiaries;
  final List<Map<String, dynamic>>? refreshedBeneficiaries;
  final List<Map<String, dynamic>> disbursements;
  final List<Map<String, dynamic>> auditTrail;
  final int disburseStatusCode;
  final Map<String, dynamic>? disburseResponse;
  final int bulkDisburseStatusCode;
  final Map<String, dynamic>? bulkDisburseResponse;
  final int fundingStatusCode;
  final Map<String, dynamic>? fundingResponse;
  final int programGetStatusCode;
  final List<RecordedRequest> requests = [];
  int disburseCount = 0;
  int bulkDisburseCount = 0;
  int fundingCount = 0;
  int disbursementHistoryGetCount = 0;
  int programGetCount = 0;

  String? get lastPatchPath {
    for (final request in requests.reversed) {
      if (request.method == 'PATCH') {
        return request.url.path;
      }
    }
    return null;
  }

  Map<String, dynamic>? get lastPatchPayload {
    for (final request in requests.reversed) {
      if (request.method == 'PATCH') {
        return jsonDecode(request.body) as Map<String, dynamic>;
      }
    }
    return null;
  }

  String? get lastPostPath {
    for (final request in requests.reversed) {
      if (request.method == 'POST') {
        return request.url.path;
      }
    }
    return null;
  }

  Map<String, dynamic>? get lastPostPayload {
    for (final request in requests.reversed) {
      if (request.method == 'POST') {
        return jsonDecode(request.body) as Map<String, dynamic>;
      }
    }
    return null;
  }

  Map<String, String> get lastPostHeaders {
    final request = requests.lastWhere((item) => item.method == 'POST');
    return {
      for (final entry in request.headers.entries) entry.key.toLowerCase(): entry.value,
    };
  }

  RecordedRequest get lastFundingRequest {
    return requests.lastWhere(
      (request) => request.method == 'POST' && request.url.path.endsWith('/fund'),
    );
  }

  Map<String, dynamic> get lastFundingPayload {
    return jsonDecode(lastFundingRequest.body) as Map<String, dynamic>;
  }

  Map<String, String> get lastFundingHeaders {
    return {
      for (final entry in lastFundingRequest.headers.entries)
        entry.key.toLowerCase(): entry.value,
    };
  }

  RecordedRequest get lastBulkDisbursementRequest {
    return requests.lastWhere(
      (request) =>
          request.method == 'POST' &&
          request.url.path.endsWith('/bulk-disbursement'),
    );
  }

  Map<String, dynamic> get lastBulkDisbursementPayload {
    return jsonDecode(lastBulkDisbursementRequest.body) as Map<String, dynamic>;
  }

  Map<String, String> get lastBulkDisbursementHeaders {
    return {
      for (final entry in lastBulkDisbursementRequest.headers.entries)
        entry.key.toLowerCase(): entry.value,
    };
  }

  Map<String, dynamic> _currentProgramFinancials() {
    if (programs.isEmpty) return <String, dynamic>{};
    final program = programs.first;
    final financials = program['financials'];
    return financials is Map
        ? Map<String, dynamic>.from(financials)
        : <String, dynamic>{};
  }

  void _saveProgramFinancials(Map<String, dynamic> financials) {
    if (programs.isEmpty) return;
    programs.first['financials'] = financials;
  }

  void _applyFunding(num amount) {
    final current = _currentProgramFinancials();
    _saveProgramFinancials({
      ...current,
      'totalFundedAmount':
          (current['totalFundedAmount'] as num? ?? 0) + amount,
      'totalFunded': (current['totalFunded'] as num? ?? 0) + amount,
      'availableFundingAmount':
          (current['availableFundingAmount'] as num? ?? 0) + amount,
      'remainingBalance':
          (current['remainingBalance'] as num? ?? 0) + amount,
      'totalDisbursedAmount': current['totalDisbursedAmount'] as num? ?? 0,
      'totalDisbursed': current['totalDisbursed'] as num? ?? 0,
    });
  }

  void _applyDisbursement() {
    if (programs.isEmpty) return;
    final current = _currentProgramFinancials();
    final amount = programs.first['amountPerBeneficiary'] as num? ?? 0;
    _saveProgramFinancials({
      ...current,
      'totalFundedAmount': current['totalFundedAmount'] as num? ?? 0,
      'totalFunded': current['totalFunded'] as num? ?? 0,
      'availableFundingAmount':
          (current['availableFundingAmount'] as num? ?? 0) - amount,
      'remainingBalance':
          (current['remainingBalance'] as num? ?? 0) - amount,
      'totalDisbursedAmount':
          (current['totalDisbursedAmount'] as num? ?? 0) + amount,
      'totalDisbursed':
          (current['totalDisbursed'] as num? ?? 0) + amount,
    });
  }

  void _applyBulkDisbursement(List<String> beneficiaryIds) {
    if (programs.isEmpty) return;
    final current = _currentProgramFinancials();
    final amount = programs.first['amountPerBeneficiary'] as num? ?? 0;
    final total = amount * beneficiaryIds.length;
    _saveProgramFinancials({
      ...current,
      'totalFundedAmount': current['totalFundedAmount'] as num? ?? 0,
      'totalFunded': current['totalFunded'] as num? ?? 0,
      'availableFundingAmount':
          (current['availableFundingAmount'] as num? ?? 0) - total,
      'remainingBalance':
          (current['remainingBalance'] as num? ?? 0) - total,
      'totalDisbursedAmount':
          (current['totalDisbursedAmount'] as num? ?? 0) + total,
      'totalDisbursed':
          (current['totalDisbursed'] as num? ?? 0) + total,
    });
    for (final beneficiary in beneficiaries) {
      if (beneficiaryIds.contains(beneficiary['_id']?.toString())) {
        beneficiary['applicationStatus'] = 'PAID';
        beneficiary['paymentStatus'] = 'PAID';
        beneficiary['paymentReference'] =
            'EMP-BULK-${beneficiary['_id']?.toString() ?? ''}';
        beneficiary['paidAt'] = '2026-08-24T18:00:00.000Z';
      }
    }
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = request is http.Request ? request.body : '';
    final headers = Map<String, String>.from(request.headers);
    requests.add(
      RecordedRequest(
        method: request.method,
        url: request.url,
        body: body,
        headers: headers,
      ),
    );

    dynamic responseBody;
    var statusCode = 200;

    if (request.method == 'GET' &&
        RegExp(r'/empowerment/programs/[^/]+$')
            .hasMatch(request.url.path)) {
      programGetCount++;
      statusCode = programGetStatusCode;
      responseBody = statusCode >= 200 && statusCode < 300
          ? {
              'success': true,
              'program': programs.isEmpty ? null : programs.first,
              'financials': _currentProgramFinancials(),
            }
          : {
              'success': false,
              'message': 'Unable to refresh program funding.',
            };
    } else if (request.url.path.endsWith('/empowerment/organizations')) {
      responseBody = {'organizations': organizations};
    } else if (request.url.path.endsWith('/empowerment/programs')) {
      responseBody = {'programs': programs};
    } else if (request.method == 'GET' &&
        request.url.path.contains('/empowerment/programs/') &&
        request.url.path.endsWith('/disbursements')) {
      disbursementHistoryGetCount++;
      responseBody = {'success': true, 'batches': disbursements};
    } else if (request.method == 'GET' &&
        request.url.path.endsWith('/empowerment/audit')) {
      responseBody = {'success': true, 'activities': auditTrail};
    } else if (request.method == 'GET' &&
        request.url.path.endsWith('/eligible-beneficiaries')) {
      responseBody = {'success': true, 'beneficiaries': beneficiaries};
    } else if (request.url.path.contains('/programs/') &&
        request.url.path.endsWith('/beneficiaries')) {
      responseBody = {
        'beneficiaries': (disburseCount > 0 || bulkDisburseCount > 0) &&
                refreshedBeneficiaries != null
            ? refreshedBeneficiaries
            : beneficiaries,
      };
    } else if (request.url.path.endsWith('/empowerment/dashboard-summary')) {
      responseBody = {
        'success': true,
        'summary': {},
        'recentActivity': {},
      };
    } else if (request.method == 'PATCH' &&
        request.url.path.contains('/empowerment/organizations/')) {
      responseBody = {
        'success': true,
        'message': 'Status updated successfully.',
      };
    } else if (request.method == 'PATCH' &&
        request.url.path.contains('/empowerment/beneficiaries/')) {
      responseBody = {
        'success': true,
        'message': 'Beneficiary updated successfully.',
      };
    } else if (request.method == 'POST' &&
        request.url.path.endsWith('/bulk-disbursement')) {
      bulkDisburseCount++;
      statusCode = bulkDisburseStatusCode;
      final requestPayload = jsonDecode(body) as Map<String, dynamic>;
      final beneficiaryIds = List<String>.from(
        requestPayload['beneficiaryIds'] as List? ?? const <String>[],
      );
      if (statusCode >= 200 && statusCode < 300) {
        _applyBulkDisbursement(beneficiaryIds);
      }
      final amount = programs.isEmpty
          ? 0
          : programs.first['amountPerBeneficiary'] as num? ?? 0;
      responseBody = bulkDisburseResponse ??
          {
            'success': statusCode >= 200 && statusCode < 300,
            'idempotent': false,
            'financials': _currentProgramFinancials(),
            'resultSummary': {
              'successful': [
                for (final id in beneficiaryIds)
                  {
                    'beneficiary': id,
                    'amount': amount,
                    'status': 'SUCCESSFUL',
                    'transactionReference': 'EMP-BULK-$id',
                  },
              ],
              'skipped': const [],
              'failed': const [],
              'totalAmountPaid': amount * beneficiaryIds.length,
              'remainingProgramBalance':
                  _currentProgramFinancials()['availableFundingAmount'] ?? 0,
            },
            'batch': {
              'batchReference': 'EMP-BULK-001',
              'status': 'COMPLETED',
              'results': [
                for (final id in beneficiaryIds)
                  {
                    'beneficiary': id,
                    'amount': amount,
                    'status': 'SUCCESSFUL',
                    'transactionReference': 'EMP-BULK-$id',
                  },
              ],
            },
          };
    } else if (request.method == 'POST' &&
        request.url.path.endsWith('/fund')) {
      fundingCount++;
      statusCode = fundingStatusCode;
      final requestPayload = jsonDecode(body) as Map<String, dynamic>;
      final amount = requestPayload['amount'] as num? ?? 0;
      if (statusCode >= 200 && statusCode < 300) {
        _applyFunding(amount);
      }
      responseBody = fundingResponse ??
          {
            'success': statusCode >= 200 && statusCode < 300,
            'idempotent': false,
            'financials': _currentProgramFinancials(),
          };
    } else if (request.method == 'POST' &&
        request.url.path.contains('/beneficiaries/') &&
        request.url.path.endsWith('/pay')) {
      disburseCount++;
      statusCode = disburseStatusCode;
      if (statusCode >= 200 &&
          statusCode < 300 &&
          (disburseResponse == null ||
              (disburseResponse!['success'] != false &&
                  disburseResponse!['idempotent'] != true))) {
        _applyDisbursement();
      }
      responseBody = disburseResponse ??
          {
            'success': true,
            'idempotent': false,
            'batch': {'batchReference': 'EMP-PAID-001'},
          };
    } else {
      statusCode = 404;
      responseBody = {'success': false, 'message': 'Unexpected test request.'};
    }

    final responseBytes = utf8.encode(jsonEncode(responseBody));
    return http.StreamedResponse(
      Stream<List<int>>.value(responseBytes),
      statusCode,
      headers: {'content-type': 'application/json'},
      request: request,
    );
  }
}

class RecordedRequest {
  const RecordedRequest({
    required this.method,
    required this.url,
    required this.body,
    this.headers = const {},
  });

  final String method;
  final Uri url;
  final String body;
  final Map<String, String> headers;
}

class KycRecordingHttpClient extends http.BaseClient {
  KycRecordingHttpClient({
    required this.records,
    this.refreshedRecords,
    this.patchStatusCode = 200,
    this.patchResponse,
    this.refreshStatusCode = 200,
    this.patchDelay,
  });

  final List<Map<String, dynamic>> records;
  final List<Map<String, dynamic>>? refreshedRecords;
  final int patchStatusCode;
  final Map<String, dynamic>? patchResponse;
  final int refreshStatusCode;
  final Duration? patchDelay;
  final List<RecordedRequest> requests = [];
  int getCount = 0;
  int patchCount = 0;

  Uri get lastGetUri {
    return requests.lastWhere((request) => request.method == 'GET').url;
  }

  Map<String, String> get lastGetHeaders {
    final request = requests.lastWhere((item) => item.method == 'GET');
    return {
      for (final entry in request.headers.entries) entry.key.toLowerCase(): entry.value,
    };
  }

  Uri get lastPatchUri {
    return requests.lastWhere((request) => request.method == 'PATCH').url;
  }

  Map<String, dynamic> get lastPatchPayload {
    final request = requests.lastWhere((item) => item.method == 'PATCH');
    return jsonDecode(request.body) as Map<String, dynamic>;
  }

  Map<String, String> get lastPatchHeaders {
    final request = requests.lastWhere((item) => item.method == 'PATCH');
    return {
      for (final entry in request.headers.entries) entry.key.toLowerCase(): entry.value,
    };
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = request is http.Request ? request.body : '';
    final headers = Map<String, String>.from(request.headers);
    requests.add(
      RecordedRequest(
        method: request.method,
        url: request.url,
        body: body,
        headers: headers,
      ),
    );

    dynamic responseBody;
    var statusCode = 200;
    if (request.method == 'GET' && request.url.path == '/api/admin/kyc') {
      getCount++;
      if (getCount > 1 && refreshStatusCode >= 400) {
        statusCode = refreshStatusCode;
        responseBody = {
          'success': false,
          'message': 'Unable to reload KYC records.',
        };
      } else {
        responseBody = {
          'success': true,
          'applications': getCount > 1 && refreshedRecords != null
              ? refreshedRecords
              : records,
        };
      }
    } else if (request.method == 'PATCH' &&
        request.url.path == '/api/admin/kyc/kyc-1/status') {
      patchCount++;
      if (patchDelay != null) {
        await Future<void>.delayed(patchDelay!);
      }
      statusCode = patchStatusCode;
      responseBody = patchResponse ??
          {
            'success': true,
            'message': 'KYC verified.',
          };
    } else {
      statusCode = 404;
      responseBody = {
        'success': false,
        'message': 'Unexpected KYC request.',
      };
    }

    final responseBytes = utf8.encode(jsonEncode(responseBody));
    return http.StreamedResponse(
      Stream<List<int>>.value(responseBytes),
      statusCode,
      headers: {'content-type': 'application/json'},
      request: request,
    );
  }
}