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

class TrustDeal {
  const TrustDeal({
    required this.id,
    required this.title,
    required this.amount,
    required this.status,
    required this.buyerName,
    required this.sellerName,
    this.description,
    this.currency = 'NGN',
    this.createdAt,
    this.updatedAt,
    this.buyerId,
    this.sellerId,
    this.counterpartyId,
    this.counterpartyName,
    this.participantRole,
    this.fundingReference,
    this.receiptUrl,
    this.dispute,
  });

  final String id;
  final String title;
  final String? description;
  final double amount;
  final String currency;
  final String status;
  final String buyerName;
  final String sellerName;
  final String? buyerId;
  final String? sellerId;
  final String? counterpartyId;
  final String? counterpartyName;
  final String? participantRole;
  final String? fundingReference;
  final String? receiptUrl;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final TrustDispute? dispute;

  bool get isBuyer => participantRole?.toLowerCase() == 'buyer';
  bool get isSeller => participantRole?.toLowerCase() == 'seller';
  bool get canFund =>
      <String>['created', 'pending_funding'].contains(status.toLowerCase()) &&
      !isSeller;
  bool get canSellerStart => isSeller && status.toLowerCase() == 'funded';
  bool get canSellerMarkDelivered =>
      isSeller && status.toLowerCase() == 'in_progress';
  bool get canBuyerRelease => isBuyer && status.toLowerCase() == 'delivered';
  bool get canRaiseDispute => <String>['funded', 'in_progress', 'delivered']
      .contains(status.toLowerCase());

  factory TrustDeal.fromJson(Map<String, dynamic> json) {
    String text(String key) => json[key]?.toString().trim() ?? '';
    double number(String key) =>
        (json[key] is num ? json[key] as num : num.tryParse(text(key)) ?? 0)
            .toDouble();
    DateTime? date(String key) => DateTime.tryParse(text(key));
    final dynamic dispute = json['dispute'];
    return TrustDeal(
      id: text('id').isEmpty
          ? (text('_id').isEmpty ? text('dealId') : text('_id'))
          : text('id'),
      title: text('title').isEmpty ? 'Protected deal' : text('title'),
      description: text('description').isEmpty ? null : text('description'),
      amount: number('amount'),
      currency: text('currency').isEmpty ? 'NGN' : text('currency'),
      status: text('status').isEmpty ? 'pending_funding' : text('status'),
      buyerName: _partyName(json, 'buyer', 'buyerName', 'Buyer'),
      sellerName: _partyName(json, 'seller', 'sellerName', 'Seller'),
      buyerId: _partyId(json, 'buyer', 'buyerId'),
      sellerId: _partyId(json, 'seller', 'sellerId'),
      counterpartyId:
          text('counterpartyId').isEmpty ? null : text('counterpartyId'),
      counterpartyName:
          text('counterpartyName').isEmpty ? null : text('counterpartyName'),
      participantRole: text('participantRole').isEmpty
          ? (text('role').isEmpty ? null : text('role'))
          : text('participantRole'),
      fundingReference:
          text('fundingReference').isEmpty ? null : text('fundingReference'),
      receiptUrl: text('receiptUrl').isEmpty ? null : text('receiptUrl'),
      createdAt: date('createdAt'),
      updatedAt: date('updatedAt'),
      dispute: dispute is Map
          ? TrustDispute.fromJson(Map<String, dynamic>.from(dispute))
          : null,
    );
  }

  static String _partyName(Map<String, dynamic> json, String partyKey,
      String nameKey, String fallback) {
    final dynamic party = json[partyKey];
    if (party is Map) {
      final String name =
          (party['displayName'] ?? party['name'] ?? party['businessName'] ?? '')
              .toString()
              .trim();
      if (name.isNotEmpty) return name;
    }
    final String name = json[nameKey]?.toString().trim() ?? '';
    return name.isEmpty ? fallback : name;
  }

  static String? _partyId(
      Map<String, dynamic> json, String partyKey, String idKey) {
    final dynamic party = json[partyKey];
    final String value = party is Map
        ? (party['_id'] ?? party['id'] ?? party['servicePayId'] ?? '')
            .toString()
        : json[idKey]?.toString() ?? (party?.toString() ?? '');
    return value.trim().isEmpty ? null : value.trim();
  }
}

class TrustDispute {
  const TrustDispute({
    required this.id,
    required this.status,
    required this.reason,
    this.details,
    this.createdAt,
    this.resolution,
    this.dealId,
    this.evidenceReferences = const <String>[],
    this.resolutionNote,
  });
  final String id;
  final String status;
  final String reason;
  final String? details;
  final DateTime? createdAt;
  final String? resolution;
  final String? dealId;
  final List<String> evidenceReferences;
  final String? resolutionNote;
  bool get isOpen => status.toLowerCase() == 'open';

  factory TrustDispute.fromJson(Map<String, dynamic> json) => TrustDispute(
        id: json['id']?.toString() ??
            json['_id']?.toString() ??
            json['disputeId']?.toString() ??
            '',
        status: json['status']?.toString() ?? 'open',
        reason: json['reason']?.toString() ?? 'Other',
        details: json['details']?.toString(),
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
        resolution: json['resolution']?.toString(),
        evidenceReferences: json['evidenceReferences'] is List
            ? (json['evidenceReferences'] as List)
                .map((dynamic value) => value.toString())
                .where((String value) => value.trim().isNotEmpty)
                .toList()
            : const <String>[],
        resolutionNote: json['resolutionNote']?.toString(),
        dealId: json['dealId']?.toString() ??
            (json['deal'] is Map
                ? (json['deal']['_id'] ?? json['deal']['id'])?.toString()
                : json['deal']?.toString()),
      );
}
