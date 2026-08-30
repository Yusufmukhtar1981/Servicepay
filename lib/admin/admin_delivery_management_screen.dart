import 'package:flutter/material.dart';

import 'admin_delivery_api.dart';

class AdminDeliveryManagementScreen extends StatefulWidget {
  const AdminDeliveryManagementScreen({
    super.key,
    this.api,
  });

  final AdminDeliveryApiClient? api;

  @override
  State<AdminDeliveryManagementScreen> createState() =>
      _AdminDeliveryManagementScreenState();
}

class _AdminDeliveryManagementScreenState
    extends State<AdminDeliveryManagementScreen> {
  late final AdminDeliveryApiClient _api;
  final List<String> _statuses = const <String>[
    'PENDING',
    'ASSIGNED',
    'ACCEPTED',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED',
  ];
  List<Map<String, dynamic>> _deliveries = <Map<String, dynamic>>[];
  String _status = 'PENDING';
  String _error = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? AdminDeliveryApi();
    _loadDeliveries();
  }

  String _text(dynamic value, {String fallback = ''}) {
    final String result = value?.toString().trim() ?? '';
    return result.isEmpty ? fallback : result;
  }

  Map<String, dynamic> _map(dynamic value) => AdminDeliveryApi.mapFrom(value);

  Future<void> _loadDeliveries() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }
    try {
      final List<Map<String, dynamic>> deliveries =
          await _api.getDeliveries(status: _status);
      if (!mounted) return;
      setState(() {
        _deliveries = deliveries;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _openAssignment(Map<String, dynamic> delivery) async {
    final Map<String, dynamic>? assigned =
        await showDialog<Map<String, dynamic>>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext context) => AssignDeliveryRiderDialog(
        api: _api,
        delivery: delivery,
      ),
    );
    if (assigned == null || !mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text('Rider assigned successfully.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    await _loadDeliveries();
  }

  Widget _messageState({
    required IconData icon,
    required String title,
    String? message,
    VoidCallback? onRetry,
  }) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 52, color: const Color(0xFF0F766E)),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (message?.isNotEmpty == true) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF64748B)),
              ),
            ],
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 20),
              FilledButton.icon(
                key: const Key('delivery-list-retry'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _deliveryCard(Map<String, dynamic> delivery) {
    final Map<String, dynamic> customer = _map(delivery['customerId']);
    final Map<String, dynamic> rider = _map(delivery['assignedRiderId']);
    final String status = _text(delivery['status'], fallback: 'PENDING');
    final String deliveryId = _text(delivery['_id'] ?? delivery['id']);
    final bool canAssign =
        deliveryId.isNotEmpty && status == 'PENDING' && rider.isEmpty;
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    _text(
                      delivery['trackingNumber'],
                      fallback: 'Delivery',
                    ),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Chip(
                  label: Text(status.replaceAll('_', ' ')),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 12),
            _DeliveryLine(
              icon: Icons.person_outline,
              text: _text(
                customer['fullName'] ?? customer['name'],
                fallback: _text(delivery['senderName'], fallback: 'Customer'),
              ),
            ),
            _DeliveryLine(
              icon: Icons.trip_origin,
              text: _text(delivery['pickupAddress'], fallback: 'No pickup'),
            ),
            _DeliveryLine(
              icon: Icons.location_on_outlined,
              text: _text(
                delivery['deliveryAddress'],
                fallback: 'No destination',
              ),
            ),
            if (rider.isNotEmpty || _text(delivery['riderName']).isNotEmpty)
              _DeliveryLine(
                icon: Icons.delivery_dining,
                text: _text(
                  rider['fullName'],
                  fallback: _text(delivery['riderName'], fallback: 'Rider'),
                ),
              ),
            if (canAssign) ...<Widget>[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: Key('assign-rider-$deliveryId'),
                  onPressed: () => _openAssignment(delivery),
                  icon: const Icon(Icons.delivery_dining),
                  label: const Text('Assign Rider'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('Delivery Management'),
        backgroundColor: const Color(0xFF0F766E),
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh deliveries',
            onPressed: _loading ? null : _loadDeliveries,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: DropdownButtonFormField<String>(
              key: const Key('delivery-status-filter'),
              value: _status,
              decoration: const InputDecoration(
                labelText: 'Delivery status',
                border: OutlineInputBorder(),
                filled: true,
                fillColor: Colors.white,
              ),
              items: _statuses
                  .map(
                    (String status) => DropdownMenuItem<String>(
                      value: status,
                      child: Text(status.replaceAll('_', ' ')),
                    ),
                  )
                  .toList(),
              onChanged: _loading
                  ? null
                  : (String? value) {
                      if (value == null || value == _status) return;
                      setState(() {
                        _status = value;
                      });
                      _loadDeliveries();
                    },
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error.isNotEmpty
                    ? _messageState(
                        icon: Icons.cloud_off_outlined,
                        title: 'Unable to load deliveries',
                        message: _error,
                        onRetry: _loadDeliveries,
                      )
                    : _deliveries.isEmpty
                        ? _messageState(
                            icon: Icons.inventory_2_outlined,
                            title: 'No ${_status.toLowerCase()} deliveries',
                          )
                        : RefreshIndicator(
                            onRefresh: _loadDeliveries,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                              itemCount: _deliveries.length,
                              itemBuilder: (BuildContext context, int index) =>
                                  _deliveryCard(_deliveries[index]),
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class AssignDeliveryRiderDialog extends StatefulWidget {
  const AssignDeliveryRiderDialog({
    super.key,
    required this.api,
    required this.delivery,
  });

  final AdminDeliveryApiClient api;
  final Map<String, dynamic> delivery;

  @override
  State<AssignDeliveryRiderDialog> createState() =>
      _AssignDeliveryRiderDialogState();
}

class _AssignDeliveryRiderDialogState extends State<AssignDeliveryRiderDialog> {
  List<Map<String, dynamic>> _riders = <Map<String, dynamic>>[];
  String? _selectedRiderId;
  String _error = '';
  bool _loading = true;
  bool _assigning = false;

  String get _deliveryId =>
      (widget.delivery['_id'] ?? widget.delivery['id'])?.toString().trim() ??
      '';

  @override
  void initState() {
    super.initState();
    _loadRiders();
  }

  Future<void> _loadRiders() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final List<Map<String, dynamic>> riders =
          await widget.api.getAvailableRiders(_deliveryId);
      if (!mounted) return;
      setState(() {
        _riders = riders;
        if (!_riders.any(
          (Map<String, dynamic> rider) =>
              (rider['_id'] ?? rider['id'])?.toString() == _selectedRiderId,
        )) {
          _selectedRiderId = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _assign() async {
    final String riderId = _selectedRiderId ?? '';
    if (_assigning || riderId.isEmpty) return;
    setState(() {
      _assigning = true;
      _error = '';
    });
    try {
      final Map<String, dynamic> delivery = await widget.api.assignRider(
        deliveryId: _deliveryId,
        riderId: riderId,
      );
      if (!mounted) return;
      Navigator.of(context).pop(delivery);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _assigning = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Assign Delivery Rider'),
      content: SizedBox(
        width: 520,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 480),
          child: _loading
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(28),
                    child: CircularProgressIndicator(),
                  ),
                )
              : _error.isNotEmpty && _riders.isEmpty
                  ? Column(
                      key: const Key('rider-load-error'),
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        const Icon(
                          Icons.cloud_off_outlined,
                          size: 42,
                          color: Color(0xFF0F766E),
                        ),
                        const SizedBox(height: 12),
                        Text(_error, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          key: const Key('rider-load-retry'),
                          onPressed: _loadRiders,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    )
                  : _riders.isEmpty
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Text(
                              'No verified online riders are available right now.',
                              textAlign: TextAlign.center,
                            ),
                          ),
                        )
                      : ListView(
                          shrinkWrap: true,
                          children: <Widget>[
                            if (_error.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: Text(
                                  _error,
                                  style: const TextStyle(color: Colors.red),
                                ),
                              ),
                            ..._riders.map((Map<String, dynamic> rider) {
                              final String id =
                                  (rider['_id'] ?? rider['id'])?.toString() ??
                                      '';
                              final String name =
                                  rider['fullName']?.toString().trim() ?? '';
                              final String riderCode =
                                  rider['riderId']?.toString().trim() ?? '';
                              final String vehicle =
                                  rider['vehicleType']?.toString().trim() ?? '';
                              return RadioListTile<String>(
                                key: Key('available-rider-$id'),
                                value: id,
                                groupValue: _selectedRiderId,
                                onChanged: _assigning
                                    ? null
                                    : (String? value) {
                                        setState(() {
                                          _selectedRiderId = value;
                                        });
                                      },
                                title: Text(
                                  name.isEmpty ? 'Delivery Rider' : name,
                                ),
                                subtitle: Text(
                                  <String>[riderCode, vehicle]
                                      .where((String item) => item.isNotEmpty)
                                      .join(' • '),
                                ),
                              );
                            }),
                          ],
                        ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _assigning ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('confirm-rider-assignment'),
          onPressed: _selectedRiderId == null || _assigning ? null : _assign,
          child: _assigning
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Assign Rider'),
        ),
      ],
    );
  }
}

class _DeliveryLine extends StatelessWidget {
  const _DeliveryLine({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: const Color(0xFF64748B)),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
