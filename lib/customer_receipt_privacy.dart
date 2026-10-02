/// Display/export filtering only. Stored transactions and staff records remain intact.
final _providerNames = RegExp(
  r'\b(telecom[\s_-]*abode|club[\s_-]*konnect|vtpass|paystack|flutterwave|monnify)\b',
  caseSensitive: false,
);

String customerReceiptText(String text) {
  if (RegExp(
    r'https?://\S*(telecomabode|clubkonnect|vtpass|paystack|flutterwave|monnify|/api/)\S*',
    caseSensitive: false,
  ).hasMatch(text)) {
    return 'Contact ServicePay support with your transaction reference if you need help.';
  }
  final cleaned = text.replaceAll(_providerNames, 'ServicePay');
  if (RegExp(
    r'(provider cost|accounting reconciliation|profit and commission|api key|api credential)',
    caseSensitive: false,
  ).hasMatch(cleaned)) {
    return 'Contact ServicePay support with your transaction reference if you need help.';
  }
  return cleaned;
}

bool isPrivateReceiptLabel(String label) => RegExp(
      r'(provider|api|routing|internal|upstream|raw response|dispatch|reconciliation|cost|profit|margin|password|secret|authorization|access.?token|auth.?token|transaction.?pin)',
      caseSensitive: false,
    ).hasMatch(label);
