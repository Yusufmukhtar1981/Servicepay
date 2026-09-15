import 'dart:convert';

class ReferralLinkBuilder {
  const ReferralLinkBuilder._();

  static String build(String code) {
    final value = code.trim();
    return 'https://servicepay.ng/register?ref=${Uri.encodeComponent(value)}';
  }
}

/// A category in the currently active referral reward policy.
///
/// The API has used both `categories` and `categoryRules` for this list.  The
/// parser normalises both forms into this small model so the customer app does
/// not need to know which backend version supplied the response.
class ReferralRewardRule {
  const ReferralRewardRule({
    required this.category,
    required this.target,
    required this.reward,
    this.minimumTransaction = 0,
  });

  final String category;
  final int target;
  final num reward;
  final num minimumTransaction;

  int get required => target;
  num get rewardAmount => reward;
}

class ReferralRewardPolicy {
  const ReferralRewardPolicy({
    required this.status,
    this.categories = const <ReferralRewardRule>[],
  });

  final String status;
  final List<ReferralRewardRule> categories;

  bool get isConfigured => status == 'CONFIGURED';
  String get rewardProgramStatus => status;
  List<ReferralRewardRule> get rules => categories;
}

class ReferralSummary {
  const ReferralSummary({
    required this.code,
    required this.total,
    required this.qualified,
    required this.pending,
    this.paid = 0,
    required this.totalRewards,
    this.rewardProgramStatus = 'NOT_CONFIGURED',
    this.rewardPolicy = const ReferralRewardPolicy(
      status: 'NOT_CONFIGURED',
    ),
    required this.referrals,
  });

  final String code;
  final int total;
  final int qualified;
  final int pending;
  final int paid;
  final num totalRewards;
  final String rewardProgramStatus;
  final ReferralRewardPolicy rewardPolicy;
  final List<ReferralEntry> referrals;

  /// The old UI and old response contract called this `referredCount`.
  int get referredCount => total;

  /// Friendlier names for callers that use the wording shown in the UI.
  int get pendingCount => pending;
  int get qualifiedCount => qualified;
  int get paidCount => paid;
  num get rewardsEarned => totalRewards;
  String get rewardPolicyStatus => rewardProgramStatus;
}

class ReferralEntry {
  const ReferralEntry({
    required this.firstName,
    required this.registrationDate,
    required this.qualificationProgress,
    required this.rewardStatus,
    this.category = '',
    this.bestCategoryProgress = '',
  });

  /// Deliberately contains only one name component.  Referral data must not
  /// expose a referred customer's surname, phone number, or email address.
  final String firstName;
  final String registrationDate;
  final String qualificationProgress;
  final String rewardStatus;
  final String category;
  final String bestCategoryProgress;

  String get bestProgress => bestCategoryProgress.isEmpty
      ? qualificationProgress
      : bestCategoryProgress;
  String get categoryProgress => bestProgress;
  String get bestCategory => category;
}

/// Parses both the configured reward-policy response and the older
/// `referredCount` response shape returned by the referral endpoint.
ReferralSummary parseReferralResponse(dynamic decoded) {
  final root =
      decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
  final source = <String, dynamic>{...root};
  if (root['data'] is Map) {
    source.addAll(Map<String, dynamic>.from(root['data'] as Map));
  }
  if (source['summary'] is Map) {
    final nestedSummary = Map<String, dynamic>.from(source['summary'] as Map);
    for (final entry in nestedSummary.entries) {
      source.putIfAbsent(entry.key, () => entry.value);
    }
  }
  final rawItems = source['referrals'] is List
      ? source['referrals'] as List
      : source['referredUsers'] is List
          ? source['referredUsers'] as List
          : const <dynamic>[];

  final items = rawItems
      .whereType<Map>()
      .map((item) => _parseEntry(Map<String, dynamic>.from(item)))
      .toList();

  final totalRaw = _firstPresent(source, <String>[
    'total',
    'totalReferrals',
    'referredCount',
  ]);
  final total = _nonNegativeInt(totalRaw ?? items.length);

  final qualifiedRaw = _firstPresent(source, <String>[
    'qualified',
    'qualifiedCount',
    'qualifiedReferrals',
    'successfulCount',
  ]);
  final paidRaw = _firstPresent(source, <String>[
    'paid',
    'paidCount',
    'paidReferrals',
    'rewardsPaid',
    'totalPaid',
  ]);
  final qualified = _nonNegativeInt(
    qualifiedRaw ?? _countEntries(items, const <String>{'QUALIFIED', 'PAID'}),
  );
  final paid =
      _nonNegativeInt(paidRaw ?? _countEntries(items, const <String>{'PAID'}));

  final pendingRaw = _firstPresent(source, <String>[
    'pending',
    'pendingCount',
    'pendingReferrals',
  ]);
  final pending = _nonNegativeInt(
    pendingRaw ?? (total - qualified),
  );

  final policy = _parsePolicy(source);
  final status = _policyStatus(source, policy);

  return ReferralSummary(
    code: _stringValue(
      _firstPresent(source, <String>['referralCode', 'code']),
    ),
    total: total,
    qualified: qualified,
    pending: pending,
    paid: paid,
    totalRewards: _numValue(
      _firstPresent(source, <String>[
        'totalRewards',
        'totalReferralRewards',
        'rewardsEarned',
        'rewards',
        'totalReward',
      ]),
    ),
    rewardProgramStatus: status,
    rewardPolicy: ReferralRewardPolicy(
      status: status,
      categories: policy.categories,
    ),
    referrals: items,
  );
}

ReferralEntry _parseEntry(Map<String, dynamic> item) {
  final explicitFirstName = _stringValue(item['firstName']);
  final fullName = _stringValue(item['fullName']);
  final firstName = _firstNameOnly(
    explicitFirstName.isNotEmpty ? explicitFirstName : fullName,
  );

  final progress = _bestProgress(item);
  final explicitCategory = _stringValue(
    item['category'] ?? item['rewardCategory'] ?? item['serviceCategory'],
  );
  final category = _prettyCategory(
    explicitCategory.isNotEmpty ? explicitCategory : progress.category,
  );
  final progressText = progress.text.isNotEmpty
      ? progress.text
      : _displayValue(
          item['qualificationProgress'] ??
              item['progress'] ??
              item['qualification'] ??
              item['qualificationStatus'],
          fallback: 'Not qualified',
        );
  final reward = item['rewardStatus'] ?? item['status'] ?? 'Pending';
  final date = item['registrationDate'] ??
      item['registeredAt'] ??
      item['joinedAt'] ??
      item['createdAt'];

  return ReferralEntry(
    firstName: firstName.isEmpty ? 'ServicePay User' : firstName,
    registrationDate: _dateValue(date),
    qualificationProgress: progressText,
    bestCategoryProgress: progressText,
    category: category,
    rewardStatus: _displayValue(reward),
  );
}

class _ProgressValue {
  const _ProgressValue(this.category, this.text, this.score);

  final String category;
  final String text;
  final double score;
}

_ProgressValue _bestProgress(Map<String, dynamic> item) {
  final candidates = <dynamic>[
    item['bestCategoryProgress'],
    item['bestProgress'],
    item['qualificationProgress'],
    item['progress'],
    item['qualification'],
  ];
  final parsed = candidates
      .expand(_progressValues)
      .where((value) => value.text.isNotEmpty)
      .toList();
  if (parsed.isEmpty) return const _ProgressValue('', '', -1);
  parsed.sort((a, b) => b.score.compareTo(a.score));
  return parsed.first;
}

Iterable<_ProgressValue> _progressValues(dynamic raw) sync* {
  if (raw is List) {
    for (final value in raw) {
      yield* _progressValues(value);
    }
    return;
  }
  if (raw is! Map) {
    final text = _stringValue(raw);
    if (text.isNotEmpty) {
      yield _ProgressValue('', text, _numericScore(raw));
    }
    return;
  }

  final map = Map<String, dynamic>.from(raw);
  final category = _stringValue(
    map['category'] ?? map['name'] ?? map['type'] ?? map['key'],
  );
  final current = _firstPresent(map, <String>[
    'current',
    'completed',
    'achieved',
    'completedCount',
    'currentCount',
    'count',
    'progress',
    'value',
  ]);
  final target = _firstPresent(map, <String>[
    'target',
    'required',
    'goal',
    'threshold',
    'requiredCount',
    'qualificationTarget',
    'total',
    'limit',
  ]);
  final currentNumber = _numberOrNull(current);
  final targetNumber = _numberOrNull(target);
  if (currentNumber != null && targetNumber != null && targetNumber > 0) {
    final pretty = _prettyCategory(category);
    yield _ProgressValue(
      category,
      '${pretty.isEmpty ? 'Progress' : pretty} '
      '${_numberText(currentNumber)}/${_numberText(targetNumber)}',
      currentNumber / targetNumber,
    );
    return;
  }

  final label = _stringValue(map['label'] ?? map['status'] ?? map['value']);
  if (label.isNotEmpty && map.length <= 3) {
    yield _ProgressValue(category, label, _numericScore(current));
  }

  // Some responses use {DATA: {completed: 7, target: 10}}.
  for (final entry in map.entries) {
    if (entry.value is Map) {
      final nested = Map<String, dynamic>.from(entry.value as Map);
      if (!nested.containsKey('category')) {
        nested['category'] = entry.key;
      }
      yield* _progressValues(nested);
    }
  }
}

ReferralRewardPolicy _parsePolicy(Map<String, dynamic> source) {
  final raw = source['rewardPolicy'] ??
      source['referralRewardPolicy'] ??
      source['policy'];
  if (raw is! Map) {
    return const ReferralRewardPolicy(status: 'NOT_CONFIGURED');
  }
  final policy = Map<String, dynamic>.from(raw);
  final rawRules = policy['categories'] ??
      policy['categoryRules'] ??
      policy['rules'] ??
      policy['requirements'] ??
      policy['rewards'] ??
      policy['qualificationCategories'];
  final defaultTarget = policy['target'] ??
      policy['required'] ??
      policy['qualificationTarget'] ??
      policy['threshold'] ??
      10;
  final defaultReward = policy['reward'] ??
      policy['amount'] ??
      policy['rewardAmount'] ??
      policy['amountNaira'] ??
      2000;
  final defaultMinimum = policy['minimumTransaction'] ??
      policy['minimumTransactionAmount'] ??
      policy['minTransaction'] ??
      0;
  final rules = <ReferralRewardRule>[];
  if (rawRules is List) {
    for (final value in rawRules) {
      if (value is Map) {
        final ruleValue = Map<String, dynamic>.from(value);
        if (!_containsAnyKey(ruleValue, const <String>[
          'target',
          'required',
          'goal',
          'threshold',
          'requiredCount',
          'qualificationTarget',
          'count',
        ])) {
          ruleValue['target'] = defaultTarget;
        }
        if (!_containsAnyKey(ruleValue, const <String>[
          'reward',
          'amount',
          'rewardAmount',
          'amountNaira',
        ])) {
          ruleValue['reward'] = defaultReward;
        }
        if (!_containsAnyKey(ruleValue, const <String>[
          'minimumTransaction',
          'minimumTransactionAmount',
          'minTransaction',
          'minimumAmount',
        ])) {
          ruleValue['minimumTransaction'] = defaultMinimum;
        }
        final rule = _parseRule(ruleValue);
        if (rule != null) rules.add(rule);
      } else if (value is String) {
        final rule = _parseRule(<String, dynamic>{
          'category': value,
          'target': defaultTarget,
          'reward': defaultReward,
          'minimumTransaction': defaultMinimum,
        });
        if (rule != null) rules.add(rule);
      }
    }
  } else if (rawRules is Map) {
    for (final entry in rawRules.entries) {
      if (entry.value is Map) {
        final value = Map<String, dynamic>.from(entry.value as Map);
        value.putIfAbsent('category', () => entry.key);
        value.putIfAbsent('target', () => defaultTarget);
        value.putIfAbsent('reward', () => defaultReward);
        value.putIfAbsent('minimumTransaction', () => defaultMinimum);
        final rule = _parseRule(value);
        if (rule != null) rules.add(rule);
      }
    }
  }
  return ReferralRewardPolicy(
    status: _normaliseStatus(
      policy['status'] ??
          policy['rewardProgramStatus'] ??
          (policy['configured'] == true ? 'CONFIGURED' : null),
      fallback: 'NOT_CONFIGURED',
    ),
    categories: rules,
  );
}

bool _containsAnyKey(Map<String, dynamic> value, List<String> keys) {
  return keys.any(value.containsKey);
}

ReferralRewardRule? _parseRule(Map<String, dynamic> value) {
  final category = _prettyCategory(
    _stringValue(value['category'] ?? value['name'] ?? value['type']),
  );
  final target = _nonNegativeInt(
    value['target'] ??
        value['required'] ??
        value['goal'] ??
        value['threshold'] ??
        value['requiredCount'] ??
        value['qualificationTarget'] ??
        value['count'],
  );
  final reward = _numValue(
    value['reward'] ??
        value['amount'] ??
        value['rewardAmount'] ??
        value['amountNaira'],
  );
  final minimumTransaction = _numValue(
    value['minimumTransaction'] ??
        value['minimumTransactionAmount'] ??
        value['minTransaction'] ??
        value['minimumAmount'],
  );
  if (category.isEmpty && target == 0 && reward == 0) return null;
  return ReferralRewardRule(
    category: category.isEmpty ? 'Referral' : category,
    target: target,
    reward: reward,
    minimumTransaction: minimumTransaction,
  );
}

String _policyStatus(
  Map<String, dynamic> source,
  ReferralRewardPolicy policy,
) {
  final explicit = _firstPresent(source, <String>[
    'rewardProgramStatus',
    'rewardPolicyStatus',
    'policyStatus',
  ]);
  if (explicit != null && _stringValue(explicit).isNotEmpty) {
    return _normaliseStatus(explicit, fallback: 'NOT_CONFIGURED');
  }
  return policy.status;
}

String _displayValue(dynamic value, {String fallback = 'Pending'}) {
  if (value is Map) {
    final map = Map<String, dynamic>.from(value);
    final label = map['label'] ?? map['status'] ?? map['value'];
    if (label != null && _stringValue(label).isNotEmpty) {
      return _stringValue(label);
    }
  }
  final text = _stringValue(value);
  return text.isEmpty ? fallback : text;
}

String _dateValue(dynamic raw) {
  final value = _stringValue(raw);
  if (value.isEmpty) return 'Registration date unavailable';
  try {
    final date = DateTime.parse(value).toLocal();
    return '${date.day.toString().padLeft(2, '0')}/'
        '${date.month.toString().padLeft(2, '0')}/${date.year}';
  } catch (_) {
    return value;
  }
}

String _firstNameOnly(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return '';
  return trimmed.split(RegExp(r'\s+')).first;
}

String _prettyCategory(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return '';
  return trimmed
      .replaceAll(RegExp(r'[_-]+'), ' ')
      .split(RegExp(r'\s+'))
      .map(
        (part) => part.isEmpty
            ? part
            : '${part[0].toUpperCase()}${part.substring(1).toLowerCase()}',
      )
      .join(' ');
}

dynamic _firstPresent(Map<String, dynamic> map, List<String> keys) {
  for (final key in keys) {
    if (map.containsKey(key) && map[key] != null) return map[key];
  }
  return null;
}

int _countEntries(List<ReferralEntry> entries, Set<String> statuses) {
  return entries
      .where((entry) => statuses.contains(entry.rewardStatus.toUpperCase()))
      .length;
}

String _normaliseStatus(dynamic value, {required String fallback}) {
  final text = _stringValue(value);
  return text.isEmpty ? fallback : text.toUpperCase();
}

String _stringValue(dynamic value) => value?.toString().trim() ?? '';

num _numValue(dynamic value) {
  if (value is num) return value;
  return num.tryParse(_stringValue(value)) ?? 0;
}

num? _numberOrNull(dynamic value) {
  if (value is num) return value;
  return num.tryParse(_stringValue(value));
}

double _numericScore(dynamic value) {
  final number = _numberOrNull(value);
  return number?.toDouble() ?? -1;
}

String _numberText(num value) {
  return value % 1 == 0 ? value.toInt().toString() : value.toString();
}

int _nonNegativeInt(dynamic value) {
  final number = _numValue(value).toInt();
  return number < 0 ? 0 : number;
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
