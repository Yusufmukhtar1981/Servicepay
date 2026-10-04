/// Normalize supported Nigerian local/international mobile formats without
/// accepting arbitrary letters or silently removing unexpected characters.
String normalizeDataPhone(String input) {
  var phone = input.trim().replaceAll(RegExp(r'[\s()-]'), '');
  if (phone.startsWith('+234')) {
    phone = '0${phone.substring(4)}';
  } else if (phone.startsWith('234') && phone.length == 13) {
    phone = '0${phone.substring(3)}';
  }
  return phone;
}
