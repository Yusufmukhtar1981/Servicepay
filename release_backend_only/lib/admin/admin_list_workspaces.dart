import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminListPage {
  const AdminListPage({
    required this.records,
    required this.page,
    required this.totalPages,
    required this.total,
  });

  final List<Map<String, dynamic>> records;
  final int page;
  final int totalPages;
  final int total;
}

abstract class AdminListWorkspaceApi {
  Future<AdminListPage> users({
    required int page,
    required String search,
    required String role,
    required String status,
  });

  Future<AdminListPage> transactions({
    required int page,
    required String search,
    required String status,
    required String serviceType,
  });
}

class AdminListWorkspaceHttpApi implements AdminListWorkspaceApi {
  AdminListWorkspaceHttpApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;

  @override
  Future<AdminListPage> users({
    required int page,
    required String search,
    required String role,
    required String status,
  }) =>
      _get(
        'users',
        <String, String>{
          'page': '$page',
          'limit': '20',
          if (search.trim().isNotEmpty) 'search': search.trim(),
          if (role != 'ALL') 'role': role,
          if (status != 'ALL') 'status': status,
        },
        'users',
      );

  @override
  Future<AdminListPage> transactions({
    required int page,
    required String search,
    required String status,
    required String serviceType,
  }) =>
      _get(
        'transactions',
        <String, String>{
          'page': '$page',
          'limit': '20',
          if (search.trim().isNotEmpty) 'search': search.trim(),
          if (status != 'ALL') 'status': status,
          if (serviceType != 'ALL') 'serviceType': serviceType,
        },
        'transactions',
      );

  Future<AdminListPage> _get(
    String path,
    Map<String, String> query,
    String listKey,
  ) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final String? token = preferences.getString('auth_token') ??
        preferences.getString('access_token') ??
        preferences.getString('token');
    if (token == null || token.trim().isEmpty) {
      throw Exception('Your admin session has expired. Please sign in again.');
    }
    final Uri uri =
        Uri.parse('$baseUrl/admin/$path').replace(queryParameters: query);
    final http.Response response =
        await _client.get(uri, headers: <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    }).timeout(const Duration(seconds: 30));
    dynamic body;
    try {
      body = jsonDecode(response.body);
    } catch (_) {
      body = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final String message = body is Map && body['message'] != null
          ? body['message'].toString()
          : 'Unable to load $listKey.';
      throw Exception(message);
    }
    final Map<String, dynamic> data = body is Map && body['data'] is Map
        ? Map<String, dynamic>.from(body['data'] as Map)
        : <String, dynamic>{};
    final dynamic rawRecords =
        data[listKey] ?? (body is Map ? body[listKey] : null);
    final List<Map<String, dynamic>> records = rawRecords is List
        ? rawRecords.whereType<Map>().map(Map<String, dynamic>.from).toList()
        : <Map<String, dynamic>>[];
    final Map<String, dynamic> pagination = data['pagination'] is Map
        ? Map<String, dynamic>.from(data['pagination'])
        : body is Map && body['pagination'] is Map
            ? Map<String, dynamic>.from(body['pagination'] as Map)
            : <String, dynamic>{};
    int number(dynamic value, int fallback) =>
        value is num ? value.toInt() : int.tryParse('$value') ?? fallback;
    return AdminListPage(
      records: records,
      page: number(
        pagination['currentPage'] ?? data['currentPage'],
        int.tryParse(query['page'] ?? '') ?? 1,
      ),
      totalPages: number(pagination['totalPages'] ?? data['totalPages'], 1),
      total: number(pagination['total'] ?? data['total'], records.length),
    );
  }
}

class AdminUsersScreen extends StatelessWidget {
  const AdminUsersScreen({super.key, this.api});
  final AdminListWorkspaceApi? api;

  @override
  Widget build(BuildContext context) =>
      _AdminListWorkspace(users: true, api: api);
}

class AdminTransactionsScreen extends StatelessWidget {
  const AdminTransactionsScreen({super.key, this.api});
  final AdminListWorkspaceApi? api;

  @override
  Widget build(BuildContext context) =>
      _AdminListWorkspace(users: false, api: api);
}

class _AdminListWorkspace extends StatefulWidget {
  const _AdminListWorkspace({required this.users, this.api});
  final bool users;
  final AdminListWorkspaceApi? api;

  @override
  State<_AdminListWorkspace> createState() => _AdminListWorkspaceState();
}

class _AdminListWorkspaceState extends State<_AdminListWorkspace> {
  late final AdminListWorkspaceApi _api;
  final TextEditingController _search = TextEditingController();
  List<Map<String, dynamic>> _records = <Map<String, dynamic>>[];
  bool _loading = true;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _total = 0;
  String _firstFilter = 'ALL';
  String _status = 'ALL';

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? AdminListWorkspaceHttpApi();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({int? page}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final int requestedPage = page ?? _page;
      final AdminListPage result = widget.users
          ? await _api.users(
              page: requestedPage,
              search: _search.text,
              role: _firstFilter,
              status: _status)
          : await _api.transactions(
              page: requestedPage,
              search: _search.text,
              status: _status,
              serviceType: _firstFilter);
      if (!mounted) return;
      setState(() {
        _records = result.records;
        _page = result.page;
        _totalPages = result.totalPages;
        _total = result.total;
      });
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _text(Map<String, dynamic> record, List<String> keys,
      [String fallback = 'Not available']) {
    for (final String key in keys) {
      final dynamic value = record[key];
      if (value != null &&
          value.toString().trim().isNotEmpty &&
          value.toString() != 'null') {
        return value.toString();
      }
    }
    return fallback;
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  void _details(Map<String, dynamic> record) {
    final Map<String, dynamic> customer = _map(record['customerId']);
    final List<MapEntry<String, String>> fields = widget.users
        ? <MapEntry<String, String>>[
            MapEntry<String, String>(
                'Name', _text(record, <String>['fullName', 'name'])),
            MapEntry<String, String>('Email', _text(record, <String>['email'])),
            MapEntry<String, String>('Phone', _text(record, <String>['phone'])),
            MapEntry<String, String>('Role', _text(record, <String>['role'])),
            MapEntry<String, String>(
                'Status', _text(record, <String>['status'])),
            MapEntry<String, String>('State', _text(record, <String>['state'])),
          ]
        : <MapEntry<String, String>>[
            MapEntry<String, String>(
                'Reference', _text(record, <String>['reference', '_id', 'id'])),
            MapEntry<String, String>(
                'Status', _text(record, <String>['status'])),
            MapEntry<String, String>(
                'Service', _text(record, <String>['serviceType', 'type'])),
            MapEntry<String, String>(
                'Amount', _text(record, <String>['amount'])),
            MapEntry<String, String>(
                'Provider', _text(record, <String>['provider'])),
            MapEntry<String, String>('Customer',
                _text(customer, <String>['fullName', 'name', 'phone'])),
          ];
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 4, 24, 28),
          child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(widget.users ? 'User details' : 'Transaction details',
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                ...fields.map((MapEntry<String, String> field) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text('${field.key}: ${field.value}'),
                    )),
              ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final List<String> firstOptions = widget.users
        ? <String>[
            'ALL',
            'CUSTOMER',
            'AGENT',
            'STATE_MANAGER',
            'ZONAL_MANAGER',
            'STAFF',
            'DELIVERY_RIDER'
          ]
        : <String>[
            'ALL',
            'AIRTIME',
            'DATA',
            'ELECTRICITY',
            'CABLE_TV',
            'TRANSFER'
          ];
    final List<String> statusOptions = widget.users
        ? <String>['ALL', 'ACTIVE', 'SUSPENDED', 'BLOCKED']
        : <String>[
            'ALL',
            'SUCCESS',
            'PENDING',
            'FAILED',
            'REFUNDED',
            'REVERSED'
          ];
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: Text(widget.users ? 'Users & Customers' : 'Transactions'),
        actions: <Widget>[
          IconButton(
              onPressed: _loading ? null : _load,
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh))
        ],
      ),
      body: Column(children: <Widget>[
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: <Widget>[
            TextField(
              key: const Key('admin-list-search'),
              controller: _search,
              onSubmitted: (_) => _load(page: 1),
              decoration: InputDecoration(
                labelText: widget.users
                    ? 'Search name, phone, email or location'
                    : 'Search reference, provider or customer',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                    onPressed: () => _load(page: 1),
                    icon: const Icon(Icons.search)),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Row(children: <Widget>[
              Expanded(
                  child: DropdownButtonFormField<String>(
                value: _firstFilter,
                decoration: InputDecoration(
                    labelText: widget.users ? 'Role' : 'Service',
                    border: const OutlineInputBorder()),
                items: firstOptions
                    .map((String v) => DropdownMenuItem<String>(
                        value: v, child: Text(v.replaceAll('_', ' '))))
                    .toList(),
                onChanged: _loading
                    ? null
                    : (String? v) {
                        if (v != null) {
                          setState(() => _firstFilter = v);
                          _load(page: 1);
                        }
                      },
              )),
              const SizedBox(width: 10),
              Expanded(
                  child: DropdownButtonFormField<String>(
                value: _status,
                decoration: const InputDecoration(
                    labelText: 'Status', border: OutlineInputBorder()),
                items: statusOptions
                    .map((String v) =>
                        DropdownMenuItem<String>(value: v, child: Text(v)))
                    .toList(),
                onChanged: _loading
                    ? null
                    : (String? v) {
                        if (v != null) {
                          setState(() => _status = v);
                          _load(page: 1);
                        }
                      },
              )),
            ]),
          ]),
        ),
        Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _state(Icons.cloud_off_outlined, 'Unable to load records',
                        _error!, retry: _load)
                    : _records.isEmpty
                        ? _state(Icons.inbox_outlined, 'No records found',
                            'Try changing your search or filters.')
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                              itemCount: _records.length + 1,
                              itemBuilder: (BuildContext context, int index) {
                                if (index == _records.length) {
                                  return _pagination();
                                }
                                final Map<String, dynamic> record =
                                    _records[index];
                                final Map<String, dynamic> customer =
                                    _map(record['customerId']);
                                final String title = widget.users
                                    ? _text(record, <String>[
                                        'fullName',
                                        'name',
                                        'email',
                                        'phone'
                                      ])
                                    : _text(record,
                                        <String>['reference', '_id', 'id']);
                                final String subtitle = widget.users
                                    ? '${_text(record, <String>[
                                            'role'
                                          ])} • ${_text(record, <String>[
                                            'status'
                                          ])}'
                                    : '${_text(record, <String>[
                                            'serviceType',
                                            'type'
                                          ])} • ${_text(record, <String>[
                                            'status'
                                          ])}\n${_text(customer, <String>[
                                          'fullName',
                                          'name',
                                          'phone'
                                        ], 'Customer unavailable')}';
                                return Card(
                                    child: ListTile(
                                  title: Text(title),
                                  subtitle: Text(subtitle),
                                  trailing: widget.users
                                      ? Chip(
                                          label: Text(_text(
                                              record, <String>['status'])))
                                      : Text(_text(record, <String>['amount'])),
                                  onTap: () => _details(record),
                                ));
                              },
                            ),
                          )),
      ]),
    );
  }

  Widget _state(IconData icon, String title, String message,
          {Future<void> Function()? retry}) =>
      Center(
        child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
              Icon(icon, size: 48),
              const SizedBox(height: 12),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(message, textAlign: TextAlign.center),
              if (retry != null) ...<Widget>[
                const SizedBox(height: 14),
                FilledButton.icon(
                    onPressed: retry,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry'))
              ],
            ])),
      );

  Widget _pagination() => Padding(
        padding: const EdgeInsets.only(top: 8),
        child:
            Row(mainAxisAlignment: MainAxisAlignment.center, children: <Widget>[
          IconButton(
              onPressed:
                  _page > 1 && !_loading ? () => _load(page: _page - 1) : null,
              icon: const Icon(Icons.chevron_left)),
          Text('Page $_page of $_totalPages • $_total total'),
          IconButton(
              onPressed: _page < _totalPages && !_loading
                  ? () => _load(page: _page + 1)
                  : null,
              icon: const Icon(Icons.chevron_right)),
        ]),
      );
}
