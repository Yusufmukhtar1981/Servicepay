/// Presentation-only interpretation of the authoritative v2 referral programme.
///
/// This intentionally does not use ReferralProgramme, whose legacy-compatible
/// defaults are useful elsewhere but must never be advertised as policy.
class ReferralPresentationPolicy {
  const ReferralPresentationPolicy({
    required this.registrationBonus,
    required this.transactionCommission,
    required this.activatedAt,
  });

  final num registrationBonus;
  final num transactionCommission;
  final DateTime activatedAt;

  static ReferralPresentationPolicy? parse(
    dynamic response, {
    DateTime? now,
  }) {
    if (response is! Map) return null;
    Map<String, dynamic> root = Map<String, dynamic>.from(response);
    final dynamic nested = root['data'];
    if (nested is Map) root = <String, dynamic>{...root, ...nested};
    final dynamic rawProgramme = root['programme'];
    if (rawProgramme is! Map) return null;
    final Map<String, dynamic> programme =
        Map<String, dynamic>.from(rawProgramme);

    final int? version = _integer(programme['version']);
    if (version == null || version < 2 || programme['enabled'] != true) {
      return null;
    }
    final String activationValue = programme['activatedAt'] is String
        ? (programme['activatedAt'] as String).trim()
        : '';
    final DateTime? activatedAt = DateTime.tryParse(activationValue);
    if (activatedAt == null ||
        activatedAt.isAfter(now ?? DateTime.now())) {
      return null;
    }
    final num? registrationBonus =
        _finiteNonNegative(programme['registrationBonus']);
    final num? transactionCommission =
        _finiteNonNegative(programme['transactionCommission']);
    if (registrationBonus == null || transactionCommission == null) {
      return null;
    }
    return ReferralPresentationPolicy(
      registrationBonus: registrationBonus,
      transactionCommission: transactionCommission,
      activatedAt: activatedAt,
    );
  }

  static int? _integer(dynamic value) {
    final num? parsed = _number(value);
    if (parsed == null ||
        !parsed.isFinite ||
        parsed < 0 ||
        parsed % 1 != 0) {
      return null;
    }
    return parsed.toInt();
  }

  static num? _finiteNonNegative(dynamic value) {
    final num? parsed = _number(value);
    return parsed != null && parsed.isFinite && parsed >= 0 ? parsed : null;
  }

  static num? _number(dynamic value) {
    if (value is num) return value;
    if (value is String && value.trim().isNotEmpty) {
      return num.tryParse(value.trim());
    }
    return null;
  }

  String get message =>
      'Get ${money(registrationBonus)} for each successful referral and '
      '${money(transactionCommission)} per eligible transaction.';

  static String money(num amount) {
    final String value = amount % 1 == 0
        ? amount.toInt().toString()
        : amount.toString();
    final bool negative = value.startsWith('-');
    final String unsigned = negative ? value.substring(1) : value;
    final List<String> parts = unsigned.split('.');
    final StringBuffer grouped = StringBuffer();
    for (int i = 0; i < parts.first.length; i++) {
      if (i > 0 && (parts.first.length - i) % 3 == 0) grouped.write(',');
      grouped.write(parts.first[i]);
    }
    return '₦${negative ? '-' : ''}${grouped.toString()}'
        '${parts.length > 1 ? '.${parts[1]}' : ''}';
  }
}
