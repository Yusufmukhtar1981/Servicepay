// Customer presentation policy only. Never disables APIs or historical records.
bool isHiddenCustomerService(String value) {
  final key = value.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');
  return const <String>{
    'qrpay', 'qrpayment', 'qrscan',
    'groupwallet', 'groupajo', 'groupwalletajo',
    'businesswallet', 'businesswalletsme',
    'paybylink', 'paybylinkmerchant',
    'servicepaycall', 'voicecall', 'requestmoney', 'financialservices',
    'transfer', 'servicepaytransfer',
    'withdraw', 'withdrawal', 'walletwithdrawal', 'bankwithdrawal',
    'exampin', 'educationpin', 'cable', 'cabletv', 'tvsubscription',
    'airtimetocash',
  }.contains(key);
}

bool promotesHiddenCustomerService(String value) {
  if (isHiddenCustomerService(value)) return true;
  return RegExp(
    r'\b(?:qr[\s-]*(?:pay(?:ment)?|scan)|group[\s/-]*(?:wallet|ajo)|'
    r'business[\s-]*wallet|pay[\s-]*by[\s-]*link|servicepay[\s-]*call|'
    r'request[\s-]*money|financial[\s-]*services|withdraw(?:al)?|'
    r'(?:exam|education)[\s-]*pin|cable(?:[\s-]*tv)?|'
    r'tv[\s-]*subscription|airtime[\s-]*to[\s-]*cash)\b',
    caseSensitive: false,
  ).hasMatch(value.replaceAll('_', ' '));
}

bool isCustomerMiniAppVisible(Map<String, dynamic> app) {
  return !<String>['routeKey', 'slug', 'name', 'description']
      .any((key) => promotesHiddenCustomerService(app[key]?.toString() ?? ''));
}

String customerMiniAppCategory(Object? value) {
  final category = value?.toString() ?? 'Services';
  return isHiddenCustomerService(category) ? 'Other Services' : category;
}
