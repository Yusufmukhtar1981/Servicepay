class Organization {
  const Organization({
    required this.id,
    required this.name,
    this.description = '',
    this.logoUrl,
    this.category = '',
    this.verified = false,
    this.fee = 0,
    this.annualFee = 0,
    this.registrationFee = 0,
    this.currency = 'NGN',
    this.memberCount,
    this.joinStatus,
    this.allowedToManage = false,
    this.fields = const <OrganizationField>[],
    this.type = '',
    this.code = '',
    this.slug = '',
    this.membershipNumber = '',
    this.joinedAt,
    this.expiryDate,
    this.renewalStatus = '',
    this.verificationUrl = '',
    this.registrationDue,
  });

  final String id;
  final String name;
  final String description;
  final String? logoUrl;
  final String category;
  final bool verified;
  final num fee;
  final num annualFee;
  final num registrationFee;
  final String currency;
  final int? memberCount;
  final String? joinStatus;
  final bool allowedToManage;
  final List<OrganizationField> fields;
  final String type;
  final String code;
  final String slug;
  final String membershipNumber;
  final DateTime? joinedAt;
  final DateTime? expiryDate;
  final String renewalStatus;
  final String verificationUrl;
  final Map<String, dynamic>? registrationDue;

  factory Organization.fromJson(Map<String, dynamic> json) {
    final raw = json['membership'] ?? json['application'];
    final membership = raw is Map ? Map<String, dynamic>.from(raw) : null;
    final rawFields = json['customFields'] ?? json['fields'] ?? <dynamic>[];
    return Organization(
      id: '${json['id'] ?? json['_id'] ?? json['organizationId'] ?? ''}',
      name: '${json['name'] ?? json['title'] ?? 'Organization'}',
      description: '${json['description'] ?? json['bio'] ?? ''}',
      logoUrl: json['logo'] is Map
          ? (json['logo']['url'])?.toString()
          : (json['logoUrl'] ?? json['imageUrl'])?.toString(),
      category: '${json['category'] ?? json['type'] ?? ''}',
      verified: json['verified'] == true ||
          json['isVerified'] == true ||
          '${json['status']}'.toUpperCase() == 'VERIFIED',
      fee: _number(json['annualFee'] ??
          json['registrationFee'] ??
          json['membershipFee'] ??
          json['fee'] ??
          json['joinFee']),
      annualFee: _number(json['annualFee']),
      registrationFee: _number(json['registrationFee']),
      currency: '${json['currency'] ?? 'NGN'}',
      memberCount: _int(json['memberCount'] ?? json['membersCount']),
      joinStatus:
          (membership?['status'] ?? json['joinStatus'] ?? json['status'])
              ?.toString(),
      allowedToManage:
          json['canManage'] == true || json['allowedToManage'] == true,
      type: '${json['type'] ?? ''}',
      code: '${json['code'] ?? ''}',
      slug: '${json['slug'] ?? ''}',
      membershipNumber:
          '${membership?['membershipNumber'] ?? json['membershipNumber'] ?? ''}',
      joinedAt: DateTime.tryParse(
          '${membership?['joinedAt'] ?? json['joinedAt'] ?? ''}'),
      expiryDate: DateTime.tryParse(
          '${membership?['expiryDate'] ?? json['expiryDate'] ?? ''}'),
      renewalStatus:
          '${membership?['renewalStatus'] ?? json['renewalStatus'] ?? ''}',
      verificationUrl:
          '${membership?['verificationUrl'] ?? json['verificationUrl'] ?? ''}',
      registrationDue: membership?['registrationDue'] is Map
          ? Map<String, dynamic>.from(membership!['registrationDue'])
          : json['registrationDue'] is Map
              ? Map<String, dynamic>.from(json['registrationDue'])
              : null,
      fields: rawFields is List
          ? rawFields
              .whereType<Map>()
              .map((e) =>
                  OrganizationField.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : const <OrganizationField>[],
    );
  }

  static num _number(dynamic value) =>
      value is num ? value : num.tryParse('$value') ?? 0;
  static int? _int(dynamic value) =>
      value is num ? value.toInt() : int.tryParse('$value');
}

class OrganizationField {
  const OrganizationField({
    required this.key,
    required this.label,
    this.required = false,
    this.type = 'text',
    this.options = const <String>[],
  });
  final String key;
  final String label;
  final bool required;
  final String type;
  final List<String> options;

  factory OrganizationField.fromJson(Map<String, dynamic> json) =>
      OrganizationField(
        key: '${json['key'] ?? json['name'] ?? json['id'] ?? ''}',
        label:
            '${json['label'] ?? json['title'] ?? json['name'] ?? 'Information'}',
        required: json['required'] == true,
        type: '${json['type'] ?? 'text'}',
        options: (json['options'] is List
                ? (json['options'] as List)
                : const <dynamic>[])
            .map((e) => '$e')
            .toList(),
      );
}

class OrganizationPayment {
  const OrganizationPayment(
      {this.id = '',
      this.reference = '',
      this.amount = 0,
      this.status = '',
      this.receiptUrl});
  final String id;
  final String reference;
  final num amount;
  final String status;
  final String? receiptUrl;

  factory OrganizationPayment.fromJson(Map<String, dynamic> json) =>
      OrganizationPayment(
        id: '${json['id'] ?? json['_id'] ?? ''}',
        reference: '${json['reference'] ?? json['transactionReference'] ?? ''}',
        amount: json['amount'] is num
            ? json['amount'] as num
            : num.tryParse('${json['amount']}') ?? 0,
        status: '${json['status'] ?? json['paymentStatus'] ?? ''}',
        receiptUrl: json['receiptUrl']?.toString(),
      );
}
