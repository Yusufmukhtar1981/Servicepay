import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'kyc_screen.dart';
import 'marketplace/marketplace_my_orders_screen.dart';
import 'profile_screen.dart';
import 'solar_screen.dart';
import 'support_tickets_screen.dart';
import 'services/support_api_service.dart';
import 'track_delivery_screen.dart';
import 'transactions_screen.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, this.client, this.supportApi});

  final http.Client? client;
  final SupportApiService? supportApi;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  static const _green = Color(0xFF08783E);
  static const _ink = Color(0xFF15352A);
  static const _categories = <String>[
    'ALL',
    'UNREAD',
    'TRANSACTION',
    'SECURITY',
    'ACCOUNT',
    'OTHER',
  ];
  final _search = TextEditingController();
  final _scroll = ScrollController();
  late final http.Client _client = widget.client ?? http.Client();
  Timer? _debounce;
  List<Map<String, dynamic>> _items = [];
  String _filter = 'ALL';
  String _query = '';
  String? _cursor;
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;
  bool _updating = false;
  String? _error;
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearch);
    _scroll.addListener(_onScroll);
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    if (widget.client == null) _client.close();
    super.dispose();
  }

  void _onSearch() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) {
        setState(() => _query = _search.text.trim());
        _load();
      }
    });
  }

  void _onScroll() {
    if (_scroll.hasClients &&
        _scroll.position.extentAfter < 360 &&
        _hasMore &&
        !_loadingMore) {
      _load(more: true);
    }
  }

  Future<String?> _token() async =>
      (await SharedPreferences.getInstance()).getString('auth_token');

  Future<void> _load({bool more = false}) async {
    if (more && (_loadingMore || !_hasMore)) return;
    if (!more && mounted) {
      setState(() {
        _loading = true;
        _error = null;
        _cursor = null;
      });
    } else if (mounted) {
      setState(() => _loadingMore = true);
    }
    try {
      final token = await _token();
      if (token == null || token.isEmpty) throw const _SessionException();
      final params = <String, String>{'limit': '20'};
      if (more && _cursor != null) params['before'] = _cursor!;
      final category = _filter == 'TRANSACTION' ||
              _filter == 'SECURITY' ||
              _filter == 'ACCOUNT' ||
              _filter == 'OTHER'
          ? _filter
          : null;
      if (category != null) params['category'] = category;
      if (_filter == 'UNREAD') params['unread'] = 'true';
      if (_query.isNotEmpty) params['search'] = _query;
      final response = await _client.get(
          Uri.parse('$_baseUrl/notifications').replace(
            queryParameters: params,
          ),
          headers: {
            'Authorization': 'Bearer $token',
            'Accept': 'application/json'
          }).timeout(const Duration(seconds: 25));
      final decoded = jsonDecode(response.body);
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          decoded is! Map ||
          decoded['success'] != true) {
        throw Exception(decoded is Map ? decoded['message'] : null);
      }
      final raw = decoded['notifications'];
      final incoming = raw is List
          ? raw
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final pagination = decoded['pagination'];
      final next = pagination is Map ? pagination['nextCursor'] : null;
      final has = pagination is Map && pagination['hasMore'] == true;
      if (!mounted) return;
      setState(() {
        _items = more ? [..._items, ...incoming] : incoming;
        _cursor = next?.toString();
        _hasMore = has && _cursor != null && _cursor!.isNotEmpty;
        _unread = _number(decoded['unreadCount']);
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadingMore = false;
        _error =
            'We couldn’t refresh your activity. Check your connection and try again.';
      });
    }
  }

  static int _number(dynamic value) =>
      value is num ? value.toInt() : int.tryParse('$value') ?? 0;

  Future<void> _read(String id) async {
    final index = _items.indexWhere((n) => '${n['_id']}' == id);
    if (index < 0 || _items[index]['isRead'] == true) return;
    final previous = Map<String, dynamic>.from(_items[index]);
    final previousUnread = _unread;
    setState(() {
      _items[index] = {..._items[index], 'isRead': true};
      if (_unread > 0) _unread--;
    });
    try {
      final token = await _token();
      if (token == null || token.isEmpty) return;
      final response = await _client
          .put(Uri.parse('$_baseUrl/notifications/read/$id'), headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/json'
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception();
      }
      final decoded = jsonDecode(response.body);
      if (!mounted || decoded is! Map) return;
      setState(() {
        _unread = _number(decoded['unreadCount']);
      });
    } catch (_) {
      if (!mounted) return;
      final currentIndex = _items.indexWhere((n) => '${n['_id']}' == id);
      setState(() {
        if (currentIndex >= 0) {
          _items[currentIndex] = previous;
        }
        _unread = previousUnread;
      });
      _message('Could not update this notification. Try again.', error: true);
    }
  }

  Future<void> _readAll() async {
    if (_unread == 0 || _updating) return;
    setState(() => _updating = true);
    try {
      final token = await _token();
      if (token == null || token.isEmpty) throw const _SessionException();
      final response = await _client
          .put(Uri.parse('$_baseUrl/notifications/read-all'), headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/json'
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception();
      }
      if (!mounted) return;
      final decoded = jsonDecode(response.body);
      setState(() {
        _items = _items.map((n) => {...n, 'isRead': true}).toList();
        _unread = decoded is Map ? _number(decoded['unreadCount']) : 0;
        _updating = false;
      });
      _message('Everything is up to date.');
    } catch (_) {
      if (mounted) {
        setState(() => _updating = false);
        _message('Could not mark notifications as read.', error: true);
      }
    }
  }

  void _open(Map<String, dynamic> n) {
    final id = n['_id']?.toString();
    if (id != null && id.isNotEmpty) _read(id);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (modalContext) => _detail(n, modalContext),
    );
  }

  Widget _detail(Map<String, dynamic> n, BuildContext modalContext) {
    final action = n['action']?.toString().toUpperCase() ?? '';
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 28),
      decoration: const BoxDecoration(
        color: Color(0xFFF8FCF9),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                  child: Container(
                      width: 38,
                      height: 4,
                      decoration: BoxDecoration(
                          color: const Color(0xFFC8D9CF),
                          borderRadius: BorderRadius.circular(9)))),
              const SizedBox(height: 22),
              Text(n['title']?.toString() ?? 'Activity',
                  style: const TextStyle(
                      fontSize: 22, fontWeight: FontWeight.w800, color: _ink)),
              const SizedBox(height: 10),
              Text(
                  n['message']?.toString() ??
                      'No additional details are available.',
                  style: const TextStyle(
                      fontSize: 16, height: 1.45, color: Color(0xFF53675D))),
              if ((n['reference']?.toString().trim().isNotEmpty ?? false) ||
                  (n['referenceId']?.toString().trim().isNotEmpty ??
                      false)) ...[
                const SizedBox(height: 14),
                Text(
                    'Reference  ${n['reference']?.toString().trim().isNotEmpty == true ? n['reference'] : n['referenceId']}',
                    style: const TextStyle(
                        fontSize: 12, color: Color(0xFF71857A))),
              ],
              if (_destination(n) != null) ...[
                const SizedBox(height: 22),
                SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.pop(modalContext);
                        Navigator.push(
                            context,
                            MaterialPageRoute<void>(
                                builder: (_) => _destination(n)!));
                      },
                      icon: const Icon(Icons.arrow_forward_rounded),
                      label: Text(_actionLabel(action)),
                    )),
              ],
            ]),
      ),
    );
  }

  Widget? _destination(Map<String, dynamic> notification) {
    final action = notification['action']?.toString().toUpperCase() ?? '';
    switch (action) {
      case 'TRANSACTION':
        return const TransactionsScreen();
      case 'KYC':
        return const KycScreen();
      case 'SECURITY':
      case 'ACCOUNT':
        return const ProfileScreen();
      case 'DELIVERY':
        return const TrackDeliveryScreen();
      case 'MARKETPLACE':
        return const MarketplaceMyOrdersScreen();
      case 'SOLAR':
        return const SolarScreen();
      case 'SUPPORT':
        final ticketId = notification['referenceId']?.toString() ?? '';
        return ticketId.isEmpty
            ? const SupportTicketsScreen()
            : SupportTicketDetailScreen(
                ticketId: ticketId,
                api: widget.supportApi,
              );
      default:
        return null;
    }
  }

  String _actionLabel(String action) {
    if (action == 'TRANSACTION') return 'Open transactions';
    if (action == 'SUPPORT') return 'Open support ticket';
    return 'Open ${action.toLowerCase()}';
  }

  void _message(String text, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      backgroundColor: error ? const Color(0xFFB33A35) : _green,
      behavior: SnackBarBehavior.floating,
    ));
  }

  String _time(dynamic raw) {
    final date = DateTime.tryParse('$raw')?.toLocal();
    if (date == null) return 'Recently';
    final now = DateTime.now();
    if (now.difference(date).inHours < 24) {
      final hours = now.difference(date).inHours;
      return hours == 0 ? 'Just now' : '${hours}h ago';
    }
    return '${date.day}/${date.month}/${date.year}';
  }

  IconData _icon(String type) {
    final t = type.toUpperCase();
    if (t.contains('SECURITY') || t.contains('LOGIN')) {
      return Icons.shield_outlined;
    }
    if (t.contains('DELIVERY')) return Icons.local_shipping_outlined;
    if (t.contains('KYC') || t.contains('VERIFY')) {
      return Icons.verified_user_outlined;
    }
    if (t.contains('SOLAR')) return Icons.wb_sunny_outlined;
    if (t.contains('PHONE')) return Icons.phone_android_outlined;
    if (t.contains('SUPPORT')) return Icons.support_agent_outlined;
    if (t.contains('TRANSACTION') || t.contains('TRANSFER')) {
      return Icons.swap_horiz_rounded;
    }
    return Icons.notifications_none_rounded;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<int>(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, int? result) {
        if (!didPop) {
          Navigator.pop(context, _unread);
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF2F8F4),
        appBar: AppBar(
          backgroundColor: const Color(0xFFF2F8F4),
          elevation: 0,
          title: const Text('Activity center',
              style: TextStyle(color: _ink, fontWeight: FontWeight.w800)),
          actions: [
            if (_unread > 0)
              TextButton(
                  onPressed: _updating ? null : _readAll,
                  child: const Text('Read all')),
            PopupMenuButton<String>(
                onSelected: (v) => v == 'read' ? _readAll() : null,
                itemBuilder: (_) => const [
                      PopupMenuItem(
                          value: 'read', child: Text('Mark all as read')),
                    ]),
          ],
        ),
        body: LayoutBuilder(builder: (context, constraints) {
          final wide = constraints.maxWidth >= 700;
          final content = Column(children: [
            _header(),
            _tabs(),
            Expanded(child: _body()),
          ]);
          return Center(
              child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: wide ? 900 : double.infinity),
            child: content,
          ));
        }),
      ),
    );
  }

  Widget _header() => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
              _unread == 0 ? 'You’re all caught up' : '$_unread unread updates',
              style: const TextStyle(
                  fontSize: 14, color: _green, fontWeight: FontWeight.w700)),
          const SizedBox(height: 14),
          TextField(
            controller: _search,
            decoration: InputDecoration(
              hintText: 'Search your activity',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      onPressed: _search.clear,
                      icon: const Icon(Icons.close_rounded)),
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none),
            ),
          ),
        ]),
      );

  Widget _tabs() => SizedBox(
        height: 48,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          scrollDirection: Axis.horizontal,
          itemCount: _categories.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final value = _categories[i];
            final selected = value == _filter;
            return ChoiceChip(
              label: Text(value == 'ACCOUNT'
                  ? 'Account & KYC'
                  : value[0] + value.substring(1).toLowerCase()),
              selected: selected,
              onSelected: (_) {
                setState(() => _filter = value);
                _load();
              },
              selectedColor: _green,
              labelStyle: TextStyle(
                  color: selected ? Colors.white : _ink,
                  fontWeight: FontWeight.w700),
              backgroundColor: Colors.white,
              side: BorderSide.none,
            );
          },
        ),
      );

  Widget _body() {
    if (_loading) {
      return _skeleton();
    }
    if (_error != null) {
      return _state(Icons.cloud_off_outlined,
          'Activity is temporarily unavailable', _error!, 'Try again', _load);
    }
    if (_items.isEmpty) {
      return _state(
          Icons.inbox_outlined,
          _query.isEmpty ? 'Nothing here yet' : 'No matching activity',
          _query.isEmpty
              ? 'Important updates about your money and account will appear here.'
              : 'Try a different search or view.',
          'Refresh',
          _load);
    }
    return RefreshIndicator(
      color: _green,
      onRefresh: () => _load(),
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
        itemCount: _items.length + (_loadingMore ? 1 : 0),
        itemBuilder: (_, i) =>
            i == _items.length ? const _LoadingRow() : _card(_items[i]),
      ),
    );
  }

  Widget _card(Map<String, dynamic> n) {
    final read = n['isRead'] == true;
    return Semantics(
      button: true,
      label: '${n['title'] ?? 'Activity'}. ${read ? 'Read' : 'Unread'}',
      child: Card(
        margin: const EdgeInsets.only(bottom: 10),
        elevation: 0,
        color: read ? Colors.white : const Color(0xFFE3F3E8),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(
                color:
                    read ? const Color(0xFFE2ECE5) : const Color(0xFFB8DEC4))),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _open(n),
          child: Padding(
              padding: const EdgeInsets.all(16),
              child:
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                        color: _green.withValues(alpha: .1),
                        borderRadius: BorderRadius.circular(14)),
                    child: Icon(_icon('${n['type']}'), color: _green)),
                const SizedBox(width: 13),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Row(children: [
                        Expanded(
                            child: Text(n['title']?.toString() ?? 'Activity',
                                style: TextStyle(
                                    fontWeight: read
                                        ? FontWeight.w600
                                        : FontWeight.w800,
                                    color: _ink))),
                        Text(_time(n['createdAt']),
                            style: const TextStyle(
                                fontSize: 11, color: Color(0xFF71857A))),
                      ]),
                      const SizedBox(height: 6),
                      Text(n['message']?.toString() ?? '',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              height: 1.35, color: Color(0xFF53675D))),
                      if (!read) ...[
                        const SizedBox(height: 9),
                        const Text('NEW',
                            style: TextStyle(
                                fontSize: 10,
                                letterSpacing: 1.2,
                                color: _green,
                                fontWeight: FontWeight.w900))
                      ],
                    ])),
              ])),
        ),
      ),
    );
  }

  Widget _state(IconData icon, String title, String body, String action,
          VoidCallback onTap) =>
      ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(32),
        children: [
          const SizedBox(height: 70),
          Icon(icon, size: 52, color: Color(0xFF79A58A)),
          const SizedBox(height: 18),
          Text(title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 20, fontWeight: FontWeight.w800, color: _ink)),
          const SizedBox(height: 8),
          Text(body,
              textAlign: TextAlign.center,
              style: const TextStyle(height: 1.4, color: Color(0xFF61776B))),
          const SizedBox(height: 22),
          Center(child: OutlinedButton(onPressed: onTap, child: Text(action)))
        ],
      );

  Widget _skeleton() => ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: List.generate(5, (_) => const _LoadingRow()),
      );
}

class _LoadingRow extends StatelessWidget {
  const _LoadingRow();
  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        elevation: 0,
        color: Colors.white,
        child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(children: [
              Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                      color: const Color(0xFFE1EEE5),
                      borderRadius: BorderRadius.circular(14))),
              const SizedBox(width: 14),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Container(
                        height: 13, width: 170, color: const Color(0xFFE1EEE5)),
                    const SizedBox(height: 10),
                    Container(
                        height: 11,
                        width: double.infinity,
                        color: const Color(0xFFEAF2EC)),
                    const SizedBox(height: 6),
                    Container(
                        height: 11, width: 220, color: const Color(0xFFEAF2EC)),
                  ])),
            ])),
      );
}

class _SessionException implements Exception {
  const _SessionException();
}
