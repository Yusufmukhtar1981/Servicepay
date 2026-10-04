import 'dart:async';
import 'dart:html' as html;

class _ReservedReceiptWindow {
  const _ReservedReceiptWindow(this.window);
  final dynamic window;
}

/// Called directly from the user click handler, before authenticated fetches.
Object? reserveCounterReceiptPopup() {
  try {
    final dynamic popup = html.window.open('about:blank', '_blank');
    if (popup == null) return null;
    // Retain a handle for the later Blob navigation, but sever access back to
    // the authenticated application immediately.
    popup.opener = null;
    popup.document?.title = 'Preparing ServicePay receipt';
    popup.document?.body?.text = 'Preparing your secure receipt…';
    return _ReservedReceiptWindow(popup);
  } catch (_) {
    return null;
  }
}

String createCounterReceiptBlobUrl(String serverHtml) {
  final String printScript =
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script>';
  final String printableHtml = serverHtml.toLowerCase().contains('</body>')
      ? serverHtml.replaceFirst(
          RegExp(r'</body\s*>', caseSensitive: false),
          '$printScript</body>',
        )
      : '$serverHtml$printScript';
  // Blob data is HTML, not executable JS interpolation or a data: URL. No
  // authentication material is put into the new window's URL or document.
  final html.Blob blob = html.Blob(
      <Object>[printableHtml], 'text/html;charset=utf-8');
  return html.Url.createObjectUrlFromBlob(blob);
}

Future<bool> openCounterReceiptInReservedPopup(
    Object? reserved, String serverHtml) async {
  if (reserved is! _ReservedReceiptWindow) return false;
  try {
    final String url = createCounterReceiptBlobUrl(serverHtml);
    final dynamic popup = reserved.window;
    final Stream<html.Event> loadEvents =
        popup.onLoad as Stream<html.Event>;
    unawaited(loadEvents.first
        .timeout(const Duration(seconds: 45),
            onTimeout: () => html.Event('timeout'))
        .then<void>((_) => html.Url.revokeObjectUrl(url)));
    popup.location.href = url;
    return true;
  } catch (_) {
    return false;
  }
}

void closeCounterReceiptPopup(Object? reserved) {
  if (reserved is! _ReservedReceiptWindow) return;
  try {
    reserved.window.close();
  } catch (_) {
    // The browser may already have closed the reserved tab.
  }
}