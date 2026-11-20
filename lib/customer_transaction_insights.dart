import 'transaction_presentation.dart';

enum CustomerInsightsPeriod { weekly, monthly }

/// Display-only windows. Neither this projection nor its client can settle,
/// requery, debit or otherwise change a transaction.
class InsightsWindow {
  InsightsWindow._(this.period, this.start, this.end, this.previousStart,
      this.previousEnd, this.previousCapped);

  factory InsightsWindow.at(CustomerInsightsPeriod period, DateTime now) {
    DateTime date(int y, int m, int d) =>
        now.isUtc ? DateTime.utc(y, m, d) : DateTime(y, m, d);
    final start = period == CustomerInsightsPeriod.weekly
        ? date(now.year, now.month, now.day - now.weekday + 1)
        : date(now.year, now.month, 1);
    final previousStart = period == CustomerInsightsPeriod.weekly
        ? date(start.year, start.month, start.day - 7)
        : date(start.year, start.month - 1, 1);
    final equivalentEnd = previousStart.add(now.difference(start));
    final capped = equivalentEnd.isAfter(start);
    return InsightsWindow._(period, start, now, previousStart,
        capped ? start : equivalentEnd, capped);
  }

  final CustomerInsightsPeriod period;
  final DateTime start, end, previousStart, previousEnd;
  final bool previousCapped;
  bool current(DateTime at) => !at.isBefore(start) && at.isBefore(end);
  bool previous(DateTime at) =>
      !at.isBefore(previousStart) && at.isBefore(previousEnd);
}

class InsightTransaction {
  InsightTransaction(Map<String, dynamic> row)
      : id = TransactionPresentation(row).id,
        reference = TransactionPresentation(row).reference,
        type = TransactionPresentation(row).title,
        status = TransactionPresentation(row).status,
        date = TransactionPresentation(row).date ??
            (throw const FormatException(
                'A history record has no valid date.')),
        amount = _amount(row),
        declineReason = _reason(row);

  final String id, reference, type, status, declineReason;
  final DateTime date;
  final double amount;
  bool get successful => status == 'SUCCESSFUL';
  bool get declined => status == 'FAILED';
  bool get pending => status == 'PENDING' || status == 'PROCESSING';

  static double _amount(Map<String, dynamic> row) {
    final number = double.tryParse(
        (row['amount'] ?? row['totalAmount'] ?? row['value']).toString());
    if (number == null || !number.isFinite) {
      throw const FormatException('A history record has no valid amount.');
    }
    return number.abs();
  }

  static String _reason(Map<String, dynamic> row) {
    // Only translate recognized codes. Never display raw provider responses,
    // arbitrary error strings, URLs, credentials or stack traces.
    const reasons = {
      'INSUFFICIENT_FUNDS': 'Insufficient available funds.',
      'INSUFFICIENT_BALANCE': 'Insufficient available funds.',
      'INVALID_RECIPIENT': 'The recipient details could not be accepted.',
      'INVALID_PHONE': 'The phone number could not be accepted.',
      'INVALID_AMOUNT': 'The amount could not be accepted.',
      'SERVICE_UNAVAILABLE': 'The requested service was unavailable.',
      'CUSTOMER_CANCELLED': 'The transaction was cancelled.',
    };
    final metadata = row['metadata'];
    final provider = metadata is Map ? metadata['providerResponse'] : null;
    for (final candidate in [row, if (provider is Map) provider]) {
      for (final key in [
        'customerReasonCode',
        'failureCode',
        'errorCode',
        'code'
      ]) {
        final safe = reasons[candidate[key]?.toString().trim().toUpperCase()];
        if (safe != null) return safe;
      }
    }
    return 'No customer-safe decline reason was supplied. Contact Support with the transaction reference.';
  }
}

double _sum(Iterable<double> values) {
  // Compensated summation avoids accumulating binary rounding error. These
  // values are for display only, never for wallet or settlement calculations.
  double sum = 0, correction = 0;
  for (final value in values) {
    final adjusted = value - correction;
    final next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  if (!sum.isFinite) {
    throw const FormatException('Transaction values exceed display limits.');
  }
  return sum;
}

class InsightTotals {
  InsightTotals(Iterable<InsightTransaction> entries) {
    final rows = entries.toList();
    totalCount = rows.length;
    successfulCount = rows.where((e) => e.successful).length;
    declinedCount = rows.where((e) => e.declined).length;
    pendingCount = rows.where((e) => e.pending).length;
    otherCount = totalCount - successfulCount - declinedCount - pendingCount;
    totalValue = _sum(rows.map((e) => e.amount));
    successfulValue =
        _sum(rows.where((e) => e.successful).map((e) => e.amount));
    declinedValue = _sum(rows.where((e) => e.declined).map((e) => e.amount));
  }
  late final int totalCount,
      successfulCount,
      declinedCount,
      pendingCount,
      otherCount;
  late final double totalValue, successfulValue, declinedValue;
}

class InsightBucket {
  const InsightBucket(this.date, this.totals);
  final DateTime date;
  final InsightTotals totals;
}

class InsightGrowth {
  const InsightGrowth(this.current, this.previous);
  final double current, previous;

  /// No invented 100% growth when the denominator is zero.
  double? get percent =>
      previous == 0 ? null : (current - previous) / previous * 100;
}

class CustomerTransactionInsights {
  CustomerTransactionInsights._(
      this.window, this.current, this.previous, this.buckets, this.declined);

  factory CustomerTransactionInsights.fromRows(
      List<Map<String, dynamic>> rows, InsightsWindow window) {
    // The server already merges financial sources. Also collapse overlapping
    // pages and canonical/ledger aliases across pages, preferring canonical
    // Transaction records over posted debit ledger statuses.
    final canonicalIds = <String>{};
    final knownReferences = <String>{};
    final unique = <String, InsightTransaction>{};
    // Mirror history's source precedence across page boundaries, including its
    // explicit exception for genuine legacy reversal ledger entries.
    const sources = [
      'TRANSACTION',
      'LEDGER',
      'TRANSFER',
      'MANUAL_FUNDING',
      'WITHDRAWAL',
      'BANK_TRANSFER',
      'FEATURE_PAYMENT'
    ];
    final ordered = [
      for (final source in sources)
        ...rows.where((r) => r['source']?.toString().toUpperCase() == source),
      ...rows.where(
          (r) => !sources.contains(r['source']?.toString().toUpperCase())),
    ];
    for (final row in ordered) {
      final entry = InsightTransaction(row);
      if (entry.id.isEmpty) {
        throw const FormatException('A history record has no stable identity.');
      }
      if (unique.containsKey(entry.id)) continue;
      final source = row['source']?.toString().toUpperCase();
      final primary = source == 'TRANSACTION';
      final metadata = row['metadata'];
      final legacyReversal = source == 'LEDGER' &&
          ((row['reversalOf']?.toString().isNotEmpty ?? false) ||
              (row['type']?.toString().endsWith('_REVERSAL') ?? false)) &&
          !(metadata is Map && metadata['manualRefund'] == true);
      final alias = canonicalIds.contains(row['transactionId']?.toString()) ||
          (entry.reference.isNotEmpty &&
              knownReferences.contains(entry.reference));
      if (!primary && alias && !legacyReversal) continue;
      unique[entry.id] = entry;
      if (entry.reference.isNotEmpty) knownReferences.add(entry.reference);
      if (primary) {
        final id = (row['transactionId'] ?? row['sourceId'] ?? '').toString();
        if (id.isNotEmpty) canonicalIds.add(id);
      }
    }
    final current = unique.values.where((e) => window.current(e.date)).toList();
    final previous = unique.values.where((e) => window.previous(e.date));
    DateTime day(DateTime at) => window.start.isUtc
        ? DateTime.utc(at.toUtc().year, at.toUtc().month, at.toUtc().day)
        : DateTime(at.toLocal().year, at.toLocal().month, at.toLocal().day);
    final grouped = <DateTime, List<InsightTransaction>>{};
    for (final entry in current) {
      (grouped[day(entry.date)] ??= []).add(entry);
    }
    final buckets = <InsightBucket>[];
    for (var at = window.start;
        !at.isAfter(day(window.end));
        at = at.isUtc
            ? DateTime.utc(at.year, at.month, at.day + 1)
            : DateTime(at.year, at.month, at.day + 1)) {
      buckets.add(InsightBucket(at, InsightTotals(grouped[at] ?? [])));
    }
    final declined = current.where((e) => e.declined).toList()
      ..sort((a, b) => b.date.compareTo(a.date));
    return CustomerTransactionInsights._(
        window,
        InsightTotals(current),
        InsightTotals(previous),
        List.unmodifiable(buckets),
        List.unmodifiable(declined));
  }

  final InsightsWindow window;
  final InsightTotals current, previous;
  final List<InsightBucket> buckets;
  final List<InsightTransaction> declined;
  InsightGrowth get countGrowth => InsightGrowth(
      current.totalCount.toDouble(), previous.totalCount.toDouble());
  InsightGrowth get valueGrowth =>
      InsightGrowth(current.totalValue, previous.totalValue);
  InsightGrowth get successfulGrowth => InsightGrowth(
      current.successfulCount.toDouble(), previous.successfulCount.toDouble());
  InsightGrowth get declinedGrowth => InsightGrowth(
      current.declinedCount.toDouble(), previous.declinedCount.toDouble());
}
