class TrustProfile {
  const TrustProfile({
    required this.servicePayId,
    required this.displayName,
    this.businessName,
    this.profilePhotoUrl,
    this.maskedPhone,
    this.identityVerified = false,
    this.businessVerified = false,
    this.accountOwnershipVerified = false,
    this.memberSince,
    this.protectedTransactionsCount = 0,
    this.protectedTradeVolume = 0,
    this.completionRate = 0,
    this.disputesCount = 0,
    this.resolvedDisputesCount = 0,
    this.trustScore = 0,
    this.trustLevel = 'New',
    this.restricted = false,
    this.discoverable = true,
    this.lastCalculatedAt,
    this.scoreInputs = const <String, dynamic>{},
    this.restrictionReason,
    this.accountStatus,
  });

  final String servicePayId;
  final String displayName;
  final String? businessName;
  final String? profilePhotoUrl;
  final String? maskedPhone;
  final bool identityVerified;
  final bool businessVerified;
  final bool accountOwnershipVerified;
  final DateTime? memberSince;
  final int protectedTransactionsCount;
  final double protectedTradeVolume;
  final double completionRate;
  final int disputesCount;
  final int resolvedDisputesCount;
  final double trustScore;
  final String trustLevel;
  final bool restricted;
  final bool discoverable;
  final DateTime? lastCalculatedAt;
  final Map<String, dynamic> scoreInputs;
  final String? restrictionReason;
  final String? accountStatus;

  factory TrustProfile.fromJson(Map<String, dynamic> json) {
    String text(String key) => json[key]?.toString().trim() ?? '';
    bool boolValue(String key) {
      final dynamic value = json[key];
      return value == true ||
          value?.toString().toLowerCase() == 'true' ||
          value?.toString() == '1';
    }

    double number(String key) =>
        (json[key] is num ? json[key] as num : num.tryParse(text(key)) ?? 0)
            .toDouble();
    DateTime? date(String key) => DateTime.tryParse(text(key));
    Map<String, dynamic> mapValue(String key) {
      final dynamic value = json[key];
      return value is Map ? Map<String, dynamic>.from(value) : const {};
    }

    return TrustProfile(
      servicePayId: text('servicePayId'),
      displayName: text('displayName').isEmpty
          ? 'ServicePay Member'
          : text('displayName'),
      businessName: text('businessName').isEmpty ? null : text('businessName'),
      profilePhotoUrl:
          text('profilePhotoUrl').isEmpty ? null : text('profilePhotoUrl'),
      maskedPhone: text('maskedPhone').isEmpty ? null : text('maskedPhone'),
      identityVerified: boolValue('identityVerified'),
      businessVerified: boolValue('businessVerified'),
      accountOwnershipVerified: boolValue('accountOwnershipVerified'),
      memberSince: date('memberSince'),
      protectedTransactionsCount: number('protectedTransactionsCount').toInt(),
      protectedTradeVolume: number('protectedTradeVolume'),
      completionRate: number('completionRate'),
      disputesCount: number('disputesCount').toInt(),
      resolvedDisputesCount: number('resolvedDisputesCount').toInt(),
      trustScore: number('trustScore'),
      trustLevel: text('trustLevel').isEmpty ? 'New' : text('trustLevel'),
      restricted: boolValue('restricted'),
      discoverable:
          !json.containsKey('discoverable') || boolValue('discoverable'),
      lastCalculatedAt: date('lastCalculatedAt'),
      scoreInputs: mapValue('scoreInputs'),
      restrictionReason:
          text('restrictionReason').isEmpty ? null : text('restrictionReason'),
      accountStatus:
          text('accountStatus').isEmpty ? null : text('accountStatus'),
    );
  }
}
