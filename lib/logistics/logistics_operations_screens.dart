import 'package:flutter/material.dart';

import 'logistics_api.dart';
import 'admin_logistics_setup_screen.dart';

String logisticsText(dynamic value, [String fallback = '—']) {
  final String text = '${value ?? ''}'.trim();
  return text.isEmpty ? fallback : text;
}

class AdminLogisticsScreen extends StatelessWidget {
  const AdminLogisticsScreen({super.key, this.api});
  final LogisticsApi? api;

  @override
  Widget build(BuildContext context) => _LogisticsTabs(
        title: 'Interstate Logistics',
        scope: 'admin',
        api: api,
        tabs: const <_LogisticsTab>[
          _LogisticsTab('Overview', 'overview', Icons.insights_outlined),
          _LogisticsTab('Shipments', 'shipments', Icons.inventory_2_outlined),
          _LogisticsTab('Routes & pricing', 'routes', Icons.route_outlined),
          _LogisticsTab('Trips', 'trips', Icons.departure_board_outlined),
          _LogisticsTab('Drivers', 'drivers', Icons.badge_outlined),
          _LogisticsTab('Vehicles', 'vehicles', Icons.airport_shuttle_outlined),
          _LogisticsTab(
              'Exceptions', 'exceptions', Icons.warning_amber_outlined),
          _LogisticsTab('Returns', 'returns', Icons.assignment_return_outlined),
        ],
      );
}

class BranchLogisticsScreen extends StatelessWidget {
  const BranchLogisticsScreen({super.key, this.api});
  final LogisticsApi? api;
  @override
  Widget build(BuildContext context) => _LogisticsTabs(
        title: 'Interstate Logistics',
        scope: 'branch',
        api: api,
        actionScope: true,
        tabs: const <_LogisticsTab>[
          _LogisticsTab(
              'Awaiting pickup', 'shipments', Icons.person_search_outlined,
              status: 'AWAITING_PICKUP'),
          _LogisticsTab(
              'Incoming hub', 'shipments', Icons.move_to_inbox_outlined,
              status: 'PICKED_UP'),
          _LogisticsTab('Verification', 'shipments', Icons.fact_check_outlined,
              status: 'RECEIVED_AT_ORIGIN_HUB'),
          _LogisticsTab(
              'Ready dispatch', 'shipments', Icons.local_shipping_outlined,
              status: 'READY_FOR_INTERSTATE_DISPATCH'),
          _LogisticsTab('In transit', 'shipments', Icons.route_outlined,
              status: 'IN_TRANSIT'),
          _LogisticsTab('Arrivals', 'shipments', Icons.move_to_inbox_outlined,
              status: 'ARRIVED_AT_DESTINATION_HUB'),
          _LogisticsTab('Last mile', 'shipments', Icons.two_wheeler_outlined,
              status: 'DESTINATION_HUB_VERIFIED'),
          _LogisticsTab('Collection', 'shipments', Icons.storefront_outlined,
              status: 'READY_FOR_COLLECTION'),
          _LogisticsTab(
              'Delivery exceptions', 'shipments', Icons.warning_amber_outlined,
              status: 'FAILED_DELIVERY'),
          _LogisticsTab(
              'Returns', 'shipments', Icons.assignment_return_outlined,
              status: 'RETURN_INITIATED'),
          _LogisticsTab('Completed', 'shipments', Icons.task_alt_outlined,
              status: 'DELIVERED'),
        ],
      );
}

class _LogisticsTab {
  const _LogisticsTab(this.label, this.resource, this.icon, {this.status});
  final String label;
  final String resource;
  final IconData icon;
  final String? status;
}

class _LogisticsTabs extends StatelessWidget {
  const _LogisticsTabs(
      {required this.title,
      required this.scope,
      required this.tabs,
      this.api,
      this.actionScope = false});
  final String title;
  final String scope;
  final List<_LogisticsTab> tabs;
  final LogisticsApi? api;
  final bool actionScope;

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: tabs.length,
        child: Scaffold(
          appBar: AppBar(
              title: Text(title),
              bottom: TabBar(
                  isScrollable: true,
                  tabs: tabs
                      .map((t) => Tab(text: t.label, icon: Icon(t.icon)))
                      .toList())),
          body: TabBarView(
              children: tabs
                  .map((tab) => tab.resource == 'overview'
                      ? _OverviewPanel(api: api ?? LogisticsApi())
                      : scope == 'admin' &&
                              <String>{
                                'routes',
                                'drivers',
                                'vehicles',
                                'trips',
                              }.contains(tab.resource)
                          ? AdminLogisticsSetupScreen(
                              resource: tab.resource, api: api ?? LogisticsApi())
                      : _OperationsList(
                          scope: scope,
                          tab: tab,
                          api: api ?? LogisticsApi(),
                          branchActions: actionScope,
                          tripControls:
                              scope == 'admin' && tab.resource == 'trips',
                        ))
                  .toList()),
        ),
      );
}

class _OverviewPanel extends StatefulWidget {
  const _OverviewPanel({required this.api});
  final LogisticsApi api;

  @override
  State<_OverviewPanel> createState() => _OverviewPanelState();
}

class _OverviewPanelState extends State<_OverviewPanel> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() =>
      widget.api.request('GET', '/admin/logistics/interstate/overview');

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (_, AsyncSnapshot<Map<String, dynamic>> snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _ErrorRetry(
              error: snapshot.error.toString(),
              onRetry: () => setState(() => _future = _load()),
            );
          }
          final Map<String, dynamic> response = snapshot.data!;
          final Map<String, dynamic> metrics =
              LogisticsApi.map(response['overview']).isNotEmpty
                  ? LogisticsApi.map(response['overview'])
                  : LogisticsApi.map(response['data']);
          return RefreshIndicator(
            onRefresh: () async => setState(() => _future = _load()),
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 220,
                mainAxisExtent: 112,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: metrics.length,
              itemBuilder: (_, int index) {
                final MapEntry<String, dynamic> metric =
                    metrics.entries.elementAt(index);
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          metric.key
                              .replaceAll(RegExp(r'([A-Z])'), ' \$1')
                              .trim(),
                          style: const TextStyle(color: Colors.black54),
                        ),
                        const Spacer(),
                        Text('${metric.value}',
                            style: const TextStyle(
                                fontSize: 24, fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      );
}

class _OperationsList extends StatefulWidget {
  const _OperationsList(
      {required this.scope,
      required this.tab,
      required this.api,
      required this.branchActions,
      required this.tripControls});
  final String scope;
  final _LogisticsTab tab;
  final LogisticsApi api;
  final bool branchActions;
  final bool tripControls;
  @override
  State<_OperationsList> createState() => _OperationsListState();
}

class _OperationsListState extends State<_OperationsList> {
  late Future<List<Map<String, dynamic>>> _future;
  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => _future = widget.api.list(widget.scope, widget.tab.resource,
      query: widget.tab.status == null
          ? null
          : <String, String>{'status': widget.tab.status!});
  @override
  Widget build(BuildContext context) =>
      FutureBuilder<List<Map<String, dynamic>>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done)
            return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError)
            return _ErrorRetry(
                error: snapshot.error.toString(),
                onRetry: () => setState(_reload));
          final rows = snapshot.data!;
          if (rows.isEmpty)
            return RefreshIndicator(
                onRefresh: () async => setState(_reload),
                child: ListView(children: const <Widget>[
                  SizedBox(height: 180),
                  Center(child: Text('No records in this queue.'))
                ]));
          return RefreshIndicator(
              onRefresh: () async => setState(_reload),
              child: ListView.separated(
                padding: const EdgeInsets.all(12),
                itemCount: rows.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, index) => _RecordCard(
                    row: rows[index],
                    branchActions: widget.branchActions,
                    tripControls: widget.tripControls,
                    api: widget.api,
                    scope: widget.scope,
                    onChanged: () => setState(_reload)),
              ));
        },
      );
}

class _ErrorRetry extends StatelessWidget {
  const _ErrorRetry({required this.error, required this.onRetry});
  final String error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Text(error, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onRetry, child: const Text('Retry'))
      ]));
}

class _RecordCard extends StatelessWidget {
  const _RecordCard(
      {required this.row,
      required this.branchActions,
      required this.tripControls,
      required this.api,
      required this.scope,
      required this.onChanged});
  final Map<String, dynamic> row;
  final bool branchActions;
  final bool tripControls;
  final LogisticsApi api;
  final String scope;
  final VoidCallback onChanged;
  String get _id => logisticsText(row['_id'] ?? row['id'], '');
  @override
  Widget build(BuildContext context) {
    final String reference = logisticsText(row['trackingNumber'] ??
        row['tripId'] ??
        row['routeName'] ??
        row['driverId']);
    final String status = logisticsText(row['status']);
    final bool paymentReview = status == 'ADDITIONAL_PAYMENT_REQUIRED' ||
        status == 'REFUND_REVIEW_REQUIRED';
    // These states are only reached after destination-hub processing. The
    // server still enforces the authenticated branch and eligibility checks.
    final bool fallbackEligible =
        status == 'OUT_FOR_DELIVERY' || status == 'DELIVERY_ATTEMPTED';
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(reference,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 16)),
                  const SizedBox(height: 6),
                  Text(
                      '${logisticsText(row['originState'] ?? row['origin'])}  →  ${logisticsText(row['destinationState'] ?? row['destination'])}'),
                  const SizedBox(height: 8),
                  Chip(label: Text(status.replaceAll('_', ' '))),
                  if (paymentReview)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        status == 'ADDITIONAL_PAYMENT_REQUIRED'
                            ? 'Additional customer payment is required. Dispatch is blocked.'
                            : 'Controlled refund review is required. Dispatch is blocked.',
                        style: const TextStyle(
                            color: Color(0xffb54708),
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                  if (branchActions && _id.isNotEmpty && !paymentReview)
                    Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                            icon: const Icon(Icons.play_circle_outline),
                            label: const Text('Workflow action'),
                            onPressed: () => _actionDialog(context))),
                  if (branchActions && fallbackEligible && _id.isNotEmpty)
                    Align(
                      alignment: Alignment.centerRight,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.verified_user_outlined),
                        label: const Text('Fallback delivery confirmation'),
                        onPressed: () => _fallbackDeliveryDialog(context),
                      ),
                    ),
                  if (tripControls && _id.isNotEmpty)
                    Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                            icon: const Icon(Icons.sync_alt_outlined),
                            label: const Text('Update trip'),
                            onPressed: () => _tripStatusDialog(context))),
                ])));
  }

  Future<void> _actionDialog(BuildContext context) async {
    final TextEditingController note = TextEditingController();
    final TextEditingController riderId = TextEditingController();
    final TextEditingController actualWeight = TextEditingController();
    final TextEditingController evidence = TextEditingController();
    final String? action = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Shipment workflow'),
                content:
                    Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                  TextField(
                      controller: note,
                      decoration: const InputDecoration(
                          labelText: 'Audit note (optional)')),
                  TextField(
                      controller: riderId,
                      decoration: const InputDecoration(
                          labelText: 'Destination rider ID (to assign)')),
                  TextField(
                      controller: actualWeight,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                          labelText: 'Actual weight in KG (for verification)')),
                  TextField(
                      controller: evidence,
                      minLines: 1,
                      maxLines: 3,
                      decoration: const InputDecoration(
                          labelText: 'Parcel evidence URLs (optional)',
                          helperText: 'Separate HTTP(S) URLs with commas or lines')),
                ]),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, 'receive'),
                      child: const Text('Receive')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, 'verify'),
                      child: const Text('Verify')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, 'arrival'),
                      child: const Text('Confirm arrival')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, 'destination-verify'),
                      child: const Text('Destination verify')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, 'ready-collection'),
                      child: const Text('Ready collection')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, 'assign-rider'),
                      child: const Text('Assign rider')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, 'ready-for-dispatch'),
                      child: const Text('Ready for dispatch')),
                ]));
    if (action == null) {
      note.dispose();
      riderId.dispose();
      actualWeight.dispose();
      evidence.dispose();
      return;
    }
    try {
      final Map<String, String> statuses = <String, String>{
        'receive': 'RECEIVED_AT_ORIGIN_HUB',
        'verify': 'VERIFIED_AT_ORIGIN_HUB',
        'ready-for-dispatch': 'READY_FOR_INTERSTATE_DISPATCH',
        'arrival': 'ARRIVED_AT_DESTINATION_HUB',
        'destination-verify': 'DESTINATION_HUB_VERIFIED',
        'ready-collection': 'READY_FOR_COLLECTION',
      };
      if (action == 'assign-rider') {
        if (riderId.text.trim().isEmpty) {
          throw const LogisticsApiException(
              'Enter the destination rider ID before assigning.');
        }
        await api.request('POST',
            '/$scope/logistics/interstate/shipments/${Uri.encodeComponent(_id)}/assign-rider',
            body: <String, dynamic>{'riderId': riderId.text.trim()});
      } else {
        if (action == 'verify' &&
            (num.tryParse(actualWeight.text.trim()) == null ||
                num.parse(actualWeight.text.trim()) <= 0)) {
          throw const LogisticsApiException(
              'Enter the actual parcel weight before verification.');
        }
        await api.request('PATCH',
            '/$scope/logistics/interstate/shipments/${Uri.encodeComponent(_id)}/status',
            body: <String, dynamic>{
              'status': statuses[action],
              if (action == 'verify')
                'verifiedWeightKg': num.parse(actualWeight.text.trim()),
              if (note.text.trim().isNotEmpty) 'note': note.text.trim()
              ,
              if (evidence.text.trim().isNotEmpty)
                'evidenceUrls': evidence.text
                    .split(RegExp(r'[\s,]+'))
                    .map((value) => value.trim())
                    .where((value) => value.startsWith('http://') ||
                        value.startsWith('https://'))
                    .take(5)
                    .toList(),
            });
      }
      onChanged();
    } on LogisticsApiException catch (error) {
      if (error.code == 'ADDITIONAL_PAYMENT_REQUIRED' ||
          error.code == 'REFUND_REVIEW_REQUIRED') {
        // The backend intentionally returns 409 after persisting this state.
        // Refresh so the dispatch-blocking status is immediately visible.
        onChanged();
      }
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.code == null
                ? error.message
                : '${error.code}: ${error.message}')));
    } finally {
      note.dispose();
      riderId.dispose();
      actualWeight.dispose();
      evidence.dispose();
    }
  }

  Future<void> _tripStatusDialog(BuildContext context) async {
    final String current = logisticsText(row['status'], '').toUpperCase();
    const Map<String, List<String>> transitions = <String, List<String>>{
      'PLANNED': <String>['LOADING', 'CANCELLED'],
      'LOADING': <String>['DEPARTED', 'CANCELLED'],
      'DEPARTED': <String>['IN_TRANSIT', 'ARRIVED'],
      'IN_TRANSIT': <String>['ARRIVED'],
      'ARRIVED': <String>['COMPLETED'],
    };
    final List<String> choices = transitions[current] ?? const <String>[];
    if (choices.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('This trip has no available next action.')),
      );
      return;
    }
    final String? next = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Update transport trip'),
        content: Text('Current status: ${current.replaceAll('_', ' ')}'),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          ...choices.map((String status) => FilledButton(
                onPressed: () => Navigator.pop(dialogContext, status),
                child: Text(status.replaceAll('_', ' ')),
              )),
        ],
      ),
    );
    if (next == null) return;
    try {
      await api.request(
        'PATCH',
        '/admin/logistics/interstate/trips/${Uri.encodeComponent(_id)}/status',
        body: <String, dynamic>{'status': next},
      );
      onChanged();
    } on LogisticsApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _fallbackDeliveryDialog(BuildContext context) async {
    final TextEditingController reason = TextEditingController();
    final TextEditingController evidence = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Fallback delivery confirmation'),
        content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
          const Text(
            'This is an audited branch confirmation used only when OTP '
            'delivery confirmation cannot be used.',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: reason,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Mandatory authorization reason',
              helperText: '10–500 characters',
            ),
          ),
          TextField(
            controller: evidence,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Evidence URLs (optional)',
              helperText:
                  'Up to five HTTP(S) URLs; separate with commas or lines',
            ),
          ),
        ]),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Confirm audited delivery')),
        ],
      ),
    );
    if (confirmed != true) {
      reason.dispose();
      evidence.dispose();
      return;
    }
    final String reasonText = reason.text.trim();
    final List<String> evidenceUrls = evidence.text
        .split(RegExp(r'[\n,]'))
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .toList();
    final bool validUrls = evidenceUrls.every((String value) {
      final Uri? uri = Uri.tryParse(value);
      return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
    });
    if (reasonText.length < 10 || reasonText.length > 500) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content:
                Text('Provide an authorization reason of 10–500 characters.')));
      }
      reason.dispose();
      evidence.dispose();
      return;
    }
    if (evidenceUrls.length > 5 || !validUrls) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content:
                Text('Provide at most five valid HTTP(S) evidence URLs.')));
      }
      reason.dispose();
      evidence.dispose();
      return;
    }
    try {
      await api.request(
        'PATCH',
        '/branch/logistics/interstate/shipments/${Uri.encodeComponent(_id)}/confirm-delivery-fallback',
        body: <String, dynamic>{
          'reason': reasonText,
          'evidenceUrls': evidenceUrls,
        },
      );
      onChanged();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Fallback delivery confirmation was recorded in the audit trail.')));
      }
    } on LogisticsApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      reason.dispose();
      evidence.dispose();
    }
  }
}

class RiderInterstateDeliveriesScreen extends StatefulWidget {
  const RiderInterstateDeliveriesScreen({super.key, this.api});
  final LogisticsApi? api;
  @override
  State<RiderInterstateDeliveriesScreen> createState() =>
      _RiderInterstateDeliveriesScreenState();
}

class _RiderInterstateDeliveriesScreenState
    extends State<RiderInterstateDeliveriesScreen> {
  late final LogisticsApi _api = widget.api ?? LogisticsApi();
  late Future<List<Map<String, dynamic>>> _future;
  @override
  void initState() {
    super.initState();
    _future = _api.list('rider', 'shipments');
  }

  void _reload() => setState(() => _future = _api.list('rider', 'shipments'));
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Interstate deliveries')),
      body: FutureBuilder<List<Map<String, dynamic>>>(
          future: _future,
          builder: (_, snap) {
            if (snap.connectionState != ConnectionState.done)
              return const Center(child: CircularProgressIndicator());
            if (snap.hasError)
              return _ErrorRetry(
                  error: snap.error.toString(), onRetry: _reload);
            if (snap.data!.isEmpty)
              return const Center(
                  child: Text('No interstate deliveries assigned.'));
            return RefreshIndicator(
                onRefresh: () async => _reload(),
                child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: snap.data!.length,
                    itemBuilder: (_, i) => _RiderShipmentCard(
                        shipment: snap.data![i],
                        api: _api,
                        onChanged: _reload)));
          }));
}

class _RiderShipmentCard extends StatelessWidget {
  const _RiderShipmentCard(
      {required this.shipment, required this.api, required this.onChanged});
  final Map<String, dynamic> shipment;
  final LogisticsApi api;
  final VoidCallback onChanged;
  @override
  Widget build(BuildContext context) {
    final String id = logisticsText(shipment['_id'] ?? shipment['id'], '');
    final Map<String, dynamic> receiver =
        LogisticsApi.map(shipment['receiver']);
    return Card(
      child: ListTile(
        isThreeLine: true,
        leading: const Icon(Icons.local_shipping_outlined),
        title: Text(logisticsText(shipment['trackingNumber'])),
        subtitle: Text(
          '${logisticsText(shipment['receiverName'] ?? receiver['name'])}\n'
          '${logisticsText(shipment['deliveryAddress'] ?? receiver['address'])}',
        ),
        trailing: FilledButton(
          onPressed: id.isEmpty ? null : () => _complete(context, id),
          child: const Text('OTP delivery'),
        ),
      ),
    );
  }

  Future<void> _complete(BuildContext context, String id) async {
    try {
      await api.request('POST',
          '/rider/logistics/interstate/shipments/${Uri.encodeComponent(id)}/delivery-otp');
    } on LogisticsApiException catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      return;
    }
    if (!context.mounted) return;
    final TextEditingController otp = TextEditingController();
    final String? value = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Receiver OTP'),
                content: TextField(
                    controller: otp,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    decoration:
                        const InputDecoration(labelText: 'Enter receiver OTP')),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, otp.text),
                      child: const Text('Confirm delivery'))
                ]));
    if (value == null || value.trim().isEmpty) {
      otp.dispose();
      return;
    }
    try {
      await api.request('POST',
          '/rider/logistics/interstate/shipments/${Uri.encodeComponent(id)}/verify-delivery',
          body: <String, dynamic>{'otp': value.trim()});
      onChanged();
    } on LogisticsApiException catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      otp.dispose();
    }
  }
}
