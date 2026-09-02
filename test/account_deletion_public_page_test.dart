import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('public account deletion page contains compliant forms and disclosures',
      () {
    final html = File('web/delete-account.html').readAsStringSync();
    expect(html, contains('<title>Delete Your ServicePay Account</title>'));
    expect(html, contains('Request Account Deletion'));
    expect(html, contains('Request specific data'));
    expect(html, contains('/api/privacy/account-deletion-requests'));
    expect(html, contains('/api/privacy/data-requests'));
    expect(html, contains('account deletion is irreversible'));
    expect(html, contains('legal, regulatory, financial'));
    expect(html.toLowerCase(), contains('do not enter your password'));
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
