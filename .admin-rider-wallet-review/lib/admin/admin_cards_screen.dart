import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminCardsScreen extends StatefulWidget {
  const AdminCardsScreen({super.key});

  @override
  State<AdminCardsScreen> createState() => _AdminCardsScreenState();
}

class _AdminCardsScreenState extends State<AdminCardsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool loading = true;
  String error = '';
  String filter = 'ALL';

  List<Map<String, dynamic>> cards = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    loadCards();
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token') ?? '';
  }

  Map<String, String> _headers(String token) {
    return <String, String>{
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  Future<void> loadCards() async {
    if (mounted) {
      setState(() {
        loading = true;
        error = '';
      });
    }

    try {
      final token = await _token();

      if (token.isEmpty) {
        throw Exception('Admin authentication token not found.');
      }

      final response = await http
          .get(
            Uri.parse('$baseUrl/admin/cards'),
            headers: _headers(token),
          )
          .timeout(const Duration(seconds: 30));

      final dynamic decoded = response.body.isNotEmpty
          ? jsonDecode(response.body)
          : <String, dynamic>{};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        String message = 'Unable to load cards.';
        if (decoded is Map) {
          message = decoded['message']?.toString() ??
              decoded['error']?.toString() ??
              message;
        }
        throw Exception(message);
      }

      List<dynamic> raw = <dynamic>[];

      if (decoded is List) {
        raw = decoded;
      } else if (decoded is Map) {
        final dynamic candidate =
            decoded['cards'] ?? decoded['data'] ?? decoded['requests'];

        if (candidate is List) {
          raw = candidate;
        } else if (candidate is Map && candidate['cards'] is List) {
          raw = candidate['cards'] as List<dynamic>;
        }
      }

      cards = raw
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

      if (mounted) {
        setState(() {
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          loading = false;
          error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  Future<void> updateStatus(
    Map<String, dynamic> card,
    String status,
  ) async {
    final String id = (card['_id'] ?? card['id'] ?? '').toString();

    if (id.isEmpty) {
      _showMessage('Card ID not found.', error: true);
      return;
    }

    try {
      final token = await _token();

      final response = await http
          .patch(
            Uri.parse('$baseUrl/admin/cards/$id/status'),
            headers: _headers(token),
            body: jsonEncode(<String, dynamic>{
              'status': status,
            }),
          )
          .timeout(const Duration(seconds: 30));

      dynamic decoded;
      try {
        decoded = response.body.isNotEmpty
            ? jsonDecode(response.body)
            : <String, dynamic>{};
      } catch (_) {
        decoded = <String, dynamic>{};
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        String message = 'Unable to update card.';
        if (decoded is Map) {
          message = decoded['message']?.toString() ??
              decoded['error']?.toString() ??
              message;
        }
        throw Exception(message);
      }

      _showMessage(
        status == 'APPROVED'
            ? 'Card request approved successfully.'
            : status == 'REJECTED'
                ? 'Card request rejected.'
                : 'Card status updated.',
      );

      await loadCards();
    } catch (e) {
      _showMessage(
        e.toString().replaceFirst('Exception: ', ''),
        error: true,
      );
    }
  }

  void _showMessage(String message, {bool error = false}) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  String _value(
    Map<String, dynamic> card,
    List<String> keys, {
    String fallback = '—',
  }) {
    for (final key in keys) {
      final dynamic v = card[key];
      if (v != null && v.toString().trim().isNotEmpty) {
        return v.toString().trim();
      }
    }
    return fallback;
  }

  String _cardType(Map<String, dynamic> card) {
    return _value(
      card,
      <String>['cardType', 'type'],
      fallback: 'CARD',
    ).toUpperCase();
  }

  String _status(Map<String, dynamic> card) {
    return _value(
      card,
      <String>['status'],
      fallback: 'PENDING',
    ).toUpperCase();
  }

  String _customerName(Map<String, dynamic> card) {
    final dynamic user = card['user'];

    if (user is Map) {
      final map = Map<String, dynamic>.from(user);

      return _value(
        map,
        <String>['fullName', 'name'],
        fallback: 'ServicePay Customer',
      );
    }

    return _value(
      card,
      <String>[
        'customerName',
        'fullName',
        'name',
        'cardHolderName',
      ],
      fallback: 'ServicePay Customer',
    );
  }

  String _customerPhone(Map<String, dynamic> card) {
    final dynamic user = card['user'];

    if (user is Map) {
      final map = Map<String, dynamic>.from(user);
      return _value(
        map,
        <String>['phone', 'phoneNumber'],
      );
    }

    return _value(
      card,
      <String>['phone', 'phoneNumber'],
    );
  }

  List<Map<String, dynamic>> get visibleCards {
    if (filter == 'ALL') {
      return cards;
    }

    return cards.where((card) => _status(card) == filter).toList();
  }

  int countStatus(String status) {
    return cards.where((card) => _status(card) == status).length;
  }

  Color statusColor(String status) {
    switch (status) {
      case 'APPROVED':
      case 'ACTIVE':
        return const Color(0xFF08783E);
      case 'REJECTED':
      case 'BLOCKED':
        return Colors.red.shade700;
      case 'FROZEN':
        return Colors.blueGrey;
      default:
        return Colors.orange.shade800;
    }
  }

  Widget summaryCard(
    String title,
    String value,
    IconData icon,
  ) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: const Color(0xFFE8ECEA),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              icon,
              color: const Color(0xFF08783E),
            ),
            const SizedBox(height: 12),
            Text(
              value,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFF6B7280),
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget filterChip(String value) {
    final selected = filter == value;

    return ChoiceChip(
      label: Text(value),
      selected: selected,
      onSelected: (_) {
        setState(() {
          filter = value;
        });
      },
    );
  }

  Widget buildCardItem(Map<String, dynamic> card) {
    final String type = _cardType(card);
    final String status = _status(card);
    final String address = _value(
      card,
      <String>[
        'deliveryAddress',
        'address',
        'delivery_address',
      ],
    );

    final String createdAt = _value(
      card,
      <String>['createdAt', 'requestedAt'],
    );

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  type == 'VIRTUAL'
                      ? Icons.phone_android_rounded
                      : Icons.credit_card_rounded,
                  color: const Color(0xFF08783E),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      _customerName(card),
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '$type CARD',
                      style: const TextStyle(
                        color: Color(0xFF6B7280),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: statusColor(status).withValues(
                    alpha: 0.10,
                  ),
                  borderRadius: BorderRadius.circular(30),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color: statusColor(status),
                    fontWeight: FontWeight.w700,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 14),
          Text(
            'Phone: ${_customerPhone(card)}',
          ),
          if (type == 'PHYSICAL') ...<Widget>[
            const SizedBox(height: 6),
            Text(
              'Delivery Address: $address',
            ),
          ],
          const SizedBox(height: 6),
          Text(
            'Requested: $createdAt',
            style: const TextStyle(
              color: Color(0xFF6B7280),
              fontSize: 12,
            ),
          ),
          if (status == 'PENDING') ...<Widget>[
            const SizedBox(height: 16),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => updateStatus(
                      card,
                      'REJECTED',
                    ),
                    icon: const Icon(
                      Icons.close_rounded,
                    ),
                    label: const Text('Reject'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => updateStatus(
                      card,
                      'APPROVED',
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF08783E),
                    ),
                    icon: const Icon(
                      Icons.check_rounded,
                    ),
                    label: const Text('Approve'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Cards Management',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: <Widget>[
          IconButton(
            onPressed: loadCards,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadCards,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: <Color>[
                    Color(0xFF075E35),
                    Color(0xFF16A765),
                  ],
                ),
                borderRadius: BorderRadius.circular(22),
              ),
              child: const Row(
                children: <Widget>[
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: Colors.white24,
                    child: Icon(
                      Icons.credit_card_rounded,
                      color: Colors.white,
                      size: 28,
                    ),
                  ),
                  SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'ServicePay Cards',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 20,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Manage Physical and Virtual Card requests.',
                          style: TextStyle(
                            color: Colors.white70,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: <Widget>[
                summaryCard(
                  'Total Cards',
                  cards.length.toString(),
                  Icons.credit_card_rounded,
                ),
                const SizedBox(width: 10),
                summaryCard(
                  'Pending',
                  countStatus('PENDING').toString(),
                  Icons.pending_actions_rounded,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                summaryCard(
                  'Approved',
                  countStatus('APPROVED').toString(),
                  Icons.verified_rounded,
                ),
                const SizedBox(width: 10),
                summaryCard(
                  'Rejected',
                  countStatus('REJECTED').toString(),
                  Icons.cancel_rounded,
                ),
              ],
            ),
            const SizedBox(height: 20),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: <Widget>[
                  filterChip('ALL'),
                  const SizedBox(width: 8),
                  filterChip('PENDING'),
                  const SizedBox(width: 8),
                  filterChip('APPROVED'),
                  const SizedBox(width: 8),
                  filterChip('REJECTED'),
                  const SizedBox(width: 8),
                  filterChip('ACTIVE'),
                ],
              ),
            ),
            const SizedBox(height: 18),
            if (loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                  child: CircularProgressIndicator(),
                ),
              )
            else if (error.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: <Widget>[
                    const Icon(
                      Icons.error_outline_rounded,
                      size: 42,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      error,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: loadCards,
                      child: const Text('Try Again'),
                    ),
                  ],
                ),
              )
            else if (visibleCards.isEmpty)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Column(
                  children: <Widget>[
                    Icon(
                      Icons.credit_card_off_rounded,
                      size: 50,
                      color: Color(0xFF9CA3AF),
                    ),
                    SizedBox(height: 12),
                    Text(
                      'No card requests found',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              )
            else
              ...visibleCards.map(buildCardItem),
          ],
        ),
      ),
    );
  }
}
