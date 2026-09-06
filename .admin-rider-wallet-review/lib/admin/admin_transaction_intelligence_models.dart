class TransactionFilters {
  const TransactionFilters({
    this.search = '',
    this.serviceType = '',
    this.internalStatus = '',
    this.providerStatus = '',
    this.reconciliationStatus = '',
    this.minAmount = '',
    this.maxAmount = '',
    this.from = '',
    this.to = '',
  });
  final String search,
      serviceType,
      internalStatus,
      providerStatus,
      reconciliationStatus,
      minAmount,
      maxAmount,
      from,
      to;
  Map<String, String> get query => <String, String>{
    if (search.trim().isNotEmpty) 'search': search.trim(),
    if (serviceType.isNotEmpty) 'serviceType': serviceType,
    if (internalStatus.isNotEmpty) 'internalStatus': internalStatus,
    if (providerStatus.isNotEmpty) 'providerStatus': providerStatus,
    if (reconciliationStatus.isNotEmpty)
      'reconciliationStatus': reconciliationStatus,
    if (minAmount.isNotEmpty) 'minAmount': minAmount,
    if (maxAmount.isNotEmpty) 'maxAmount': maxAmount,
    if (from.isNotEmpty) 'from': from,
    if (to.isNotEmpty) 'to': to,
  };
}

class IntelligenceCapabilities {
  const IntelligenceCapabilities({
    this.canRequery = false,
    this.canExport = false,
    this.canViewProviderHealth = false,
  });
  final bool canRequery, canExport, canViewProviderHealth;
  factory IntelligenceCapabilities.fromJson(Map<String, dynamic>? json) =>
      IntelligenceCapabilities(
        canRequery: json?['canRequery'] == true,
        canExport: json?['canExport'] == true,
        canViewProviderHealth: json?['canViewProviderHealth'] == true,
      );
}

class IntelligenceTransaction {
  const IntelligenceTransaction({
    required this.id,
    required this.reference,
    required this.amount,
    required this.createdAt,
    required this.internalStatus,
    required this.providerStatus,
    required this.reconciliationStatus,
    this.provider,
    this.customer,
    this.providerReference,
    this.signals = const <dynamic>[],
    this.safeAction = 'REVIEW_ONLY',
  });
  final String id,
      reference,
      internalStatus,
      providerStatus,
      reconciliationStatus,
      safeAction;
  final num amount;
  final String? provider, providerReference;
  final Map<String, dynamic>? customer;
  final String createdAt;
  final List<dynamic> signals;
  factory IntelligenceTransaction.fromJson(Map<String, dynamic> j) =>
      IntelligenceTransaction(
        id: '${j['id'] ?? ''}',
        reference: '${j['reference'] ?? 'Unreferenced'}',
        amount: j['amount'] as num? ?? 0,
        createdAt: '${j['createdAt'] ?? ''}',
        internalStatus: '${j['internalStatus'] ?? 'UNKNOWN'}',
        providerStatus: '${j['providerStatus'] ?? 'UNKNOWN'}',
        reconciliationStatus: '${j['reconciliationStatus'] ?? 'NEEDS_REVIEW'}',
        provider: j['provider']?.toString(),
        providerReference: j['providerReference']?.toString(),
        customer: j['customer'] is Map
            ? Map<String, dynamic>.from(j['customer'] as Map)
            : null,
        signals: j['signals'] as List? ?? const <dynamic>[],
        safeAction: '${j['safeAction'] ?? 'REVIEW_ONLY'}',
      );
}

class TransactionSearchResult {
  const TransactionSearchResult(
    this.transactions,
    this.capabilities,
    this.total,
  );
  final List<IntelligenceTransaction> transactions;
  final IntelligenceCapabilities capabilities;
  final int? total;
  factory TransactionSearchResult.fromJson(Map<String, dynamic> j) =>
      TransactionSearchResult(
        _transactions(j),
        IntelligenceCapabilities.fromJson(
          j['capabilities'] as Map<String, dynamic>?,
        ),
        (j['pagination'] as Map?)?['total'] as int?,
      );
}

class ReconciliationQueue {
  const ReconciliationQueue(this.transactions, this.nextCursor, this.hasMore);
  final List<IntelligenceTransaction> transactions;
  final String? nextCursor;
  final bool hasMore;
  factory ReconciliationQueue.fromJson(Map<String, dynamic> j) {
    final Map p = j['pagination'] as Map? ?? <String, dynamic>{};
    return ReconciliationQueue(
      _transactions(j),
      p['nextCursor']?.toString(),
      p['hasMore'] == true,
    );
  }
}

List<IntelligenceTransaction> _transactions(Map<String, dynamic> j) =>
    (j['transactions'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map(
          (Map row) =>
              IntelligenceTransaction.fromJson(Map<String, dynamic>.from(row)),
        )
        .toList();

class TransactionIntelligenceSummary {
  const TransactionIntelligenceSummary(
    this.metrics,
    this.previous,
    this.capabilities,
  );
  final Map<String, dynamic> metrics, previous;
  final IntelligenceCapabilities capabilities;
  factory TransactionIntelligenceSummary.fromJson(Map<String, dynamic> j) =>
      TransactionIntelligenceSummary(
        Map<String, dynamic>.from(j['metrics'] as Map? ?? {}),
        Map<String, dynamic>.from(j['previousDay'] as Map? ?? {}),
        IntelligenceCapabilities.fromJson(
          j['capabilities'] as Map<String, dynamic>?,
        ),
      );
}

class ProviderHealth {
  const ProviderHealth(
    this.provider,
    this.successRate,
    this.sampleSize,
    this.failureRate,
  );
  final String provider;
  final num? successRate, failureRate;
  final int sampleSize;
  factory ProviderHealth.fromJson(Map<String, dynamic> j) => ProviderHealth(
    '${j['provider'] ?? 'Unknown'}',
    j['successRate'] as num?,
    j['sampleSize'] as int? ?? 0,
    j['failureRate'] as num?,
  );
}

class TransactionAlert {
  const TransactionAlert(this.title, this.detail);
  final String title, detail;
  factory TransactionAlert.fromJson(Map<String, dynamic> j) => TransactionAlert(
    '${j['reference'] ?? j['title'] ?? 'Review required'}',
    '${j['reconciliationStatus'] ?? j['message'] ?? 'Transaction needs investigation'}',
  );
}

class TransactionDetail {
  const TransactionDetail(this.transaction, this.capabilities);
  final Map<String, dynamic> transaction;
  final IntelligenceCapabilities capabilities;
  factory TransactionDetail.fromJson(Map<String, dynamic> j) =>
      TransactionDetail(
        Map<String, dynamic>.from(j['transaction'] as Map? ?? {}),
        IntelligenceCapabilities.fromJson(
          j['capabilities'] as Map<String, dynamic>?,
        ),
      );
}

class TimelineEvent {
  const TimelineEvent(this.type, this.label, this.at);
  final String type, label, at;
  factory TimelineEvent.fromJson(Map<String, dynamic> j) => TimelineEvent(
    '${j['type'] ?? 'EVENT'}',
    '${j['label'] ?? 'Recorded'}',
    '${j['at'] ?? ''}',
  );
}
