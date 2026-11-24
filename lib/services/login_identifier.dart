/// Returns one canonical login identifier, without changing saved account data.
String? normalizePasswordLoginIdentifier(String value) {
  final input = value.trim();
  if (input.isEmpty || input.length > 254) return null;
  if (input.contains('@')) {
    return RegExp(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
            .hasMatch(input)
        ? input.toLowerCase()
        : null;
  }
  if (!RegExp(r'^\+?[\d ()-]+$').hasMatch(input)) return null;
  var phone = input.replaceAll(RegExp(r'[ ()-]'), '');
  if (phone.startsWith('+234')) phone = phone.substring(1);
  if (RegExp(r'^234[789]\d{9}$').hasMatch(phone)) {
    phone = '0${phone.substring(3)}';
  }
  return RegExp(r'^0[789]\d{9}$').hasMatch(phone) ? phone : null;
}
