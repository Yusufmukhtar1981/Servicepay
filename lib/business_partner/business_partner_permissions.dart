/// Returns whether a permission was granted in the authenticated partner
/// profile. Missing permissions are deliberately treated as denied.
bool businessPartnerHasPermission(
  Map<String, dynamic> profile,
  String permission,
) {
  final dynamic raw = profile['permissions'];
  if (raw is! List) return false;
  final String expected = permission.trim().toUpperCase();
  return raw.any(
      (dynamic value) => value?.toString().trim().toUpperCase() == expected);
}
