import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('public account deletion page contains compliant forms and disclosures',
      () {
    final html = File('web/delete-account.html').readAsStringSync();
    expect(html, contains('<title>Delete Your ServicePay Account</title>'));
    expect(html, contains('Request account deletion'));
    expect(html, contains('Request specific data'));
    expect(html, contains("'/account-deletion-requests'"));
    expect(html, contains("'/account-deletion/challenges'"));
    expect(html, contains("'/account-deletion-requests/status'"));
    expect(html, contains("'/data-requests'"));
    expect(html, contains('Deletion cannot be undone'));
    expect(html, contains('financial, transaction, KYC'));
    expect(html, contains("credentials:'omit'"));
    expect(html, contains('type="password"'));
    expect(html, contains('type="checkbox" id="c1"'));
    expect(html, contains('30 calendar days'));
    expect(html.toUpperCase(), contains('YUMPAY GLOBAL TECH LTD'));
  });

  test('customer surfaces link to the public deletion page', () {
    for (final path in <String>[
      'lib/profile_screen.dart',
      'lib/help_support_screen.dart',
      'lib/public_website_screen.dart',
      'lib/privacy_policy_screen.dart',
      'web/privacy-policy.html',
    ]) {
      expect(
        File(path).readAsStringSync(),
        contains('delete-account'),
        reason: '$path must expose the deletion request page',
      );
    }
  });
}
