import 'dart:convert';

class ReferralLinkBuilder {
  const ReferralLinkBuilder._();

  static String build(String code) {
    final value = code.trim();
    return 'https://servicepay.ng/register?ref=${Uri.encodeComponent(value)}';
  }
}

class ReferralSummary {
  const ReferralSummary({
    required this.code,
    required this.total,
    required this.qualified,
    required this.pending,
    required this.totalRewards,
    this.rewardProgramStatus = 'NOT_CONFIGURED',
    required this.referrals,
  });

  final String code;
  final int total;
  final int qualified;
  final int pending;
  final num totalRewards;
  final String rewardProgramStatus;
  final List<ReferralEntry> referrals;

  int get referredCount => total;
}

class ReferralEntry {
  const ReferralEntry({
    required this.firstName,
    required this.registrationDate,
    required this.qualificationProgress,
    required this.rewardStatus,
  });

  final String firstName;
  final String registrationDate;
  final String qualificationProgress;
  final String rewardStatus;
}

/// Parses both the current summary response and the older referredCount
/// response shape returned by the referral endpoint.
ReferralSummary parseReferralResponse(dynamic decoded) {
  final root =
      decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
  final source = root['data'] is Map
      ? Map<String, dynamic>.from(root['data'] as Map)
      : root;
  final rawItems = source['referrals'] is List
      ? source['referrals'] as List
      : const <dynamic>[];

  final items = rawItems
      .whereType<Map>()
      .map((item) => _parseEntry(Map<String, dynamic>.from(item)))
      .toList();

  final total = _intValue(
    source['total'] ??
        source['totalReferrals'] ??
        source['referredCount'] ??
        items.length,
  );
  final qualified = _intValue(
    source['qualified'] ??
        source['qualifiedCount'] ??
        source['qualifiedReferrals'] ??
        source['successfulCount'],
  );
  final pending = _intValue(
    source['pending'] ??
        source['pendingCount'] ??
        source['pendingReferrals'] ??
        (total - qualified),
  );

  return ReferralSummary(
    code: source['referralCode']?.toString().trim() ??
        source['code']?.toString().trim() ??
        '',
    total: total,
    qualified: qualified,
    pending: pending < 0 ? 0 : pending,
    totalRewards: _numValue(
      source['totalRewards'] ??
          source['totalReferralRewards'] ??
          source['rewards'] ??
          source['totalReward'],
    ),
    rewardProgramStatus:
        source['rewardProgramStatus']?.toString().trim().toUpperCase() ??
            'NOT_CONFIGURED',
    referrals: items,
  );
}

ReferralEntry _parseEntry(Map<String, dynamic> item) {
  final explicitFirstName = item['firstName']?.toString().trim() ?? '';
  final fullName = item['fullName']?.toString().trim() ?? '';
  final firstName = explicitFirstName.isNotEmpty
      ? explicitFirstName
      : (fullName.isEmpty
          ? 'ServicePay User'
          : fullName.split(RegExp(r'\s+')).first);
  final progress = item['qualificationProgress'] ??
      item['progress'] ??
      item['qualification'] ??
      item['qualificationStatus'] ??
      'Not qualified';
  final reward = item['rewardStatus'] ?? item['status'] ?? 'Pending';
  final date = item['registrationDate'] ??
      item['registeredAt'] ??
      item['joinedAt'] ??
      item['createdAt'];

  return ReferralEntry(
    firstName: firstName,
    registrationDate: _dateValue(date),
    qualificationProgress: _displayValue(progress),
    rewardStatus: _displayValue(reward),
  );
}

String _displayValue(dynamic value) {
  if (value is Map) {
    return value['label']?.toString() ??
        value['status']?.toString() ??
        value['value']?.toString() ??
        'Pending';
  }
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? 'Pending' : text;
}

String _dateValue(dynamic raw) {
  final value = raw?.toString().trim() ?? '';
  if (value.isEmpty) return 'Registration date unavailable';
  try {
    final date = DateTime.parse(value).toLocal();
    return '${date.day.toString().padLeft(2, '0')}/'
        '${date.month.toString().padLeft(2, '0')}/${date.year}';
  } catch (_) {
    return value;
  }
}

int _intValue(dynamic value) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

num _numValue(dynamic value) {
  if (value is num) return value;
  return num.tryParse(value?.toString() ?? '') ?? 0;
}

Map<String, dynamic> decodeReferralJson(String body) {
  try {
    final decoded = jsonDecode(body);
    return decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
  } catch (_) {
    return <String, dynamic>{};
  }
}
