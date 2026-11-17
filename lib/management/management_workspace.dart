import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/receipt_download.dart';
import '../services/session_store.dart';
import 'management_api.dart';

Future<String> downloadManagementBytes(
  Uint8List bytes,
  String fileName, {
  required String mimeType,
}) async {
  try {
    final result = await Function.apply(
      downloadReceiptBytes,
      [bytes, fileName],
      {#mimeType: mimeType},
    );
    return result as String;
  } on NoSuchMethodError {
    return downloadReceiptBytes(bytes, fileName);
  }
}

/// The customer-care and commission surfaces inside the existing analytics shell.
class ManagementWorkspacePanel extends StatefulWidget {
  const ManagementWorkspacePanel({
    super.key,
    required this.api,
    required this.section,
  });

  final ManagementApi api;
  final String section;

  @override
  State<ManagementWorkspacePanel> createState() =>
      _ManagementWorkspacePanelState();
}

class _ManagementWorkspacePanelState extends State<ManagementWorkspacePanel> {
  static const _green = Color(0xFF08783E);
  static const _ink = Color(0xFF17392B);
  static const _muted = Color(0xFF718278);
  static const _line = Color(0xFFE1EAE4);
  static const _categories = <String, String>{
    'PENDING_TRANSACTION': 'Pending transaction',
    'FAILED_TRANSACTION': 'Failed transaction',
    'SUCCESS_NO_SERVICE': 'Successful, service not received',
    'DEBIT_NO_SERVICE': 'Debited, service not received',
    'DUPLICATE_TRANSACTION': 'Duplicate transaction',
    'INCORRECT_AMOUNT': 'Incorrect amount',
    'REFUND_REQUEST': 'Refund request',
    'OTHER': 'Other',
  };

  final _search = TextEditingController();
  final _reply = TextEditingController();
  final _issueDescription = TextEditingController();
  final _withdrawAmount = TextEditingController();
  final _bank = TextEditingController();
  final _accountName = TextEditingController();
  final _accountNumber = TextEditingController();
  List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _data = {};
  String _activity = 'ALL';
  String _complaintStatus = 'ALL';
  final String _issue = 'OTHER';
  String? _from;
  String? _to;
  int _page = 1;
  int _totalPages = 1;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  Timer? _searchTimer;
  int _loadVersion = 0;

  @override
  void initState() {
    super.initState();
    _search.addListener(_searchChanged);
    _load();
  }

  @override
  void didUpdateWidget(covariant ManagementWorkspacePanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.section != widget.section) {
      _page = 1;
      _load();
    }
  }

  @override
  void dispose() {
    _search.dispose();
    _reply.dispose();
    _issueDescription.dispose();
    _withdrawAmount.dispose();
    _bank.dispose();
    _accountName.dispose();
    _accountNumber.dispose();
    _searchTimer?.cancel();
    super.dispose();
  }

  void _searchChanged() {
    if (_isCustomerSection) {
      _page = 1;
      _searchTimer?.cancel();
      _searchTimer = Timer(const Duration(milliseconds: 350), () {
        if (mounted) _load();
      });
    }
  }

  bool get _isCustomerSection =>
      widget.section == 'My Customers' ||
      widget.section == 'Active Customers' ||
      widget.section == 'Inactive Customers';

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  List<Map<String, dynamic>> _rows(dynamic value) => value is List
      ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];
  String _value(dynamic value, [String fallback = '—']) =>
      value == null || '$value'.trim().isEmpty ? fallback : '$value';

  Future<void> _load() async {
    final requestVersion = ++_loadVersion;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      Map<String, dynamic> result;
      if (_isCustomerSection) {
        final activity = widget.section == 'Active Customers'
            ? 'ACTIVE'
            : widget.section == 'Inactive Customers'
                ? 'INACTIVE'
                : _activity;
        result = await widget.api.workspaceCustomers(
          activity: activity,
          search: _search.text.trim(),
          registeredFrom: _from,
          registeredTo: _to,
          page: _page,
        );
      } else if (widget.section == 'Withdrawals') {
        result = await widget.api.workspaceWithdrawals();
      } else {
        result = await widget.api.workspaceComplaints(
          status: _complaintStatus,
          page: _page,
        );
      }
      if (!mounted || requestVersion != _loadVersion) return;
      setState(() {
        _data = result;
        _items = _rows(result['items']);
        _page = (result['page'] as num?)?.toInt() ?? _page;
        _totalPages = (result['totalPages'] as num?)?.toInt() ?? 1;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || requestVersion != _loadVersion) return;
      setState(() {
        _error = error is ManagementApiException
            ? error.message
            : 'Could not reach the service. Check your connection and retry.';
        _loading = false;
      });
    }
  }

  Future<void> _pickDate(bool start) async {
    final now = DateTime.now();
    final initial =
        DateTime.tryParse(start ? (_from ?? '') : (_to ?? '')) ?? now;
    final selected = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 8),
      lastDate: now,
    );
    if (selected == null) return;
    setState(() {
      final date = ManagementPeriod.dateString(selected);
      if (start) {
        _from = date;
      } else {
        _to = date;
      }
      _page = 1;
    });
    _load();
  }

  Future<void> _export(String format) async {
    setState(() => _busy = true);
    try {
      final bytes = await widget.api.exportWorkspaceCustomers({
        'activity': widget.section == 'Active Customers'
            ? 'ACTIVE'
            : widget.section == 'Inactive Customers'
                ? 'INACTIVE'
                : _activity,
        'search': _search.text.trim(),
        if (_from != null) 'registeredFrom': _from!,
        if (_to != null) 'registeredTo': _to!,
        'format': format,
      });
      final result = await downloadManagementBytes(
        Uint8List.fromList(bytes),
        'servicepay-customers-${DateTime.now().millisecondsSinceEpoch}.$format',
        mimeType: format == 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      if (mounted) _message(result);
    } catch (error) {
      if (mounted) {
        _message(error is ManagementApiException
            ? error.message
            : 'Export could not be downloaded. Please retry.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _normalizePhone(dynamic input) {
    final raw = '$input'.trim();
    if (raw.isEmpty || !RegExp(r'^[+0-9().\-\s]+$').hasMatch(raw)) return null;
    var digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('0')) {
      digits = '234${digits.substring(1)}';
    } else if (raw.startsWith('+') && digits.startsWith('234')) {
      // Already in international form.
    } else if (digits.length == 10) {
      digits = '234$digits';
    }
    if (digits.length < 10 || digits.length > 15) return null;
    return '+$digits';
  }

  Future<void> _contact(String? phone, {required bool whatsapp}) async {
    if (phone == null) {
      _message('A valid customer phone number is not available.');
      return;
    }
    final normalized = _normalizePhone(phone);
    if (normalized == null) {
      _message('The customer phone number is not valid.');
      return;
    }
    final uri = whatsapp
        ? Uri.https('wa.me', normalized.replaceAll('+', ''))
        : Uri(scheme: 'tel', path: normalized);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
        mounted) {
      _message('No compatible app is available for this contact action.');
    }
  }

  void _message(String value) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(value)));

  Future<String> _requestKey(String namespace) async {
    final prefs = await SharedPreferences.getInstance();
    final token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) {
      throw const ManagementApiException(
        'Your session is unavailable. Sign in again before submitting.',
        401,
      );
    }
    // JWT claims are used only to isolate local retry keys by authenticated actor.
    // All authorization decisions remain with the API.
    final actorId = _actorIdForStorage(token);
    final storageKey =
        'management_workspace_key_${Uri.encodeComponent(actorId)}_${Uri.encodeComponent(namespace)}';
    final existing = prefs.getString(storageKey);
    if (existing != null && existing.isNotEmpty) {
      if (!await prefs.setString(storageKey, existing)) {
        throw const ManagementApiException(
          'Could not persist the request retry key. Please try again.',
        );
      }
      return existing;
    }
    final random = math.Random.secure();
    final key = List<String>.generate(
      32,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    if (!await prefs.setString(storageKey, key)) {
      throw const ManagementApiException(
        'Could not persist the request retry key. Please try again.',
      );
    }
    return key;
  }

  String _actorIdForStorage(String token) {
    try {
      final parts = token.trim().split('.');
      if (parts.length != 3) throw const FormatException();
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
      );
      if (payload is! Map) throw const FormatException();
      final user = payload['user'];
      final nested = user is Map ? user : const <String, dynamic>{};
      final value = payload['actorId'] ??
          payload['userId'] ??
          payload['id'] ??
          payload['_id'] ??
          nested['id'] ??
          nested['_id'] ??
          payload['sub'];
      final actorId = value?.toString().trim() ?? '';
      if (actorId.isEmpty || actorId == 'null') throw const FormatException();
      return actorId;
    } catch (_) {
      throw const ManagementApiException(
        'Your signed-in account could not be identified for a safe retry. Sign in again.',
        401,
      );
    }
  }

  Future<void> _clearRequestKey(String namespace) async {
    final prefs = await SharedPreferences.getInstance();
    final token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) return;
    final actorId = _actorIdForStorage(token);
    await prefs.remove(
      'management_workspace_key_${Uri.encodeComponent(actorId)}_${Uri.encodeComponent(namespace)}',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_isCustomerSection) _customerControls(),
        if (widget.section == 'Customer Complaints') _complaintControls(),
        if (_error != null) _errorCard(),
        if (_loading)
          const _WorkspaceLoading()
        else if (_error == null && _isCustomerSection)
          _customerList()
        else if (_error == null && widget.section == 'Withdrawals')
          _withdrawals()
        else if (_error == null)
          _complaints(),
      ],
    );
  }

  Widget _customerControls() => Container(
        padding: const EdgeInsets.all(14),
        decoration: _box(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          TextField(
            controller: _search,
            decoration:
                _input('Search by customer name or phone', Icons.search),
          ),
          if (widget.section == 'My Customers') ...[
            const SizedBox(height: 7),
            const Text(
              'Activity is separate from account restrictions. Declining means 31–60 days without activity; inactive means more than 60 days.',
              style: TextStyle(color: _muted, fontSize: 11, height: 1.35),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (widget.section == 'My Customers')
                  _select(_activity, const [
                    'ALL',
                    'ACTIVE',
                    'DECLINING',
                    'INACTIVE',
                    'NEW'
                  ], (value) {
                    setState(() {
                      _activity = value;
                      _page = 1;
                    });
                    _load();
                  }),
                OutlinedButton.icon(
                  onPressed: () => _pickDate(true),
                  icon: const Icon(Icons.calendar_today_outlined, size: 15),
                  label: Text(_from == null ? 'Registered from' : _from!),
                ),
                OutlinedButton.icon(
                  onPressed: () => _pickDate(false),
                  icon: const Icon(Icons.event_outlined, size: 15),
                  label: Text(_to == null ? 'Registered to' : _to!),
                ),
                TextButton(
                    onPressed: () {
                      setState(() {
                        _from = null;
                        _to = null;
                        _activity = 'ALL';
                        _page = 1;
                      });
                      _load();
                    },
                    child: const Text('Clear')),
                OutlinedButton.icon(
                    onPressed: _busy ? null : () => _export('csv'),
                    icon: const Icon(Icons.download_outlined, size: 16),
                    label: const Text('CSV')),
                OutlinedButton.icon(
                    onPressed: _busy ? null : () => _export('xlsx'),
                    icon: const Icon(Icons.grid_on_outlined, size: 16),
                    label: const Text('Excel')),
              ]),
        ]),
      );

  Widget _select(
          String value, List<String> values, ValueChanged<String> onChanged) =>
      DropdownButton<String>(
        value: values.contains(value) ? value : values.first,
        items: values
            .map((e) =>
                DropdownMenuItem(value: e, child: Text(e.replaceAll('_', ' '))))
            .toList(),
        onChanged: (selected) {
          if (selected != null) onChanged(selected);
        },
      );

  Widget _customerList() {
    if (_items.isEmpty) {
      return _emptyPanel(
        'No customer records found',
        'Try a different search or adjust the activity and registration filters.',
        Icons.people_outline,
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 12),
      Text('${_data['total'] ?? _items.length} customer records',
          style: const TextStyle(color: _muted, fontSize: 12)),
      const SizedBox(height: 8),
      ..._items.map(_customerTile),
      _pager(),
    ]);
  }

  Widget _customerTile(Map<String, dynamic> customer) {
    final phone = customer['phone']?.toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      decoration: _box(),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(
                backgroundColor: const Color(0xFFE9F5EE),
                foregroundColor: _green,
                child: Text(_initials(_value(customer['fullName'], '?')))),
            const SizedBox(width: 11),
            Expanded(
                child: InkWell(
              onTap: () => _showCustomer(customer),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_value(customer['fullName']),
                        style: const TextStyle(
                            color: _ink, fontWeight: FontWeight.w800)),
                    Text(_value(customer['email'], 'Email unavailable'),
                        style: const TextStyle(color: _muted, fontSize: 12)),
                  ]),
            )),
            _status(customer['activityStatus']),
          ]),
          const SizedBox(height: 12),
          Wrap(spacing: 17, runSpacing: 8, children: [
            _detail('Account', _value(customer['accountStatus'])),
            _detail('Transactions', _value(customer['transactions'])),
            _detail(
                'Volume',
                customer['transactionVolume'] == null
                    ? '—'
                    : '₦${customer['transactionVolume']}'),
            _detail('Last activity', _date(customer['lastTransactionAt'])),
            _detail('Registered', _date(customer['createdAt'])),
          ]),
          const Divider(height: 20),
          Row(children: [
            Expanded(
                child: Text(_value(phone),
                    style: const TextStyle(color: _ink, fontSize: 12))),
            IconButton(
                tooltip: 'Call customer',
                onPressed: () => _contact(phone, whatsapp: false),
                icon: const Icon(Icons.call_outlined, color: _green)),
            IconButton(
                tooltip: 'Message on WhatsApp',
                onPressed: () => _contact(phone, whatsapp: true),
                icon: const Icon(Icons.chat_outlined, color: _green)),
            TextButton(
                onPressed: () => _showCustomer(customer),
                child: const Text('Details')),
          ]),
        ]),
      ),
    );
  }

  Future<void> _showCustomer(Map<String, dynamic> customer) async {
    final id = customer['id']?.toString();
    if (id == null || id.isEmpty) return;
    Timer? transactionSearchDebounce;
    var transactionRequestVersion = 0;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.white,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680, maxHeight: 720),
          child: FutureBuilder<Map<String, dynamic>>(
            future: widget.api.workspaceCustomer(id, limit: 25),
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return _dialogBody(
                    'Customer details',
                    const Text(
                        'Details could not be loaded. Please close and retry.'));
              }
              if (!snapshot.hasData) {
                return const SizedBox(
                    height: 220,
                    child: Center(child: CircularProgressIndicator()));
              }
              final detail = snapshot.data!;
              final profile = _map(detail['customer']);
              var transactions = _rows(_map(detail['transactions'])['items']);
              var transactionPage =
                  (_map(detail['transactions'])['page'] as num?)?.toInt() ?? 1;
              var transactionTotalPages =
                  (_map(detail['transactions'])['totalPages'] as num?)
                          ?.toInt() ??
                      1;
              var transactionSearch = '';
              var transactionLoading = false;
              String? transactionError;
              var transactionQueryVersion = 0;
              var dialogContext = context;

              return StatefulBuilder(builder: (stateContext, refresh) {
                dialogContext = stateContext;

                Future<void> loadTransactions({
                  required int page,
                  required String search,
                  required int queryVersion,
                }) async {
                  final requestVersion = ++transactionRequestVersion;
                  refresh(() {
                    transactionLoading = true;
                    transactionError = null;
                    transactionSearch = search;
                    transactionPage = page;
                  });
                  try {
                    final response =
                        await widget.api.workspaceCustomerTransactions(
                      id,
                      search: search,
                      page: page,
                      limit: 25,
                    );
                    if (!dialogContext.mounted ||
                        requestVersion != transactionRequestVersion ||
                        queryVersion != transactionQueryVersion) {
                      return;
                    }
                    refresh(() {
                      transactions = _rows(response['items']);
                      transactionPage =
                          (response['page'] as num?)?.toInt() ?? page;
                      transactionTotalPages =
                          (response['totalPages'] as num?)?.toInt() ?? 1;
                      transactionLoading = false;
                    });
                  } catch (error) {
                    if (!dialogContext.mounted ||
                        requestVersion != transactionRequestVersion ||
                        queryVersion != transactionQueryVersion) {
                      return;
                    }
                    refresh(() {
                      transactionLoading = false;
                      transactionError = error is ManagementApiException
                          ? error.message
                          : 'Transactions could not be loaded. Please retry.';
                    });
                  }
                }

                return _dialogBody(
                  _value(profile['fullName'], 'Customer details'),
                  Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(spacing: 15, runSpacing: 10, children: [
                          _detail('Email', _value(profile['email'])),
                          _detail('Account', _value(profile['accountStatus'])),
                          _detail(
                              'Activity', _value(profile['activityStatus'])),
                          _detail(
                              'Transactions', _value(profile['transactions'])),
                          _detail(
                              'Volume',
                              profile['transactionVolume'] == null
                                  ? '—'
                                  : '₦${profile['transactionVolume']}'),
                          _detail('Registered', _date(profile['createdAt'])),
                          _detail('Last transaction',
                              _date(profile['lastTransactionAt'])),
                        ]),
                        const SizedBox(height: 10),
                        _phoneActions(profile['phone']?.toString()),
                        const SizedBox(height: 18),
                        const Text('Customer transactions',
                            style: TextStyle(
                                color: _ink, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 7),
                        TextField(
                          decoration: _input(
                              'Search transaction reference', Icons.search),
                          onChanged: (value) {
                            final queryVersion = ++transactionQueryVersion;
                            transactionRequestVersion++;
                            transactionSearchDebounce?.cancel();
                            refresh(() {
                              transactionLoading = true;
                              transactionError = null;
                              transactionSearch = value;
                              transactionPage = 1;
                            });
                            transactionSearchDebounce = Timer(
                              const Duration(milliseconds: 350),
                              () {
                                if (!dialogContext.mounted ||
                                    queryVersion != transactionQueryVersion) {
                                  return;
                                }
                                loadTransactions(
                                  page: 1,
                                  search: value.trim(),
                                  queryVersion: queryVersion,
                                );
                              },
                            );
                          },
                        ),
                        if (transactionError != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Row(children: [
                              Expanded(
                                  child: Text(transactionError!,
                                      style: const TextStyle(
                                          color: Color(0xFFB44D48),
                                          fontSize: 12))),
                              TextButton(
                                onPressed: () => loadTransactions(
                                  page: transactionPage,
                                  search: transactionSearch.trim(),
                                  queryVersion: transactionQueryVersion,
                                ),
                                child: const Text('Retry'),
                              ),
                            ]),
                          ),
                        if (transactionLoading && transactions.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Center(child: CircularProgressIndicator()),
                          )
                        else if (transactions.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            child: Text(
                                'No transaction records match this search.',
                                style: TextStyle(color: _muted)),
                          )
                        else
                          ...transactions.map((tx) => ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: Text(_value(tx['reference']),
                                    style: const TextStyle(color: _ink)),
                                subtitle: Text(
                                    '${_value(tx['serviceType'])} · ${_date(tx['createdAt'])}'),
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(tx['amount'] == null
                                        ? '—'
                                        : '₦${tx['amount']}'),
                                    Text(_value(tx['status']),
                                        style: const TextStyle(
                                            color: _muted, fontSize: 10)),
                                  ],
                                ),
                              )),
                        if (transactionTotalPages > 1)
                          Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                Text(
                                    'Page $transactionPage of $transactionTotalPages',
                                    style: const TextStyle(
                                        color: _muted, fontSize: 11)),
                                IconButton(
                                  tooltip: 'Previous transaction page',
                                  onPressed: transactionPage <= 1 ||
                                          transactionLoading
                                      ? null
                                      : () {
                                          final queryVersion =
                                              transactionQueryVersion;
                                          loadTransactions(
                                            page: transactionPage - 1,
                                            search: transactionSearch.trim(),
                                            queryVersion: queryVersion,
                                          );
                                        },
                                  icon: const Icon(Icons.chevron_left),
                                ),
                                IconButton(
                                  tooltip: 'Next transaction page',
                                  onPressed: transactionPage >=
                                              transactionTotalPages ||
                                          transactionLoading
                                      ? null
                                      : () {
                                          final queryVersion =
                                              transactionQueryVersion;
                                          loadTransactions(
                                            page: transactionPage + 1,
                                            search: transactionSearch.trim(),
                                            queryVersion: queryVersion,
                                          );
                                        },
                                  icon: const Icon(Icons.chevron_right),
                                ),
                              ]),
                        if (detail['legacyTransactionsExcluded'] == true)
                          const Text(
                              'Legacy transactions are excluded from this activity view.',
                              style: TextStyle(color: _muted, fontSize: 11)),
                      ]),
                );
              });
            },
          ),
        ),
      ),
    );
    transactionSearchDebounce?.cancel();
    transactionRequestVersion++;
  }

  Widget _dialogBody(String title, Widget body) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Expanded(
                    child: Text(title,
                        style: const TextStyle(
                            color: _ink,
                            fontSize: 18,
                            fontWeight: FontWeight.w800))),
                IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close))
              ]),
              const Divider(),
              Flexible(child: SingleChildScrollView(child: body)),
            ]),
      );

  Widget _complaintControls() => Container(
        padding: const EdgeInsets.all(13),
        margin: const EdgeInsets.only(bottom: 11),
        decoration: _box(),
        child: Wrap(spacing: 8, runSpacing: 8, children: [
          _select(_complaintStatus, const [
            'ALL',
            'OPEN',
            'IN_REVIEW',
            'IN_PROGRESS',
            'ESCALATED',
            'RESOLVED',
            'REJECTED',
            'CLOSED',
            'WAITING_ON_CUSTOMER'
          ], (value) {
            setState(() {
              _complaintStatus = value;
              _page = 1;
            });
            _load();
          }),
          FilledButton.icon(
              onPressed: _newComplaint,
              icon: const Icon(Icons.add, size: 17),
              label: const Text('New complaint')),
        ]),
      );

  Widget _complaints() {
    if (_items.isEmpty) {
      return _emptyPanel(
          'No complaints in this view',
          'New cases and customer updates will appear here.',
          Icons.support_agent_outlined);
    }
    return Column(children: [
      ..._items.map((ticket) => Container(
            margin: const EdgeInsets.only(bottom: 9),
            decoration: _box(),
            child: ListTile(
              onTap: () => _showComplaint(ticket),
              title: Text(
                  '${_value(ticket['caseReference'])} · ${_value(ticket['subject'])}',
                  style: const TextStyle(
                      color: _ink, fontWeight: FontWeight.w800)),
              subtitle: Text(
                  '${_value(_map(ticket['customer'])['fullName'])} · ${_value(ticket['category'] ?? ticket['issueCategory'])}',
                  style: const TextStyle(color: _muted)),
              trailing: _status(ticket['status']),
            ),
          )),
      _pager(),
    ]);
  }

  Future<void> _newComplaint() async {
    List<Map<String, dynamic>> matches = [];
    List<Map<String, dynamic>> txs = [];
    String? selectedCustomer;
    String? selectedTransaction;
    String category = _issue;
    List<Map<String, dynamic>> files = [];
    String? customerError;
    String? transactionError;
    String? attachmentError;
    bool customerLoading = false;
    bool transactionLoading = false;
    String transactionSearch = '';
    int transactionPage = 1;
    int transactionTotalPages = 1;
    int customerSearchVersion = 0;
    int customerSelectionVersion = 0;
    int transactionRequestVersion = 0;
    int transactionQueryVersion = 0;
    Timer? customerSearchDebounce;
    Timer? transactionSearchDebounce;
    final formKey = GlobalKey<FormState>();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, refresh) {
          Future<void> loadTransactions({
            required String customerId,
            required int selectionVersion,
            required int page,
            required String search,
          }) async {
            final requestVersion = ++transactionRequestVersion;
            refresh(() {
              transactionLoading = true;
              transactionError = null;
              transactionPage = page;
            });
            try {
              final response = await widget.api.workspaceCustomerTransactions(
                customerId,
                search: search,
                page: page,
                limit: 25,
              );
              if (!dialogContext.mounted ||
                  selectionVersion != customerSelectionVersion ||
                  requestVersion != transactionRequestVersion) {
                return;
              }
              refresh(() {
                txs = _rows(response['items']);
                transactionPage = (response['page'] as num?)?.toInt() ?? page;
                transactionTotalPages =
                    (response['totalPages'] as num?)?.toInt() ?? 1;
                transactionLoading = false;
              });
            } catch (error) {
              if (!dialogContext.mounted ||
                  selectionVersion != customerSelectionVersion ||
                  requestVersion != transactionRequestVersion) {
                return;
              }
              refresh(() {
                transactionLoading = false;
                transactionError = error is ManagementApiException
                    ? error.message
                    : 'Customer transactions could not be loaded. Retry.';
              });
            }
          }

          Future<void> searchCustomers(String value) async {
            final queryVersion = ++customerSearchVersion;
            customerSearchDebounce?.cancel();
            customerSelectionVersion++;
            transactionRequestVersion++;
            refresh(() {
              matches = [];
              selectedCustomer = null;
              selectedTransaction = null;
              txs = [];
              customerError = null;
              transactionError = null;
              transactionLoading = false;
              customerLoading = value.trim().isNotEmpty;
            });
            if (value.trim().isEmpty) return;
            customerSearchDebounce =
                Timer(const Duration(milliseconds: 350), () async {
              try {
                final response = await widget.api.workspaceCustomers(
                  search: value.trim(),
                  limit: 10,
                );
                if (!dialogContext.mounted ||
                    queryVersion != customerSearchVersion) {
                  return;
                }
                refresh(() {
                  matches = _rows(response['items']);
                  customerLoading = false;
                });
              } catch (error) {
                if (!dialogContext.mounted ||
                    queryVersion != customerSearchVersion) {
                  return;
                }
                refresh(() {
                  customerLoading = false;
                  customerError = error is ManagementApiException
                      ? error.message
                      : 'Customer search failed. Check your connection and retry.';
                });
              }
            });
          }

          return AlertDialog(
            backgroundColor: Colors.white,
            title: const Text(
              'Create customer complaint',
              style: TextStyle(color: _ink),
            ),
            content: SizedBox(
              width: 560,
              child: SingleChildScrollView(
                child: Form(
                  key: formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextField(
                        decoration: _input(
                            'Find customer by name or phone', Icons.search),
                        onChanged: searchCustomers,
                      ),
                      if (customerLoading)
                        const LinearProgressIndicator(minHeight: 2),
                      if (customerError != null)
                        _inlineFormError(customerError!),
                      ...matches.take(5).map((customer) => ListTile(
                            dense: true,
                            title: Text(_value(customer['fullName'])),
                            subtitle: Text(_value(customer['phone'])),
                            trailing: selectedCustomer == '${customer['id']}'
                                ? const Icon(Icons.check, color: _green)
                                : null,
                            onTap: () async {
                              final rawId = customer['id']?.toString();
                              if (rawId == null || rawId.trim().isEmpty) {
                                refresh(() {
                                  customerError =
                                      'This customer record has no usable identifier. Search for another record.';
                                });
                                return;
                              }
                              final customerId = rawId;
                              final selectionVersion =
                                  ++customerSelectionVersion;
                              customerSearchVersion++;
                              customerSearchDebounce?.cancel();
                              transactionSearchDebounce?.cancel();
                              refresh(() {
                                selectedCustomer = customerId;
                                selectedTransaction = null;
                                transactionSearch = '';
                                txs = [];
                                transactionPage = 1;
                                transactionTotalPages = 1;
                                transactionLoading = true;
                                transactionError = null;
                                customerError = null;
                                customerLoading = false;
                              });
                              await loadTransactions(
                                customerId: customerId,
                                selectionVersion: selectionVersion,
                                page: 1,
                                search: '',
                              );
                            },
                          )),
                      if (selectedCustomer != null) ...[
                        const SizedBox(height: 8),
                        TextField(
                          decoration: _input('Search transaction reference',
                              Icons.receipt_long_outlined),
                          onChanged: (value) {
                            final queryVersion = ++transactionQueryVersion;
                            transactionRequestVersion++;
                            transactionSearchDebounce?.cancel();
                            refresh(() {
                              transactionSearch = value;
                              selectedTransaction = null;
                              txs = [];
                              transactionPage = 1;
                              transactionLoading = value.trim().isNotEmpty;
                              transactionError = null;
                            });
                            final customerId = selectedCustomer!;
                            final selectionVersion = customerSelectionVersion;
                            if (value.trim().isEmpty) {
                              loadTransactions(
                                customerId: customerId,
                                selectionVersion: selectionVersion,
                                page: 1,
                                search: '',
                              );
                              return;
                            }
                            transactionSearchDebounce = Timer(
                              const Duration(milliseconds: 350),
                              () {
                                if (!dialogContext.mounted ||
                                    queryVersion != transactionQueryVersion ||
                                    selectionVersion !=
                                        customerSelectionVersion) {
                                  return;
                                }
                                loadTransactions(
                                  customerId: customerId,
                                  selectionVersion: selectionVersion,
                                  page: 1,
                                  search: value.trim(),
                                );
                              },
                            );
                          },
                        ),
                        if (transactionError != null)
                          _inlineFormError(transactionError!),
                        if (transactionLoading && txs.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(12),
                            child: CircularProgressIndicator(),
                          )
                        else if (txs.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 10),
                            child: Text(
                              'No actual scoped transaction matches. Select a transaction before submitting.',
                              style: TextStyle(color: _muted, fontSize: 11),
                            ),
                          )
                        else
                          ...txs.map((tx) {
                            final txId = tx['id']?.toString();
                            final canSelectTransaction = txId != null &&
                                txId.isNotEmpty &&
                                txId != 'null';
                            final isSelected = selectedTransaction == txId;
                            return ListTile(
                              dense: true,
                              selected: isSelected,
                              selectedTileColor: const Color(0xFFE9F5EE),
                              title: Text(
                                _value(tx['reference']),
                                style: const TextStyle(
                                    color: _ink, fontWeight: FontWeight.w700),
                              ),
                              subtitle: Text(
                                '${_value(tx['serviceType'])} · ${_date(tx['createdAt'])} · ${_value(tx['status'])}',
                              ),
                              trailing: Text(
                                tx['amount'] == null ? '—' : '₦${tx['amount']}',
                                style: const TextStyle(color: _ink),
                              ),
                              onTap: !canSelectTransaction
                                  ? null
                                  : () =>
                                      refresh(() => selectedTransaction = txId),
                            );
                          }),
                        if (transactionError != null)
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: () => loadTransactions(
                                customerId: selectedCustomer!,
                                selectionVersion: customerSelectionVersion,
                                page: transactionPage,
                                search: transactionSearch.trim(),
                              ),
                              child: const Text('Retry transactions'),
                            ),
                          ),
                        if (transactionTotalPages > 1)
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              Text(
                                  'Page $transactionPage of $transactionTotalPages',
                                  style: const TextStyle(
                                      color: _muted, fontSize: 11)),
                              IconButton(
                                tooltip: 'Previous transaction page',
                                onPressed:
                                    transactionPage <= 1 || transactionLoading
                                        ? null
                                        : () => loadTransactions(
                                              customerId: selectedCustomer!,
                                              selectionVersion:
                                                  customerSelectionVersion,
                                              page: transactionPage - 1,
                                              search: transactionSearch.trim(),
                                            ),
                                icon: const Icon(Icons.chevron_left),
                              ),
                              IconButton(
                                tooltip: 'Next transaction page',
                                onPressed:
                                    transactionPage >= transactionTotalPages ||
                                            transactionLoading
                                        ? null
                                        : () => loadTransactions(
                                              customerId: selectedCustomer!,
                                              selectionVersion:
                                                  customerSelectionVersion,
                                              page: transactionPage + 1,
                                              search: transactionSearch.trim(),
                                            ),
                                icon: const Icon(Icons.chevron_right),
                              ),
                            ],
                          ),
                      ],
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        value: category,
                        decoration:
                            const InputDecoration(labelText: 'Issue type'),
                        items: _categories.entries
                            .map((e) => DropdownMenuItem(
                                value: e.key, child: Text(e.value)))
                            .toList(),
                        onChanged: (value) {
                          if (value != null) refresh(() => category = value);
                        },
                      ),
                      TextFormField(
                        controller: _issueDescription,
                        minLines: 3,
                        maxLines: 6,
                        decoration: const InputDecoration(
                            labelText: 'Describe the issue'),
                        validator: (value) =>
                            (value == null || value.trim().length < 8)
                                ? 'Please add a little more detail.'
                                : null,
                      ),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Wrap(
                          spacing: 8,
                          children: [
                            OutlinedButton.icon(
                              onPressed: files.length >= 2
                                  ? null
                                  : () async {
                                      try {
                                        final result =
                                            await FilePicker.platform.pickFiles(
                                          type: FileType.image,
                                          allowMultiple: true,
                                          withData: true,
                                        );
                                        if (!dialogContext.mounted ||
                                            result == null) {
                                          return;
                                        }
                                        var rejected = false;
                                        attachmentError = null;
                                        for (final file in result.files) {
                                          if (files.length >= 2) break;
                                          final bytes = file.bytes;
                                          final ext =
                                              file.extension?.toLowerCase();
                                          if (bytes == null ||
                                              bytes.length > 256 * 1024 ||
                                              !['png', 'jpg', 'jpeg', 'webp']
                                                  .contains(ext)) {
                                            rejected = true;
                                            continue;
                                          }
                                          final mime = ext == 'png'
                                              ? 'image/png'
                                              : ext == 'webp'
                                                  ? 'image/webp'
                                                  : 'image/jpeg';
                                          files.add({
                                            'name': file.name,
                                            'dataUrl':
                                                'data:$mime;base64,${base64Encode(bytes)}',
                                          });
                                        }
                                        refresh(() {});
                                        if (rejected) {
                                          _message(
                                              'Only PNG, JPEG or WebP screenshots up to 256 KiB are accepted.');
                                        }
                                      } catch (_) {
                                        if (dialogContext.mounted) {
                                          refresh(() {
                                            attachmentError =
                                                'Attachments could not be selected. Retry or continue without one.';
                                          });
                                        }
                                      }
                                    },
                              icon: const Icon(Icons.attach_file),
                              label: const Text('Attach screenshots'),
                            ),
                            Text(
                              '${files.length}/2 · PNG/JPEG/WebP, max 256 KiB each',
                              style:
                                  const TextStyle(color: _muted, fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                      if (transactionError != null && selectedCustomer == null)
                        _inlineFormError(transactionError!),
                      if (attachmentError != null)
                        _inlineFormError(attachmentError!),
                    ],
                  ),
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  if (!formKey.currentState!.validate()) return;
                  if (selectedCustomer == null ||
                      selectedTransaction == null ||
                      transactionLoading) {
                    _message(
                        'Select an in-scope customer and an actual transaction.');
                    return;
                  }
                  Navigator.pop(dialogContext, true);
                },
                child: const Text('Submit complaint'),
              ),
            ],
          );
        },
      ),
    );
    customerSearchDebounce?.cancel();
    transactionSearchDebounce?.cancel();
    if (submitted != true ||
        selectedCustomer == null ||
        selectedTransaction == null) {
      return;
    }
    setState(() => _busy = true);
    try {
      final keyScope =
          'complaint-create-$selectedCustomer-$selectedTransaction-$category';
      final key = await _requestKey(keyScope);
      final result = await widget.api.createWorkspaceComplaint({
        'customerId': selectedCustomer,
        'transactionId': selectedTransaction,
        'issueCategory': category,
        'description': _issueDescription.text.trim(),
        'idempotencyKey': key,
        'attachments': files,
      });
      final ticket =
          _map(result['ticket']).isNotEmpty ? _map(result['ticket']) : result;
      _message(
          'Complaint submitted · ${_value(ticket['caseReference'], 'reference pending')}');
      await _clearRequestKey(keyScope);
      _issueDescription.clear();
      await _load();
    } catch (error) {
      _message(error is ManagementApiException
          ? error.message
          : 'Submission failed. Retry safely; the request key has been retained.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showComplaint(Map<String, dynamic> ticket) async {
    final id = ticket['id']?.toString();
    if (id == null || id.isEmpty) return;
    final future = widget.api.workspaceComplaint(id);
    final detail = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => FutureBuilder<Map<String, dynamic>>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return AlertDialog(
              backgroundColor: Colors.white,
              title: const Text('Could not load complaint'),
              content: const Text(
                  'Check your connection and close this panel to retry.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Close'))
              ],
            );
          }
          if (!snapshot.hasData) {
            return const AlertDialog(
                content: SizedBox(
                    height: 120,
                    child: Center(child: CircularProgressIndicator())));
          }
          final record = snapshot.data!;
          final replies = _rows(record['replies']);
          final contextTx = _map(record['transactionContext']);
          final closed = const ['RESOLVED', 'REJECTED', 'CLOSED']
              .contains('${record['status']}'.toUpperCase());
          return AlertDialog(
            backgroundColor: Colors.white,
            title: Text(_value(record['caseReference']),
                style: const TextStyle(color: _ink)),
            content: SizedBox(
                width: 560,
                child: SingleChildScrollView(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      _status(record['status']),
                      const SizedBox(height: 12),
                      Text(_value(record['subject']),
                          style: const TextStyle(
                              color: _ink, fontWeight: FontWeight.w800)),
                      Text(_value(record['description']),
                          style: const TextStyle(color: _muted)),
                      const SizedBox(height: 10),
                      Text(
                          'Customer: ${_value(_map(record['customer'])['fullName'])}',
                          style: const TextStyle(color: _ink)),
                      _phoneActions(
                          _map(record['customer'])['phone']?.toString()),
                      Text(
                          'Transaction: ${_value(contextTx['reference'])} · ${_value(contextTx['transactionType'])} · ${contextTx['amount'] == null ? '—' : '₦${contextTx['amount']}'}',
                          style: const TextStyle(color: _muted)),
                      ..._rows(record['attachments'])
                          .map((attachment) => _attachmentView(attachment)),
                      const Divider(height: 24),
                      const Text('Updates',
                          style: TextStyle(
                              color: _ink, fontWeight: FontWeight.w800)),
                      ...replies.map((reply) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(_value(reply['message']),
                              style: const TextStyle(color: _ink)),
                          subtitle: Text(
                              '${_value(reply['authorName'])} · ${_value(reply['authorRole'])} · ${_date(reply['createdAt'])}'))),
                      if (!closed)
                        TextField(
                            controller: _reply,
                            minLines: 2,
                            maxLines: 4,
                            decoration:
                                _input('Add an update', Icons.reply_outlined)),
                      if (closed)
                        const Text(
                            'This case is closed. Replies are unavailable.',
                            style: TextStyle(color: _muted)),
                    ]))),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close')),
              if (!closed)
                FilledButton(
                    onPressed: () => Navigator.pop(
                        context, {'id': id, 'reply': _reply.text.trim()}),
                    child: const Text('Send update')),
            ],
          );
        },
      ),
    );
    if (detail == null || (detail['reply'] as String).isEmpty) return;
    try {
      final key = await _requestKey('complaint-reply-${detail['id']}');
      await widget.api.replyWorkspaceComplaint(detail['id'] as String, {
        'message': detail['reply'],
        'idempotencyKey': key,
      });
      await _clearRequestKey('complaint-reply-${detail['id']}');
      _reply.clear();
      _message('Update sent.');
      await _load();
    } catch (error) {
      _message(error is ManagementApiException
          ? error.message
          : 'Update failed. Your retry key has been retained.');
    }
  }

  Widget _withdrawals() {
    final summary = _map(_data['summary']);
    final readiness = _map(_data['readiness']);
    const enabled = false;
    final items = _rows(_data['legacyWalletWithdrawals']);
    Widget metric(String title, dynamic value) => Container(
          width: 190,
          padding: const EdgeInsets.all(14),
          decoration: _box(),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value == null ? 'Not verified' : '₦$value',
                style: const TextStyle(
                    color: _ink, fontWeight: FontWeight.w800, fontSize: 18)),
            const SizedBox(height: 4),
            Text(title, style: const TextStyle(color: _muted, fontSize: 11)),
          ]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: const Color(0xFFFFF8E7),
            border: Border.all(color: const Color(0xFFEBD99D)),
            borderRadius: BorderRadius.circular(14)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.info_outline, color: Color(0xFF8D6A18)),
          const SizedBox(width: 10),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                const Text('Commission withdrawal readiness',
                    style: TextStyle(color: _ink, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(
                    _value(readiness['message'],
                        'Commission custody has not been verified. Commission payouts are unavailable.'),
                    style: const TextStyle(color: _ink, height: 1.45)),
              ])),
        ]),
      ),
      const SizedBox(height: 12),
      Wrap(spacing: 9, runSpacing: 9, children: [
        metric('Total commission earned', summary['totalCommissionEarned']),
        metric('Recorded available commission',
            summary['recordedAvailableCommission']),
        metric('Recorded withdrawal records · not verified payouts',
            summary['recordedWithdrawnCommission']),
        metric('Available commission', summary['availableCommission']),
        metric('Total withdrawn', summary['totalWithdrawn']),
        metric('Pending withdrawals', summary['pendingWithdrawals']),
      ]),
      const SizedBox(height: 14),
      Container(
        decoration: _box(),
        padding: const EdgeInsets.all(15),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Request commission withdrawal',
              style: TextStyle(color: _ink, fontWeight: FontWeight.w800)),
          const SizedBox(height: 7),
          const Text(
              'Commission custody is not verified. Requests cannot be submitted from this workspace.',
              style: TextStyle(color: _muted)),
          const SizedBox(height: 11),
          Wrap(spacing: 9, runSpacing: 9, children: [
            SizedBox(
                width: 150,
                child: TextField(
                    controller: _withdrawAmount,
                    enabled: enabled,
                    keyboardType: TextInputType.number,
                    decoration: _input('Amount (₦)', Icons.payments_outlined))),
            SizedBox(
                width: 190,
                child: TextField(
                    controller: _bank,
                    enabled: enabled,
                    decoration:
                        _input('Bank', Icons.account_balance_outlined))),
            SizedBox(
                width: 190,
                child: TextField(
                    controller: _accountName,
                    enabled: enabled,
                    decoration: _input('Account name', Icons.person_outline))),
            SizedBox(
                width: 170,
                child: TextField(
                    controller: _accountNumber,
                    enabled: enabled,
                    keyboardType: TextInputType.number,
                    decoration: _input('Account number', Icons.numbers))),
            const FilledButton(onPressed: null, child: Text('Submit request')),
          ]),
        ]),
      ),
      const SizedBox(height: 14),
      const Text(
          'General wallet withdrawal history · not commission payout evidence',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
      const SizedBox(height: 7),
      const Text(
          'These records are shown for context only. Their statuses do not establish that individual commissions were paid.',
          style: TextStyle(color: Colors.white70, fontSize: 11)),
      const SizedBox(height: 7),
      if (items.isEmpty)
        _emptyPanel(
            'No historical withdrawal records',
            'No legacy records were returned for your account.',
            Icons.receipt_long_outlined)
      else
        ...items.map((item) => Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(13),
              decoration: _box(),
              child: Row(children: [
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(_value(item['reference']),
                          style: const TextStyle(
                              color: _ink, fontWeight: FontWeight.w700)),
                      Text(
                          '${_date(item['createdAt'])} · ${_value(item['adminNote'], 'No admin note')}',
                          style: const TextStyle(color: _muted, fontSize: 11)),
                      if (item['payoutReference'] != null)
                        Text('Payout reference: ${item['payoutReference']}',
                            style:
                                const TextStyle(color: _muted, fontSize: 11)),
                    ])),
                Text(item['amount'] == null ? '—' : '₦${item['amount']}',
                    style: const TextStyle(
                        color: _ink, fontWeight: FontWeight.w800)),
                const SizedBox(width: 8),
                _status(item['status']),
              ]),
            )),
    ]);
  }

  Widget _pager() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          Text('Page $_page of $_totalPages',
              style: const TextStyle(color: _muted, fontSize: 12)),
          IconButton(
              onPressed: _page <= 1
                  ? null
                  : () {
                      setState(() => _page--);
                      _load();
                    },
              tooltip: 'Previous page',
              icon: const Icon(Icons.chevron_left)),
          IconButton(
              onPressed: _page >= _totalPages
                  ? null
                  : () {
                      setState(() => _page++);
                      _load();
                    },
              tooltip: 'Next page',
              icon: const Icon(Icons.chevron_right)),
        ]),
      );

  Widget _attachmentView(Map<String, dynamic> attachment) {
    final dataUrl = attachment['dataUrl']?.toString() ?? '';
    final match =
        RegExp(r'^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$')
            .firstMatch(dataUrl);
    if (match == null) return const SizedBox.shrink();
    try {
      final bytes = base64Decode(match.group(2)!);
      if (bytes.length > 256 * 1024) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_value(attachment['name'], 'Attachment'),
              style: const TextStyle(color: _muted, fontSize: 11)),
          const SizedBox(height: 4),
          ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.memory(bytes,
                  height: 150,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink())),
        ]),
      );
    } catch (_) {
      return const SizedBox.shrink();
    }
  }

  Widget _status(dynamic value) {
    final status = _value(value, 'UNKNOWN');
    final normalized = status.toUpperCase();
    final color = const ['ACTIVE', 'NEW', 'RESOLVED', 'SUCCESSFUL', 'CLOSED']
            .contains(normalized)
        ? _green
        : const ['INACTIVE', 'REJECTED', 'FAILED'].contains(normalized)
            ? const Color(0xFFB44D48)
            : const Color(0xFF9B741D);
    return Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
            color: color.withValues(alpha: .1),
            borderRadius: BorderRadius.circular(20)),
        child: Text(status.replaceAll('_', ' '),
            style: TextStyle(
                color: color, fontSize: 10, fontWeight: FontWeight.w800)));
  }

  Widget _detail(String label, String value) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: _muted, fontSize: 10)),
        const SizedBox(height: 2),
        Text(value,
            style: const TextStyle(
                color: _ink, fontSize: 12, fontWeight: FontWeight.w700)),
      ]);

  Widget _phoneActions(String? phone) => Wrap(
        spacing: 5,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(_value(phone),
              style: const TextStyle(color: _ink, fontSize: 12)),
          IconButton(
            tooltip: 'Call customer',
            visualDensity: VisualDensity.compact,
            onPressed: () => _contact(phone, whatsapp: false),
            icon: const Icon(Icons.call_outlined, color: _green, size: 18),
          ),
          IconButton(
            tooltip: 'Message on WhatsApp',
            visualDensity: VisualDensity.compact,
            onPressed: () => _contact(phone, whatsapp: true),
            icon: const Icon(Icons.chat_outlined, color: _green, size: 18),
          ),
        ],
      );

  Widget _errorCard() => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
            color: const Color(0xFFFFF1EF),
            borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          const Icon(Icons.error_outline, color: Color(0xFFB44D48)),
          const SizedBox(width: 9),
          Expanded(child: Text(_error!, style: const TextStyle(color: _ink))),
          TextButton(onPressed: _load, child: const Text('Retry')),
        ]),
      );

  Widget _inlineFormError(String message) => Padding(
        padding: const EdgeInsets.only(top: 7),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            message,
            style: const TextStyle(color: Color(0xFFB44D48), fontSize: 11),
          ),
        ),
      );

  Widget _emptyPanel(String title, String subtitle, IconData icon) => Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(25),
        decoration: _box(),
        child: Column(children: [
          Icon(icon, color: _green, size: 29),
          const SizedBox(height: 8),
          Text(title,
              style: const TextStyle(color: _ink, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: _muted, fontSize: 12)),
        ]),
      );

  InputDecoration _input(String hint, IconData icon) => InputDecoration(
        hintText: hint,
        prefixIcon: Icon(icon, size: 18, color: _muted),
        filled: true,
        fillColor: const Color(0xFFF6F9F7),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: _line)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: _line)),
      );

  BoxDecoration _box() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: _line),
      );

  String _initials(String fullName) => fullName
      .trim()
      .split(RegExp(r'\s+'))
      .take(2)
      .map((part) => part.isEmpty ? '' : part[0].toUpperCase())
      .join();

  String _date(dynamic value) {
    final parsed = DateTime.tryParse('$value');
    if (parsed == null) return '—';
    final d = parsed.toUtc().add(const Duration(hours: 1));
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

class _WorkspaceLoading extends StatelessWidget {
  const _WorkspaceLoading();
  @override
  Widget build(BuildContext context) => Column(
          children: List.generate(
        3,
        (index) => Container(
            height: 80,
            margin: const EdgeInsets.only(top: 10),
            decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .08),
                borderRadius: BorderRadius.circular(12))),
      ));
}
