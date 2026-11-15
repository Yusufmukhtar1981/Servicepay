import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:servicepay_app/customer_experience_screen.dart';

void main() {
  test('force update blocks every older release, even at minimum version', () {
    expect(
      shouldRequireUpdate(
        active: true,
        installedVersionCode: 18,
        minimumVersionCode: 18,
        latestVersionCode: 19,
        forceUpdate: true,
      ),
      isTrue,
    );
    expect(
      shouldRequireUpdate(
        active: true,
        installedVersionCode: 19,
        minimumVersionCode: 18,
        latestVersionCode: 19,
        forceUpdate: true,
      ),
      isFalse,
    );
  });
  group('customer update decision', () {
    test('never offers updates to web or non-Android (channel caller guard)',
        () async {
      expect(
        await InstalledAppVersion.read(
          isWeb: true,
          platform: TargetPlatform.android,
        ),
        isNull,
      );
      expect(
        await InstalledAppVersion.read(
          isWeb: false,
          platform: TargetPlatform.iOS,
        ),
        isNull,
      );
    });

    test('force gate compares integer codes and requires active configuration',
        () {
      expect(
        shouldRequireUpdate(
          active: true,
          installedVersionCode: 84,
          minimumVersionCode: 85,
          forceUpdate: true,
        ),
        isTrue,
      );
      expect(
        shouldRequireUpdate(
          active: false,
          installedVersionCode: 84,
          minimumVersionCode: 85,
          forceUpdate: true,
        ),
        isFalse,
      );
      expect(
        shouldRequireUpdate(
          active: true,
          installedVersionCode: 85,
          minimumVersionCode: 85,
          forceUpdate: true,
        ),
        isFalse,
      );
    });

    test('optional prompt respects latest version and dismissal code', () {
      expect(
        shouldOfferOptionalUpdate(
          active: true,
          installedVersionCode: 84,
          latestVersionCode: 86,
          dismissedLatestVersionCode: 85,
        ),
        isTrue,
      );
      expect(
        shouldOfferOptionalUpdate(
          active: true,
          installedVersionCode: 84,
          latestVersionCode: 86,
          dismissedLatestVersionCode: 86,
        ),
        isFalse,
      );
    });

    test('kobo are formatted as naira without floating point conversion', () {
      expect(formatKobo(123456789), '₦1,234,567.89');
      expect(formatKobo(-5), '-₦0.05');
    });
  });
}
