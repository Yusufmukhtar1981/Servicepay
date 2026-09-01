import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

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

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = (prefs.getString('auth_token') ??
              prefs.getString('access_token') ??
              prefs.getString('token') ??
              '')
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
      if (token.isEmpty) {
        throw Exception('Your session has expired. Please sign in again.');
      }
      final Map<String, String> query = <String, String>{
        'limit': '100',
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
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
        setState(() => _rows = rows);
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
      final String token = (prefs.getString('auth_token') ??
              prefs.getString('access_token') ??
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
      final String token = (prefs.getString('auth_token') ??
              prefs.getString('access_token') ??
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
      final String token = (prefs.getString('auth_token') ??
              prefs.getString('access_token') ??
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

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(_title), actions: <Widget>[
          IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh)),
        ]),
        body: Column(children: <Widget>[
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
                      : _rows.isEmpty
                          ? Center(
                              child: Text('No ${_title.toLowerCase()} found.'))
                          : RefreshIndicator(
                              onRefresh: _load,
                              child: ListView.builder(
                                itemCount: _rows.length,
                                itemBuilder: (_, int index) {
                                  final Map<String, dynamic> row = _rows[index];
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
                                            icon: const Icon(
                                                Icons.assignment_ind_outlined),
                                            label: Text(_assignee(row).isEmpty
                                                ? 'Assign'
                                                : 'Reassign'),
                                          )
                                        : Text(_text(row,
                                            <String>['amount', 'actual'], '')),
                                    onTap: _assignmentFor(row) != null
                                        ? () => _assignOfficer(row)
                                        : widget.view ==
                                                BranchOperationsView.customers
                                            ? () => _customerProfile(row)
                                            : widget.view ==
                                                    BranchOperationsView.riders
                                                ? () => _customerProfile(row)
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
