import 'package:flutter/material.dart';

import 'branch_counter_api.dart';
import 'branch_counter_screen.dart';

/// Counter-focused entry point into the existing branch parcel workflow.
class BranchDeliveryDashboardSection extends StatefulWidget {
  const BranchDeliveryDashboardSection({
    super.key,
    required this.api,
  });

  final BranchCounterApi? api;

  @override
  State<BranchDeliveryDashboardSection> createState() =>
      _BranchDeliveryDashboardSectionState();
}

class _BranchDeliveryDashboardSectionState
    extends State<BranchDeliveryDashboardSection> {
  static const Color _forest = Color(0xff0b4438);
  static const Color _green = Color(0xff087f5b);
  static const Color _line = Color(0xffdce8e1);

  late final BranchCounterApi _api = widget.api ?? BranchCounterHttpApi();
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  int? _count(String key) {
    final dynamic value = _stats?[key];
    if (value is num) return value.toInt();
    return value == null ? null : int.tryParse('$value');
  }

  String _money(int? value) {
    if (value == null) return '—';
    final String raw = value.toString();
    return '₦${raw.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',')}';
  }

  Future<void> _loadStats() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final Map<String, dynamic> response = await _api.listOrders(
        status: 'ALL',
        search: '',
        page: 1,
      );
      if (!mounted) return;
      final dynamic stats = response['stats'];
      setState(() {
        _stats = stats is Map ? Map<String, dynamic>.from(stats) : null;
        _loading = false;
        _error = _stats == null ? 'Delivery stats are not available.' : null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _stats = null;
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _open(String? initialAction) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => BranchCounterScreen(
          api: widget.api,
          initialAction: initialAction,
        ),
      ),
    );
    if (mounted) await _loadStats();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('branch-delivery-dashboard-section'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xfff0f7f3),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: _line),
      ),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints bounds) {
          final bool wide = bounds.maxWidth >= 720;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: _forest,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Icon(Icons.local_shipping_outlined,
                        color: Colors.white),
                  ),
                  const SizedBox(width: 11),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'DELIVERY & LOGISTICS',
                          style: TextStyle(
                            color: _forest,
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .55,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Parcel counter · branch operations',
                          style:
                              TextStyle(color: Color(0xff59736a), fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Refresh delivery stats',
                    onPressed: _loading ? null : _loadStats,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (wide)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(child: _primaryButton()),
                    const SizedBox(width: 14),
                    Expanded(child: _actions(wide: wide)),
                  ],
                )
              else ...<Widget>[
                SizedBox(width: double.infinity, child: _primaryButton()),
                const SizedBox(height: 9),
                _actions(wide: wide),
              ],
              const SizedBox(height: 14),
              if (_error != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xfffff3e8),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: <Widget>[
                      const Icon(Icons.info_outline,
                          size: 17, color: Color(0xff8a4b12)),
                      const SizedBox(width: 7),
                      Expanded(
                        child:
                            Text(_error!, style: const TextStyle(fontSize: 12)),
                      ),
                      TextButton(
                        onPressed: _loading ? null : _loadStats,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: <Widget>[
                    _metric('Today’s orders',
                        _loading ? '…' : '${_count('todayOrders') ?? '—'}'),
                    _metric('Pending pickup',
                        _loading ? '…' : '${_count('pendingPickup') ?? '—'}'),
                    _metric('In transit',
                        _loading ? '…' : '${_count('inTransit') ?? '—'}'),
                    _metric('Delivered',
                        _loading ? '…' : '${_count('delivered') ?? '—'}'),
                    _metric('Today’s revenue',
                        _loading ? '…' : _money(_count('todayRevenue'))),
                  ],
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _primaryButton() => ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 54),
        child: FilledButton.icon(
          key: const Key('branch-delivery-create'),
          onPressed: () => _open('create'),
          icon: const Icon(Icons.add_rounded),
          label: const Text(
            'CREATE DELIVERY ORDER',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900),
          ),
          style: FilledButton.styleFrom(
            backgroundColor: _green,
            foregroundColor: Colors.white,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
          ),
        ),
      );

  Widget _actions({required bool wide}) {
    final List<Widget> items = <Widget>[
      _action('View Orders', Icons.receipt_long_outlined, null),
      _action('Search / Track Order', Icons.search_rounded, 'search'),
      _action('Print / Reprint Receipt', Icons.print_outlined, 'print'),
    ];
    if (wide) {
      return Wrap(spacing: 7, runSpacing: 7, children: items);
    }
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints bounds) {
        final double halfWidth = (bounds.maxWidth - 8) / 2;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            SizedBox(width: halfWidth, child: items[0]),
            SizedBox(width: halfWidth, child: items[1]),
            SizedBox(width: bounds.maxWidth, child: items[2]),
          ],
        );
      },
    );
  }

  Widget _action(String label, IconData icon, String? initialAction) =>
      OutlinedButton.icon(
        key: Key('branch-delivery-action-${initialAction ?? 'orders'}'),
        onPressed: () => _open(initialAction),
        icon: Icon(icon, size: 17),
        label: Text(label, textAlign: TextAlign.center),
        style: OutlinedButton.styleFrom(
          foregroundColor: _forest,
          side: const BorderSide(color: _line),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
          textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
        ),
      );

  Widget _metric(String label, String value) => Container(
        constraints: const BoxConstraints(minWidth: 92),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: _line),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(value,
                style: const TextStyle(
                    color: _forest, fontWeight: FontWeight.w900, fontSize: 15)),
            const SizedBox(height: 2),
            Text(label,
                style: const TextStyle(
                    color: Color(0xff60766d),
                    fontSize: 10,
                    fontWeight: FontWeight.w700)),
          ],
        ),
      );
}
