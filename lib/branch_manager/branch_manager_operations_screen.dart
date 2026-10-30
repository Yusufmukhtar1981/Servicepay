import '../services/session_store.dart';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../admin/admin_control_center_download.dart';
import 'counter_receipt_platform.dart';

enum BranchOperationsView {
  customers,
  transactions,
  riders,
  officers,
  kyc,
  solar,
  phone,
  marketplace,
  approvals,
  reports,
  targets,
}

class BranchManagerOperationsScreen extends StatefulWidget {
  const BranchManagerOperationsScreen(
      {super.key,
      required this.view,
      this.httpClient,
      this.permissions = const <String>[]});
  final BranchOperationsView view;
  final http.Client? httpClient;
  final List<String> permissions;

  @override
  State<BranchManagerOperationsScreen> createState() =>
      _BranchManagerOperationsScreenState();
}

class _BranchManagerOperationsScreenState
    extends State<BranchManagerOperationsScreen> {
  final TextEditingController _search = TextEditingController();
  List<Map<String, dynamic>> _rows = <Map<String, dynamic>>[];
  Map<String, dynamic> _reportMetrics = <String, dynamic>{};
  DateTimeRange? _reportRange;
  String _reportModule = 'ALL';
  String _reportStatus = 'ALL';
  String? _error;
  bool _loading = true;
  late final http.Client _client = widget.httpClient ?? http.Client();

  String get _title => switch (widget.view) {
        BranchOperationsView.customers => 'Branch customers',
        BranchOperationsView.transactions => 'Branch transactions',
        BranchOperationsView.riders => 'Branch riders',
        BranchOperationsView.officers => 'Branch officers',
        BranchOperationsView.kyc => 'Branch KYC',
        BranchOperationsView.solar => 'Solar applications',
        BranchOperationsView.phone => 'Phone Financing applications',
        BranchOperationsView.marketplace => 'Marketplace orders',
        BranchOperationsView.approvals => 'Branch approvals',
        BranchOperationsView.reports => 'Branch reports',
        BranchOperationsView.targets => 'Branch targets',
      };
  String get _path => switch (widget.view) {
        BranchOperationsView.customers => '/customers',
        BranchOperationsView.transactions => '/transactions',
        BranchOperationsView.riders => '/riders',
        BranchOperationsView.officers => '/officers',
        BranchOperationsView.kyc => '/kyc',
        BranchOperationsView.solar => '/solar/applications',
        BranchOperationsView.phone => '/phone/applications',
        BranchOperationsView.marketplace => '/marketplace/orders',
        BranchOperationsView.approvals => '/approvals',
        BranchOperationsView.reports => '/reports',
        BranchOperationsView.targets => '/targets',
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool get _canViewReportFinance =>
      widget.permissions.contains('*') ||
      widget.permissions.contains('branch.finance.view');

  String _date(DateTime date) => '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  Map<String, String> _reportQuery({String? export}) => <String, String>{
        if (_reportRange != null) 'startDate': _date(_reportRange!.start),
        if (_reportRange != null) 'endDate': _date(_reportRange!.end),
        if (_reportModule != 'ALL') 'module': _reportModule,
        if (_reportStatus != 'ALL') 'status': _reportStatus,
        if (_search.text.trim().isNotEmpty) 'staffId': _search.text.trim(),
        if (export != null) 'export': export,
      };

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = ((await SessionStore.readToken()) ??
              (await SessionStore.readToken()) ??
              (await SessionStore.readToken()) ??
              '')
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
      if (token.isEmpty) {
        throw Exception('Your session has expired. Please sign in again.');
      }
      final Map<String, String> query =
          widget.view == BranchOperationsView.reports
              ? _reportQuery()
              : <String, String>{
                  'limit': '100',
                  if (_search.text.trim().isNotEmpty)
                    'search': _search.text.trim(),
                };
      final http.Response response = await _client.get(
        Uri.parse('https://api.servicepay.ng/api/branches$_path')
            .replace(queryParameters: query),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token'
        },
      );
      final dynamic decoded =
          response.body.isEmpty ? null : jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(decoded is Map
            ? decoded['message'] ?? 'Unable to load $_title.'
            : 'Unable to load $_title.');
      }
      final Map<String, dynamic> data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
      if (widget.view == BranchOperationsView.reports &&
          data['metrics'] is Map) {
        _reportMetrics = Map<String, dynamic>.from(data['metrics'] as Map);
      } else if (widget.view == BranchOperationsView.reports) {
        _reportMetrics = <String, dynamic>{};
      }
      final dynamic source = switch (widget.view) {
        BranchOperationsView.customers => data['customers'],
        BranchOperationsView.transactions => data['transactions'],
        BranchOperationsView.riders => data['riders'],
        BranchOperationsView.officers => data['officers'],
        BranchOperationsView.kyc => data['applications'],
        BranchOperationsView.solar => data['applications'],
        BranchOperationsView.phone => data['applications'],
        BranchOperationsView.marketplace => data['orders'],
        BranchOperationsView.approvals => data['requests'],
        BranchOperationsView.reports => data['transactions'],
        BranchOperationsView.targets => data['targets'],
      };
      final List<Map<String, dynamic>> rows = source is List
          ? source
              .whereType<Map>()
              .map((Map value) => Map<String, dynamic>.from(value))
              .toList()
          : source is Map
              ? source.entries
                  .map((entry) => <String, dynamic>{
                        'label': entry.key,
                        'value': entry.value
                      })
                  .toList()
              : <Map<String, dynamic>>[];
      if (mounted) {
        setState(() {
          _rows = rows;
          if (widget.view != BranchOperationsView.reports) {
            _reportMetrics = <String, dynamic>{};
          }
        });
      }
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _pickReportRange() async {
    final DateTime now = DateTime.now();
    final DateTimeRange? picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year + 1),
      initialDateRange: _reportRange,
    );
    if (picked != null && mounted) setState(() => _reportRange = picked);
  }

  Future<void> _exportCsv() async {
    if (!controlCenterDownloadSupported || _loading) return;
    try {
      final String token = ((await SessionStore.readToken()) ?? '')
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
      if (token.isEmpty) {
        throw Exception('Your session has expired. Please sign in again.');
      }
      final http.Response response = await _client.get(
        Uri.parse('https://api.servicepay.ng/api/branches/reports').replace(
          queryParameters: _reportQuery(export: 'csv'),
        ),
        headers: <String, String>{
          'Accept': 'text/csv',
          'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        dynamic decoded;
        try {
          decoded = jsonDecode(response.body);
        } catch (_) {}
        throw Exception(decoded is Map
            ? decoded['message'] ?? 'Unable to export the branch report.'
            : 'Unable to export the branch report.');
      }
      if (!(response.headers['content-type'] ?? '').contains('csv')) {
        throw Exception('The report export returned an unexpected format.');
      }
      final String rangeTag = _reportRange == null
          ? 'all-dates'
          : '${_date(_reportRange!.start)}-${_date(_reportRange!.end)}';
      await downloadControlCenterCsv(
        response.body,
        'branch-report-$rangeTag.csv',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Branch report CSV downloaded.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$error'.replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  Future<void> _printReport() async {
    final Object? popup = reserveCounterReceiptPopup();
    if (popup == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Report print preview is available in a web browser.'),
        ),
      );
      return;
    }
    final bool opened =
        await openCounterReceiptInReservedPopup(popup, _reportHtml());
    if (!opened) {
      closeCounterReceiptPopup(popup);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Unable to open the report print view.')),
        );
      }
    }
  }

  String _reportHtml() {
    final Map<String, dynamic> delivery =
        _map(_map(_reportMetrics['deliveries'])['operations']);
    final Map<String, dynamic> financial = _map(delivery['financial']);
    final List<String> financialRows = <String>[
      _htmlTableRow(
          'Gross order value', _reportMoney(financial['grossOrderValue'])),
      _htmlTableRow('Recorded paid delivery fees',
          _reportMoney(financial['recordedPaidValue'])),
      _htmlTableRow(
          'Unpaid delivery fees', _reportMoney(financial['unpaidValue'])),
      _htmlTableRow(
          'Recorded refunds', _reportMoney(financial['refundedValue'])),
      _htmlTableRow('Recorded rider commissions',
          _reportMoney(financial['recordedRiderCommissions'])),
      _htmlTableRow('Operational expenses',
          _reportMoney(financial['operationalExpenses'])),
      _htmlTableRow(
          'Reconciled profit', _reportMoney(financial['reconciledProfit'])),
      _htmlTableRow('Estimated net earnings',
          _reportMoney(financial['estimatedNetEarnings'])),
    ];
    final Map<String, dynamic> rawStatuses = _map(delivery['rawStatuses']);
    final List<String> operationsRows = <String>[
      _htmlTableRow('Total orders', _reportCount(delivery['total'])),
      _htmlTableRow('Today', _reportCount(delivery['today'])),
      _htmlTableRow('Pending', _reportCount(delivery['pending'])),
      _htmlTableRow('Assigned', _reportCount(delivery['assigned'])),
      _htmlTableRow('In transit', _reportCount(delivery['inTransit'])),
      _htmlTableRow('Delivered', _reportCount(delivery['delivered'])),
      _htmlTableRow('Cancelled', _reportCount(delivery['cancelled'])),
      _htmlTableRow('Failed', _reportCount(delivery['failed'])),
      _htmlTableRow('Unclassified', _reportCount(delivery['unclassified'])),
      _htmlTableRow('Active riders', _reportCount(delivery['activeRiders'])),
      _htmlTableRow('Delivered performance',
          _reportPercent(delivery['deliveredPercent'])),
      _htmlTableRow('Local orders', _reportCount(delivery['localOrders'])),
      _htmlTableRow(
          'Interstate orders', _reportCount(delivery['interstateOrders'])),
      ...rawStatuses.entries.map((MapEntry<String, dynamic> entry) =>
          _htmlTableRow('Observed status · ${entry.key}', '${entry.value}')),
    ];
    final String reportRows = _rows.map((Map<String, dynamic> row) {
      final String reference = _text(row, <String>['reference'], '');
      final String masked =
          reference.length > 4 ? '${reference.substring(0, 4)}•••' : reference;
      return '<tr><td>${_html(masked)}</td>'
          '<td>${_html(_text(row, <String>['serviceType']))}</td>'
          '<td>${_html(_reportMoney(row['amount']))}</td>'
          '<td>${_html(_text(row, <String>['status']))}</td>'
          '<td>${_html(_text(row, <String>['createdAt']))}</td></tr>';
    }).join();
    final String financialBlock = _canViewReportFinance && financial.isNotEmpty
        ? '<h2>Recorded delivery fees</h2><table>${financialRows.join()}</table>'
        : '';
    final String operationsBlock = delivery.isNotEmpty
        ? '<h2>Delivery workload and performance</h2>'
            '<table>${operationsRows.join()}</table>'
        : '';
    final bool hasLegacyActivity = _reportMetrics.containsKey('revenue') ||
        _reportMetrics['revenueBasis'] != null;
    final String legacyNotice = !hasLegacyActivity
        ? ''
        : '<p class="note">Legacy activity value omitted: '
            'non-additive operational activity, not revenue or earnings.</p>';
    return '<!doctype html><html><head><meta charset="utf-8">'
        '<title>Branch report</title><style>'
        'body{font:14px system-ui,sans-serif;color:#17332c;margin:28px}'
        'h1{font-size:22px}table{border-collapse:collapse;width:100%;margin:12px 0}'
        'td,th{border:1px solid #d8e2dc;padding:7px;text-align:left}'
        '.note{color:#586a60;font-size:12px}'
        '@media print{button{display:none}}'
        '</style></head><body><h1>Branch report</h1>'
        '<p>Filters: ${_html(_reportFilterDescription())}</p>'
        '$legacyNotice$operationsBlock$financialBlock'
        '<h2>Transactions (${_rows.length})</h2>'
        '<table><thead><tr><th>Reference</th><th>Service</th><th>Amount</th>'
        '<th>Status</th><th>Date</th></tr></thead><tbody>'
        '$reportRows</tbody></table></body></html>';
  }

  String _htmlTableRow(String label, String value) =>
      '<tr><th>${_html(label)}</th><td>${_html(value)}</td></tr>';

  String _html(String value) => value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  String _reportMoney(dynamic value) {
    if (value == null) return 'Unavailable';
    final num? amount = value is num ? value : num.tryParse('$value');
    if (amount == null) return 'Unavailable';
    final String raw = amount == amount.roundToDouble()
        ? amount.toInt().toString()
        : amount.toStringAsFixed(2);
    final List<String> parts = raw.split('.');
    final String grouped = parts.first.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (Match match) => ',',
    );
    return '₦$grouped${parts.length > 1 ? '.${parts.last}' : ''}';
  }

  String _reportFilterDescription() {
    final String description = <String>[
      if (_reportRange != null)
        '${_date(_reportRange!.start)} to ${_date(_reportRange!.end)}',
      if (_reportModule != 'ALL') 'Module: $_reportModule',
      if (_reportStatus != 'ALL') 'Status: $_reportStatus',
      if (_search.text.trim().isNotEmpty) 'Staff: ${_search.text.trim()}',
    ].join(' · ');
    return description.isEmpty
        ? 'All available dates and modules'
        : description;
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  Future<void> _resetReportFilters() async {
    setState(() {
      _reportRange = null;
      _reportModule = 'ALL';
      _reportStatus = 'ALL';
      _search.clear();
    });
    await _load();
  }

  Widget _reportFilters() => Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: <Widget>[
                    OutlinedButton.icon(
                      key: const Key('branch-report-date-range'),
                      onPressed: _pickReportRange,
                      icon: const Icon(Icons.calendar_today_outlined),
                      label: Text(_reportRange == null
                          ? 'All dates'
                          : '${_date(_reportRange!.start)} – ${_date(_reportRange!.end)}'),
                    ),
                    SizedBox(
                      width: 142,
                      child: DropdownButtonFormField<String>(
                        key: const Key('branch-report-module'),
                        isExpanded: true,
                        value: _reportModule,
                        decoration: const InputDecoration(labelText: 'Module'),
                        items: const <String>[
                          'ALL',
                          'DELIVERY',
                          'MARKETPLACE',
                          'SOLAR',
                          'PHONE_FINANCING',
                        ]
                            .map((String value) => DropdownMenuItem<String>(
                                  value: value,
                                  child: Text(value.replaceAll('_', ' '),
                                      maxLines: 1, overflow: TextOverflow.ellipsis),
                                ))
                            .toList(),
                        onChanged: (String? value) {
                          if (value != null) {
                            setState(() => _reportModule = value);
                          }
                        },
                      ),
                    ),
                    SizedBox(
                      width: 142,
                      child: DropdownButtonFormField<String>(
                        key: const Key('branch-report-status'),
                        isExpanded: true,
                        value: _reportStatus,
                        decoration: const InputDecoration(labelText: 'Status'),
                        items: const <String>[
                          'ALL',
                          'SUCCESSFUL',
                          'PENDING',
                          'FAILED',
                        ]
                            .map((String value) => DropdownMenuItem<String>(
                                  value: value,
                                  child: Text(value,
                                      maxLines: 1, overflow: TextOverflow.ellipsis),
                                ))
                            .toList(),
                        onChanged: (String? value) {
                          if (value != null) {
                            setState(() => _reportStatus = value);
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('branch-report-staff-id'),
                  controller: _search,
                  decoration: const InputDecoration(
                    labelText: 'Staff ID (optional)',
                    prefixIcon: Icon(Icons.badge_outlined),
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 8,
                  children: <Widget>[
                    TextButton(
                      key: const Key('branch-report-reset'),
                      onPressed: _loading ? null : _resetReportFilters,
                      child: const Text('Reset'),
                    ),
                    FilledButton.icon(
                      key: const Key('branch-report-apply'),
                      onPressed: _loading ? null : _load,
                      icon: const Icon(Icons.filter_alt_outlined),
                      label: const Text('Apply filters'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );

  Widget _reportSummary() {
    final Map<String, dynamic> operations =
        _map(_map(_reportMetrics['deliveries'])['operations']);
    final Map<String, dynamic> financial = _map(operations['financial']);
    final bool hasLegacyActivity = _reportMetrics.containsKey('revenue') ||
        _reportMetrics['revenueBasis'] != null;
    if (operations.isEmpty && !hasLegacyActivity) {
      return const SizedBox.shrink();
    }
    final List<Widget> rows = <Widget>[];
    if (operations.isNotEmpty) {
      rows.addAll(<Widget>[
        _reportMetricRow('Delivery orders', _reportCount(operations['total'])),
        _reportMetricRow('Today', _reportCount(operations['today'])),
        _reportMetricRow('Delivered', _reportCount(operations['delivered'])),
        _reportMetricRow('Pending', _reportCount(operations['pending'])),
        _reportMetricRow('Assigned', _reportCount(operations['assigned'])),
        _reportMetricRow('In transit', _reportCount(operations['inTransit'])),
        _reportMetricRow('Cancelled', _reportCount(operations['cancelled'])),
        _reportMetricRow('Failed', _reportCount(operations['failed'])),
        _reportMetricRow(
            'Unclassified', _reportCount(operations['unclassified'])),
        _reportMetricRow(
            'Active riders', _reportCount(operations['activeRiders'])),
        _reportMetricRow(
            'Delivered rate', _reportPercent(operations['deliveredPercent'])),
        _reportMetricRow(
            'Local orders', _reportCount(operations['localOrders'])),
        _reportMetricRow(
            'Interstate orders', _reportCount(operations['interstateOrders'])),
      ]);
    }
    if (_canViewReportFinance && financial.isNotEmpty) {
      rows.addAll(<Widget>[
        const Divider(),
        _reportMetricRow(
            'Gross order value', _reportMoney(financial['grossOrderValue'])),
        _reportMetricRow('Recorded paid delivery fees',
            _reportMoney(financial['recordedPaidValue'])),
        _reportMetricRow(
            'Unpaid delivery fees', _reportMoney(financial['unpaidValue'])),
        _reportMetricRow(
            'Recorded refunds', _reportMoney(financial['refundedValue'])),
        _reportMetricRow('Recorded rider commissions',
            _reportMoney(financial['recordedRiderCommissions'])),
        _reportMetricRow('Operational expenses',
            _reportMoney(financial['operationalExpenses'])),
        _reportMetricRow(
            'Reconciled profit', _reportMoney(financial['reconciledProfit'])),
        _reportMetricRow('Estimated net earnings',
            _reportMoney(financial['estimatedNetEarnings'])),
      ]);
      rows.add(
        const Padding(
          padding: EdgeInsets.only(top: 6),
          child: Text(
            'Recorded paid delivery fees are not reconciled revenue or profit. '
            'Interstate fees are attributed to the origin branch; expenses and '
            'net figures are unavailable.',
            style: TextStyle(fontSize: 11, color: Colors.black54),
          ),
        ),
      );
      final List<String> limitations = financial['limitations'] is List
          ? (financial['limitations'] as List)
              .map((dynamic value) => '$value')
              .toList()
          : <String>[];
      final String basis = _text(financial, <String>['basis'], '');
      final String attribution = _text(financial, <String>['attribution'], '');
      if (basis.isNotEmpty ||
          attribution.isNotEmpty ||
          limitations.isNotEmpty) {
        rows.add(
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              <String>[
                if (basis.isNotEmpty) basis,
                if (attribution.isNotEmpty) attribution,
                ...limitations,
              ].join(' '),
              style: const TextStyle(fontSize: 11, color: Colors.black54),
            ),
          ),
        );
      }
    }
    if (hasLegacyActivity) {
      rows.add(
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            'Legacy activity value omitted: the previous combined figure is '
            'non-additive operational activity, not revenue or earnings.',
            style: TextStyle(fontSize: 11, color: Colors.black54),
          ),
        ),
      );
    }
    return Card(
      key: const Key('branch-report-delivery-summary'),
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text(
              'Delivery report summary',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            const SizedBox(height: 8),
            ...rows,
          ],
        ),
      ),
    );
  }

  Widget _reportMetricRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(label, style: const TextStyle(fontSize: 12)),
            ),
            const SizedBox(width: 8),
            Text(value,
                textAlign: TextAlign.right,
                style:
                    const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          ],
        ),
      );

  String _reportCount(dynamic value) => value == null ? '—' : '$value';

  String _reportPercent(dynamic value) =>
      value is num ? '${value.toStringAsFixed(1)}%' : '—';

  String _text(Map<String, dynamic> row, List<String> keys,
      [String fallback = '—']) {
    for (final String key in keys) {
      final String value = '${row[key] ?? ''}'.trim();
      if (value.isNotEmpty) return value;
    }
    return fallback;
  }

  String _assignee(Map<String, dynamic> row) {
    dynamic value = row['assignedOfficer'] ?? row['assignedSupportOfficer'];
    if (value is Map) {
      return _text(Map<String, dynamic>.from(value), <String>['fullName'], '');
    }
    value = row['activeAssignment'];
    if (value is Map && value['officer'] is Map) {
      final dynamic user = value['officer']['user'];
      if (user is Map) {
        return _text(Map<String, dynamic>.from(user), <String>['fullName'], '');
      }
    }
    return '';
  }

  Future<void> _customerProfile(Map<String, dynamic> row) async {
    final String id = _text(row, <String>['_id', 'id'], '');
    if (id.isEmpty) return;
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = ((await SessionStore.readToken()) ??
              (await SessionStore.readToken()) ??
              '')
          .trim();
      final http.Response response = await _client.get(
        Uri.parse(widget.view == BranchOperationsView.riders
            ? 'https://api.servicepay.ng/api/branches/riders/${Uri.encodeComponent(id)}'
            : 'https://api.servicepay.ng/api/branches/customers/${Uri.encodeComponent(id)}'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token'
        },
      );
      final dynamic decoded = jsonDecode(response.body);
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          decoded is! Map) {
        throw Exception(decoded is Map
            ? decoded['message'] ?? 'Unable to load customer profile.'
            : 'Unable to load customer profile.');
      }
      if (!mounted) return;
      final Map<String, dynamic> data = Map<String, dynamic>.from(decoded);
      final Map<String, dynamic> customer = Map<String, dynamic>.from((data[
          widget.view == BranchOperationsView.riders
              ? 'rider'
              : 'customer']) as Map);
      final List<dynamic> activity =
          data['activity'] is List ? data['activity'] as List : <dynamic>[];
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => SafeArea(
            child:
                ListView(padding: const EdgeInsets.all(20), children: <Widget>[
          Text(_text(customer, <String>['fullName']),
              style:
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('${_text(customer, <String>[
                'phone'
              ])} • ${_text(customer, <String>['status'])}'),
          Text('KYC: ${_text(customer, <String>['kycLevel'])}'),
          const Divider(height: 30),
          const Text('Recent branch activity',
              style: TextStyle(fontWeight: FontWeight.bold)),
          if (activity.isEmpty)
            const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text('No recent activity.')),
          ...activity.whereType<Map>().map((Map item) {
            final Map<String, dynamic> transaction =
                Map<String, dynamic>.from(item);
            return ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                  _text(transaction, <String>['serviceType', 'reference'])),
              subtitle: Text(_text(transaction, <String>['status'])),
              trailing: Text(_text(transaction, <String>['amount'], '')),
            );
          }),
        ])),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(error.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  ({String jobType, String path})? _assignmentFor(Map<String, dynamic> row) {
    bool allowed(String permission) =>
        widget.permissions.contains('*') ||
        (widget.permissions.contains(permission) &&
            widget.permissions.contains('branch.staff.manage'));
    final bool authorized = switch (widget.view) {
      BranchOperationsView.kyc => allowed('branch.kyc.manage'),
      BranchOperationsView.solar => allowed('branch.solar.manage'),
      BranchOperationsView.phone => allowed('branch.phone.manage'),
      BranchOperationsView.marketplace => allowed('branch.marketplace.manage'),
      _ => false,
    };
    if (!authorized) return null;
    final String id = _text(row, <String>['_id', 'id'], '');
    if (id.isEmpty) return null;
    return switch (widget.view) {
      BranchOperationsView.kyc => (
          jobType: 'KYC_OFFICER',
          path: '/kyc/$id/assign'
        ),
      BranchOperationsView.solar => (
          jobType: 'SOLAR_OFFICER',
          path: '/solar/applications/$id/assign'
        ),
      BranchOperationsView.phone => (
          jobType: 'PHONE_FINANCING_OFFICER',
          path: '/phone/applications/$id/assign'
        ),
      BranchOperationsView.marketplace => (
          jobType: 'MARKETPLACE_OFFICER|SUPPORT_OFFICER',
          path: '/marketplace/orders/$id/assign'
        ),
      _ => null,
    };
  }

  Future<void> _assignOfficer(Map<String, dynamic> row) async {
    final config = _assignmentFor(row);
    if (config == null) return;
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = ((await SessionStore.readToken()) ??
              (await SessionStore.readToken()) ??
              '')
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
      final http.Response listResponse = await _client.get(
        Uri.parse('https://api.servicepay.ng/api/branches/officers'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token'
        },
      );
      final dynamic decoded = jsonDecode(listResponse.body);
      if (listResponse.statusCode < 200 ||
          listResponse.statusCode >= 300 ||
          decoded is! Map) {
        throw Exception(decoded is Map
            ? decoded['message'] ?? 'Unable to load eligible officers.'
            : 'Unable to load eligible officers.');
      }
      final Set<String> types = config.jobType.split('|').toSet();
      final List<Map<String, dynamic>> officers =
          ((decoded['officers'] as List?) ?? <dynamic>[])
              .whereType<Map>()
              .map((Map value) => Map<String, dynamic>.from(value))
              .where((Map<String, dynamic> officer) =>
                  officer['status'] == 'ACTIVE' &&
                  types.contains(officer['jobTitle']))
              .toList();
      if (!mounted) return;
      final Map<String, dynamic>? selected =
          await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (BuildContext context) => SimpleDialog(
          title: Text(_text(row,
                      <String>['assignedOfficer', 'assignedSupportOfficer'], '')
                  .isEmpty
              ? 'Assign officer'
              : 'Reassign officer'),
          children: officers.isEmpty
              ? const <Widget>[
                  Padding(
                      padding: EdgeInsets.all(20),
                      child: Text('No eligible active officers.'))
                ]
              : officers
                  .map((Map<String, dynamic> officer) => SimpleDialogOption(
                        onPressed: () => Navigator.pop(context, officer),
                        child: ListTile(
                          title: Text(_text(officer, <String>['fullName'])),
                          subtitle: Text(_text(officer, <String>['jobTitle'])),
                          trailing: Text(
                              '${(officer['workload'] as Map?)?['total'] ?? 0} active'),
                        ),
                      ))
                  .toList(),
        ),
      );
      if (selected == null) return;
      final http.Response response = await _client.post(
        Uri.parse('https://api.servicepay.ng/api/branches${config.path}'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token'
        },
        body: jsonEncode(<String, dynamic>{
          'officerId': _text(selected, <String>['_id', 'id'], '')
        }),
      );
      final dynamic result =
          response.body.isEmpty ? null : jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(result is Map
            ? result['message'] ?? 'Unable to assign officer.'
            : 'Unable to assign officer.');
      }
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }

  Future<void> _createCustomer() async {
    final TextEditingController name = TextEditingController();
    final TextEditingController phone = TextEditingController();
    final TextEditingController email = TextEditingController();
    final TextEditingController password = TextEditingController();
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Register branch customer'),
        content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
          TextField(
              controller: name,
              decoration: const InputDecoration(labelText: 'Full name')),
          TextField(
              controller: phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone')),
          TextField(
              controller: email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email (optional)')),
          TextField(
              controller: password,
              obscureText: true,
              decoration:
                  const InputDecoration(labelText: 'Temporary password')),
        ]),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Register')),
        ],
      ),
    );
    if (save != true) return;
    try {
      if (name.text.trim().isEmpty ||
          phone.text.trim().length < 10 ||
          password.text.length < 6) {
        throw Exception(
            'Enter a name, valid phone, and password of at least 6 characters.');
      }
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = ((await SessionStore.readToken()) ??
              (await SessionStore.readToken()) ??
              '')
          .trim();
      final http.Response response = await http.post(
        Uri.parse('https://api.servicepay.ng/api/branches/customers'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token'
        },
        body: jsonEncode(<String, String>{
          'fullName': name.text.trim(),
          'phone': phone.text.trim(),
          'email': email.text.trim(),
          'password': password.text
        }),
      );
      final dynamic decoded =
          response.body.isEmpty ? null : jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(decoded is Map
            ? decoded['message'] ?? 'Unable to register customer.'
            : 'Unable to register customer.');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Branch customer registered.')));
        await _load();
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      name.dispose();
      phone.dispose();
      email.dispose();
      password.dispose();
    }
  }

  Widget _reportList() {
    final int emptyRowCount = _rows.isEmpty ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        itemCount: _rows.length + emptyRowCount + 1,
        itemBuilder: (BuildContext context, int index) {
          if (index == 0) return _reportSummary();
          if (_rows.isEmpty) {
            return const Padding(
              padding: EdgeInsets.all(24),
              child:
                  Center(child: Text('No transactions match these filters.')),
            );
          }
          final Map<String, dynamic> row = _rows[index - 1];
          return ListTile(
            leading:
                const CircleAvatar(child: Icon(Icons.receipt_long_outlined)),
            title: Text(_text(row, <String>['reference', 'serviceType'])),
            subtitle: Text('${_text(row, <String>[
                  'serviceType'
                ])} · ${_text(row, <String>['status'])}'),
            trailing: Text(_reportMoney(row['amount'])),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(_title),
          actions: <Widget>[
            if (widget.view == BranchOperationsView.reports)
              IconButton(
                key: const Key('branch-report-print'),
                tooltip: 'Print report',
                onPressed: _loading ? null : _printReport,
                icon: const Icon(Icons.print_outlined),
              ),
            if (widget.view == BranchOperationsView.reports &&
                controlCenterDownloadSupported)
              IconButton(
                key: const Key('branch-report-download-csv'),
                tooltip: 'Download CSV',
                onPressed: _loading ? null : _exportCsv,
                icon: const Icon(Icons.download_outlined),
              ),
            IconButton(
              key: const Key('branch-operations-refresh'),
              onPressed: _loading ? null : _load,
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: Column(children: <Widget>[
          if (widget.view == BranchOperationsView.reports) _reportFilters(),
          if (widget.view == BranchOperationsView.customers ||
              widget.view == BranchOperationsView.transactions ||
              widget.view == BranchOperationsView.riders ||
              widget.view == BranchOperationsView.phone)
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _search,
                onSubmitted: (_) => _load(),
                decoration: InputDecoration(
                  hintText: 'Search branch records',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                      onPressed: _load, icon: const Icon(Icons.arrow_forward)),
                ),
              ),
            ),
          Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(
                          child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: <Widget>[
                              Text(_error!, textAlign: TextAlign.center),
                              const SizedBox(height: 12),
                              FilledButton(
                                  onPressed: _load, child: const Text('Retry')),
                            ]))
                      : widget.view == BranchOperationsView.reports
                          ? _reportList()
                          : _rows.isEmpty
                              ? Center(
                                  child:
                                      Text('No ${_title.toLowerCase()} found.'))
                              : RefreshIndicator(
                                  onRefresh: _load,
                                  child: ListView.builder(
                                    itemCount: _rows.length,
                                    itemBuilder: (_, int index) {
                                      final Map<String, dynamic> row =
                                          _rows[index];
                                      return ListTile(
                                        leading: CircleAvatar(
                                            child: Icon(widget.view ==
                                                        BranchOperationsView
                                                            .customers ||
                                                    widget.view ==
                                                        BranchOperationsView
                                                            .officers
                                                ? Icons.person_outline
                                                : Icons.receipt_long_outlined)),
                                        title: Text(_text(row, <String>[
                                          'fullName',
                                          'orderReference',
                                          'orderNumber',
                                          'reference',
                                          'metric',
                                          'label',
                                          'serviceType'
                                        ])),
                                        subtitle: Text(_assignee(row).isNotEmpty
                                            ? 'Assigned to ${_assignee(row)}'
                                            : _text(row, <String>[
                                                'phone',
                                                'email',
                                                'status',
                                                'orderStatus',
                                                'jobTitle',
                                                'value',
                                                'period'
                                              ])),
                                        trailing: _assignmentFor(row) != null
                                            ? TextButton.icon(
                                                onPressed: () =>
                                                    _assignOfficer(row),
                                                icon: const Icon(Icons
                                                    .assignment_ind_outlined),
                                                label: Text(
                                                    _assignee(row).isEmpty
                                                        ? 'Assign'
                                                        : 'Reassign'),
                                              )
                                            : Text(_text(
                                                row,
                                                <String>['amount', 'actual'],
                                                '')),
                                        onTap: _assignmentFor(row) != null
                                            ? () => _assignOfficer(row)
                                            : widget.view ==
                                                    BranchOperationsView
                                                        .customers
                                                ? () => _customerProfile(row)
                                                : widget.view ==
                                                        BranchOperationsView
                                                            .riders
                                                    ? () =>
                                                        _customerProfile(row)
                                                    : null,
                                      );
                                    },
                                  ))),
        ]),
        floatingActionButton: widget.view == BranchOperationsView.customers
            ? FloatingActionButton.extended(
                onPressed: _createCustomer,
                icon: const Icon(Icons.person_add_alt_1),
                label: const Text('Register customer'),
              )
            : null,
      );
}
