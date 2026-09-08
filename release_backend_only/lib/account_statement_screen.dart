import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'services/receipt_download.dart';

/// A transaction supplied by an authoritative account history response.
///
/// [amount] is displayed exactly as supplied by the caller; this screen does
/// not calculate balances or infer transaction states.
class AccountStatementTransaction {
  const AccountStatementTransaction({
    required this.reference,
    required this.description,
    required this.amount,
    required this.occurredAt,
    required this.status,
    required this.direction,
  });

  final String reference;
  final String description;
  final String amount;
  final DateTime occurredAt;
  final String status;
  final StatementDirection direction;
}

enum StatementDirection { credit, debit }

enum StatementPeriod { sevenDays, thirtyDays, custom }

DateTimeRange accountStatementRange({
  required StatementPeriod period,
  required DateTime now,
  DateTimeRange? customRange,
}) {
  if (period == StatementPeriod.custom && customRange != null) {
    return DateTimeRange(
      start: DateTime(
        customRange.start.year,
        customRange.start.month,
        customRange.start.day,
      ),
      end: DateTime(
        customRange.end.year,
        customRange.end.month,
        customRange.end.day,
        23,
        59,
        59,
        999,
        999,
      ),
    );
  }

  final DateTime today = DateTime(now.year, now.month, now.day);
  final int days = period == StatementPeriod.sevenDays ? 7 : 30;
  return DateTimeRange(
    start: today.subtract(Duration(days: days - 1)),
    end: DateTime(
      today.year,
      today.month,
      today.day,
      23,
      59,
      59,
      999,
      999,
    ),
  );
}

List<AccountStatementTransaction> filterStatementTransactions({
  required List<AccountStatementTransaction> transactions,
  required DateTimeRange range,
}) {
  final List<AccountStatementTransaction> result =
      transactions.where((AccountStatementTransaction item) {
    return !item.occurredAt.isBefore(range.start) &&
        !item.occurredAt.isAfter(range.end);
  }).toList();
  result.sort(
    (AccountStatementTransaction a, AccountStatementTransaction b) =>
        b.occurredAt.compareTo(a.occurredAt),
  );
  return result;
}

/// Read-only account statement. Opening and closing balances deliberately are
/// not shown because this view has no authoritative balance inputs.
class AccountStatementScreen extends StatefulWidget {
  const AccountStatementScreen({
    super.key,
    required this.transactions,
    this.initialPeriod = StatementPeriod.thirtyDays,
  });

  final List<AccountStatementTransaction> transactions;
  final StatementPeriod initialPeriod;

  @override
  State<AccountStatementScreen> createState() => _AccountStatementScreenState();
}

class _AccountStatementScreenState extends State<AccountStatementScreen> {
  static const Color _green = Color(0xFF08783E);
  static const int _maximumRasterExportEntries = 100;
  final GlobalKey _statementKey = GlobalKey();
  late StatementPeriod _period;
  DateTimeRange? _customRange;
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    _period = widget.initialPeriod;
  }

  DateTime get _now => DateTime.now();

  DateTimeRange get _range => accountStatementRange(
        period: _period,
        now: _now,
        customRange: _customRange,
      );

  List<AccountStatementTransaction> get _transactions =>
      filterStatementTransactions(
        transactions: widget.transactions,
        range: _range,
      );

  Future<void> _pickCustomRange() async {
    final DateTimeRange? selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: _now,
      initialDateRange: _customRange ?? _range,
      helpText: 'Select statement period',
    );
    if (selected != null && mounted) {
      setState(() {
        _customRange = selected;
        _period = StatementPeriod.custom;
      });
    }
  }

  Future<void> _export() async {
    if (_exporting) return;
    if (_transactions.length > _maximumRasterExportEntries) {
      _message(
        'This statement has too many transactions for a safe image export. '
        'Choose a shorter date range.',
      );
      return;
    }
    setState(() => _exporting = true);
    try {
      await WidgetsBinding.instance.endOfFrame;
      final RenderObject? object =
          _statementKey.currentContext?.findRenderObject();
      if (object is! RenderRepaintBoundary) {
        throw StateError('Statement is not ready.');
      }
      final ui.Image image = await object.toImage(pixelRatio: 3);
      final ByteData? bytes =
          await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (bytes == null) {
        throw StateError('Statement image unavailable.');
      }
      await downloadReceiptBytes(bytes.buffer.asUint8List(),
          'servicepay-statement-${_fileDate(_range.start)}.png');
      if (mounted) {
        _message('Statement saved successfully.');
      }
    } catch (_) {
      if (mounted) {
        _message('Unable to export this statement. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _exporting = false);
      }
    }
  }

  void _message(String value) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(value)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7F6),
      appBar: AppBar(title: const Text('Account Statement'), centerTitle: true),
      body: SafeArea(
        child: Column(children: <Widget>[
          _periodSelector(),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child:
                  RepaintBoundary(key: _statementKey, child: _statementBody()),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: <Widget>[
                if (_transactions.length > _maximumRasterExportEntries)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Text(
                      'Choose a shorter range to download an image statement '
                      '(maximum 100 transactions).',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.black54, fontSize: 12),
                    ),
                  ),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _exporting ||
                            _transactions.length > _maximumRasterExportEntries
                        ? null
                        : _export,
                    icon: _exporting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.download_rounded),
                    label: Text(_exporting
                        ? 'Preparing Statement'
                        : 'Download Statement'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ]),
      ),
    );
  }

  Widget _periodSelector() => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
        child: Wrap(spacing: 8, children: <Widget>[
          ChoiceChip(
              label: const Text('Last 7 days'),
              selected: _period == StatementPeriod.sevenDays,
              onSelected: (_) =>
                  setState(() => _period = StatementPeriod.sevenDays)),
          ChoiceChip(
              label: const Text('Last 30 days'),
              selected: _period == StatementPeriod.thirtyDays,
              onSelected: (_) =>
                  setState(() => _period = StatementPeriod.thirtyDays)),
          ActionChip(
              label: Text(_period == StatementPeriod.custom
                  ? _rangeLabel
                  : 'Custom range'),
              onPressed: _pickCustomRange),
        ]),
      );

  String get _rangeLabel =>
      '${_displayDate(_range.start)} – ${_displayDate(_range.end)}';

  Widget _statementBody() {
    final List<AccountStatementTransaction> entries = _transactions;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('ServicePay',
                style: TextStyle(
                    fontSize: 22, color: _green, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text('Account statement',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(_rangeLabel, style: const TextStyle(color: Colors.black54)),
            const Divider(height: 32),
            if (entries.isEmpty)
              const Padding(
                  padding: EdgeInsets.symmetric(vertical: 28),
                  child: Center(child: Text('No transactions in this period.')))
            else
              ...entries.map(_transactionRow),
            const Divider(height: 32),
            Text(
                '${entries.length} transaction${entries.length == 1 ? '' : 's'}',
                style: const TextStyle(color: Colors.black54, fontSize: 12)),
            const SizedBox(height: 4),
            const Text(
                'This statement reflects the transactions provided for the selected period.',
                style: TextStyle(color: Colors.black54, fontSize: 11)),
          ]),
    );
  }

  Widget _transactionRow(AccountStatementTransaction item) {
    final bool credit = item.direction == StatementDirection.credit;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child:
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        Icon(credit ? Icons.south_west_rounded : Icons.north_east_rounded,
            color: credit ? _green : const Color(0xFF9A6700)),
        const SizedBox(width: 12),
        Expanded(
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
              Text(item.description,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 3),
              Text('${_displayDateTime(item.occurredAt)} • ${item.status}',
                  style: const TextStyle(fontSize: 12, color: Colors.black54)),
              const SizedBox(height: 2),
              Text('Ref: ${item.reference}',
                  style: const TextStyle(fontSize: 11, color: Colors.black54)),
            ])),
        const SizedBox(width: 8),
        Text('${credit ? '+' : '-'}₦${item.amount}',
            style: TextStyle(
                fontWeight: FontWeight.w800,
                color: credit ? _green : Colors.black87)),
      ]),
    );
  }
}

String _displayDate(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year}';
String _displayDateTime(DateTime value) =>
    '${_displayDate(value)} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
String _fileDate(DateTime value) =>
    '${value.year}${value.month.toString().padLeft(2, '0')}${value.day.toString().padLeft(2, '0')}';
