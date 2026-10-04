// HTTP success and a provider message are not payment finality. These values
// come from the authenticated ServicePay transaction response.
String electricityPaymentStatus(Map<String, dynamic> payment,
    {bool pending = false}) {
  if (pending) return 'PENDING';
  final status = payment['status']?.toString().trim().toUpperCase();
  if (status == 'SUCCESSFUL' || status == 'SUCCESS') return 'SUCCESSFUL';
  if (status == 'FAILED') return 'FAILED';
  return 'PENDING';
}

double electricityPaymentAmount(Map<String, dynamic> payment) {
  final amount = double.tryParse('${payment['amount']}');
  if (amount == null || !amount.isFinite || amount <= 0) {
    throw const FormatException('Payment amount is unavailable.');
  }
  return amount;
}
