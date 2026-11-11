import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:share_plus/share_plus.dart';
import 'package:servicepay_app/airtime_result_screen.dart';
import 'package:servicepay_app/airtime_receipt_screen.dart';

Map<String, dynamic> detailResponse(String status, {String? reason}) => {
      'success': true,
      'data': {
        'transaction': {
          'id': 'tx-1',
          'reference': 'SP-AIR-91',
          'status': status,
          'serviceType': 'AIRTIME',
          'amount': '500',
          'network': 'MTN',
          'phone': '08012345678',
          'createdAt': '2025-02-04T10:20:00.000Z',
          'paymentMethod': 'Wallet',
          'description': 'Airtime purchase',
          'customerName': 'Ada Okafor',
          'customerId': 'CUS-81',
          'refundStatus': 'NONE',
          'charged': status == 'SUCCESSFUL',
          'refundRecorded': false,
          if (reason != null) 'failureReason': reason,
        },
      },
    };

Widget harness(Widget child) => MaterialApp(home: child);

void main() {
  testWidgets(
      'confirmed success presents a receipt action and transaction data',
      (tester) async {
    await tester.pumpWidget(harness(AirtimeResultScreen(
      identity: 'SP-AIR-91',
      initialResult: const {'status': 'PENDING', 'pending': true},
      phone: '08012345678',
      network: 'MTN',
      amount: '500',
      loadDetails: (_) async => detailResponse('SUCCESSFUL'),
    )));
    await tester.pumpAndSettle();

    expect(find.text('SUCCESSFUL'), findsOneWidget);
    expect(find.text('Airtime Purchase Successful'), findsOneWidget);
    expect(find.text('₦500'), findsOneWidget);
    expect(find.text('SP-AIR-91'), findsOneWidget);
    expect(find.text('View receipt'), findsOneWidget);
  });

  testWidgets('confirmed failure shows reason and never offers a receipt',
      (tester) async {
    await tester.pumpWidget(harness(AirtimeResultScreen(
      identity: 'SP-AIR-91',
      initialResult: const {'status': 'PENDING', 'pending': true},
      phone: '08012345678',
      network: 'Airtel',
      amount: '750',
      loadDetails: (_) async =>
          detailResponse('FAILED', reason: 'Provider confirmed failure.'),
    )));
    await tester.pumpAndSettle();

    expect(find.text('FAILED'), findsOneWidget);
    expect(find.text('Provider confirmed failure.'), findsOneWidget);
    expect(find.text('View receipt'), findsNothing);
  });

  testWidgets('timeout and unavailable original key stay pending',
      (tester) async {
    await tester.pumpWidget(harness(AirtimeResultScreen(
      identity: 'airtime-original-key',
      initialResult: const {
        'status': 'TIMEOUT',
        'pending': true,
        'success': false,
      },
      phone: '08012345678',
      network: 'Glo',
      amount: '100',
      loadDetails: (_) async => throw Exception('404'),
    )));
    await tester.pumpAndSettle();

    expect(find.text('PENDING'), findsOneWidget);
    expect(find.text('Transaction Pending'), findsOneWidget);
    expect(find.textContaining('request remains saved'), findsOneWidget);
    expect(find.text('Check status'), findsOneWidget);
    expect(find.text('Airtime Purchase Failed'), findsNothing);
  });

  testWidgets('rapid status taps cannot overlap manual requeries',
      (tester) async {
    var requeryCount = 0;
    final completer = Completer<Map<String, dynamic>>();
    await tester.pumpWidget(harness(AirtimeResultScreen(
      identity: 'airtime-key',
      idempotencyKey: 'airtime-key',
      initialResult: const {'status': 'PENDING', 'pending': true},
      phone: '08012345678',
      network: 'MTN',
      amount: '50',
      loadDetails: (_) async => detailResponse('PENDING'),
      requery: (_) {
        requeryCount++;
        return completer.future;
      },
    )));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Check status'));
    await tester.tap(find.text('Check status'));
    await tester.pump();
    expect(requeryCount, 1);
    expect(find.text('Checking status…'), findsOneWidget);
    completer.complete(const {'success': true, 'status': 'PENDING'});
    await tester.pumpAndSettle();
    expect(find.text('Transaction Pending'), findsOneWidget);
  });

  testWidgets('receipt revalidates and withholds success when reversed',
      (tester) async {
    var detailReads = 0;
    await tester.pumpWidget(harness(AirtimeReceiptScreen(
      identity: 'SP-AIR-91',
      transaction: const {'reference': 'SP-AIR-91', 'status': 'SUCCESSFUL'},
      loadDetails: (_) async {
        detailReads++;
        return detailResponse('REVERSED');
      },
      loadPdf: (_) async => Uint8List(0),
    )));
    await tester.pumpAndSettle();

    expect(detailReads, 1);
    expect(find.text('Receipt unavailable'), findsOneWidget);
    expect(find.text('SUCCESSFUL'), findsNothing);
    expect(find.text('Download PDF'), findsNothing);
  });

  testWidgets('receipt revalidates before sharing the actual PDF bytes',
      (tester) async {
    var reads = 0;
    var pdfReads = 0;
    var shares = 0;
    ShareParams? sharedParams;
    await tester.pumpWidget(harness(AirtimeReceiptScreen(
      identity: 'SP-AIR-91',
      transaction: const {'reference': 'SP-AIR-91'},
      loadDetails: (_) async {
        reads++;
        return detailResponse('SUCCESSFUL');
      },
      loadPdf: (_) async {
        pdfReads++;
        return Uint8List.fromList([37, 80, 68, 70]);
      },
      sharePdf: (params) async {
        shares++;
        sharedParams = params;
        return const ShareResult('shared', ShareResultStatus.success);
      },
    )));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Share PDF'));
    await tester.tap(find.text('Share PDF'));
    await tester.pumpAndSettle();

    expect(reads, 2);
    expect(pdfReads, 1);
    expect(shares, 1);
    expect(sharedParams!.files, hasLength(1));
    expect(sharedParams!.files!.single.mimeType, 'application/pdf');
    expect(
        sharedParams!.fileNameOverrides, ['servicepay-airtime-SP-AIR-91.pdf']);
    expect(sharedParams!.downloadFallbackEnabled, isTrue);
  });

  testWidgets('web-supported file sharing is attempted without eager download',
      (tester) async {
    var downloads = 0;
    var shares = 0;
    ShareParams? sharedParams;
    await tester.pumpWidget(harness(AirtimeReceiptScreen(
      identity: 'SP-AIR-91',
      transaction: const {'reference': 'SP-AIR-91'},
      loadDetails: (_) async => detailResponse('SUCCESSFUL'),
      loadPdf: (_) async => Uint8List.fromList([37, 80, 68, 70]),
      downloadBytes: (bytes, name, {mimeType = 'image/png'}) async {
        downloads++;
        return 'PDF downloaded.';
      },
      sharePdf: (params) async {
        shares++;
        sharedParams = params;
        return const ShareResult('shared', ShareResultStatus.success);
      },
    )));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Share PDF'));
    await tester.tap(find.text('Share PDF'));
    await tester.pumpAndSettle();

    expect(shares, 1);
    expect(downloads, 0);
    expect(sharedParams!.files, hasLength(1));
    expect(sharedParams!.files!.single.mimeType, 'application/pdf');
    expect(
        sharedParams!.fileNameOverrides, ['servicepay-airtime-SP-AIR-91.pdf']);
    expect(sharedParams!.downloadFallbackEnabled, isTrue);
  });

  testWidgets('unavailable web file sharing uses SharePlus PDF fallback',
      (tester) async {
    var downloads = 0;
    String? downloadedName;
    String? downloadedMimeType;
    final pdfBytes = Uint8List.fromList([37, 80, 68, 70]);
    Future<String> fakeDownload(Uint8List bytes, String name,
        {String mimeType = 'image/png'}) async {
      downloads++;
      downloadedName = name;
      downloadedMimeType = mimeType;
      return 'PDF downloaded.';
    }

    await tester.pumpWidget(harness(AirtimeReceiptScreen(
      identity: 'SP-AIR-91',
      transaction: const {'reference': 'SP-AIR-91'},
      loadDetails: (_) async => detailResponse('SUCCESSFUL'),
      loadPdf: (_) async => pdfBytes,
      downloadBytes: fakeDownload,
      sharePdf: (params) async {
        if (params.downloadFallbackEnabled) {
          await fakeDownload(
            pdfBytes,
            params.fileNameOverrides!.single,
            mimeType: params.files!.single.mimeType ?? '',
          );
        }
        return ShareResult.unavailable;
      },
    )));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Share PDF'));
    await tester.tap(find.text('Share PDF'));
    await tester.pumpAndSettle();

    expect(downloads, 1);
    expect(downloadedMimeType, 'application/pdf');
    expect(downloadedName, 'servicepay-airtime-SP-AIR-91.pdf');
  });

  testWidgets('cancelled share does not trigger a download fallback',
      (tester) async {
    var downloads = 0;
    await tester.pumpWidget(harness(AirtimeReceiptScreen(
      identity: 'SP-AIR-91',
      transaction: const {'reference': 'SP-AIR-91'},
      loadDetails: (_) async => detailResponse('SUCCESSFUL'),
      loadPdf: (_) async => Uint8List.fromList([37, 80, 68, 70]),
      downloadBytes: (bytes, name, {mimeType = 'image/png'}) async {
        downloads++;
        return 'PDF downloaded.';
      },
      sharePdf: (_) async =>
          const ShareResult('dismissed', ShareResultStatus.dismissed),
    )));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Share PDF'));
    await tester.tap(find.text('Share PDF'));
    await tester.pumpAndSettle();

    expect(downloads, 0);
  });

  testWidgets('status layout remains usable at narrow mobile width',
      (tester) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(harness(AirtimeResultScreen(
      identity: 'key-1',
      initialResult: const {'status': 'PENDING', 'pending': true},
      phone: '08012345678',
      network: '9mobile',
      amount: '500',
      loadDetails: (_) async => detailResponse('PENDING'),
    )));
    await tester.pumpAndSettle();

    expect(find.text('Transaction Pending'), findsOneWidget);
    expect(find.text('Check status'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
