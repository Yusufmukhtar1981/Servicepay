part of 'branch_counter_screen.dart';

Future<void> _printReceipt(
  BranchCounterApi api,
  Map<String, dynamic> order, {
  required String layout,
  required bool reprint,
  required CounterReceiptOpener? opener,
  required Object? popup,
  required BuildContext context,
}) async {
  final String kind = '${order['kind'] ?? 'DELIVERY'}';
  final String id = '${order['_id'] ?? order['id'] ?? ''}';
  bool handedToBrowser = false;
  try {
    if (opener == null && popup == null) {
      throw CounterApiException(kIsWeb
          ? 'Your browser blocked the receipt tab. Allow pop-ups for ServicePay, then try again.'
          : 'Receipt printing is available in a browser. Open this account in the browser to print.');
    }
    if (id.isEmpty) throw const CounterApiException('Order ID is unavailable.');
    final Map<String, dynamic> response =
        await api.getReceipt(kind, id, layout: layout);
    final String html = '${response['html'] ?? ''}';
    if (html.trim().isEmpty) {
      throw const CounterApiException('The receipt response was empty.');
    }
    await api.recordPrintEvent(kind, id, reprint: reprint, layout: layout);
    final bool opened = opener != null
        ? await opener(html)
        : await openCounterReceiptInReservedPopup(popup, html);
    if (!opened) {
      throw const CounterApiException(
          'Could not open the print view on this device.');
    }
    handedToBrowser = opener == null;
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Print request recorded. It does not confirm physical printer completion.')));
    }
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  } finally {
    // Fetch failures and navigation failures must not leave an empty tab open.
    // The web renderer retains the popup only after a successful Blob URL load.
    if (opener == null && !handedToBrowser) {
      closeCounterReceiptPopup(popup);
    }
  }
}