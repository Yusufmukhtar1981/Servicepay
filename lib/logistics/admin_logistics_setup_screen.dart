import 'package:flutter/material.dart';

import 'logistics_api.dart';
import 'logistics_operations_screens.dart';

class AdminLogisticsSetupScreen extends StatefulWidget {
  const AdminLogisticsSetupScreen({super.key, required this.resource, this.api});

  final String resource;
  final LogisticsApi? api;

  @override
  State<AdminLogisticsSetupScreen> createState() =>
      _AdminLogisticsSetupScreenState();
}

class _AdminLogisticsSetupScreenState extends State<AdminLogisticsSetupScreen> {
  late LogisticsApi _api;
  late Future<List<Map<String, dynamic>>> _future;
  List<Map<String, dynamic>> _branches = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _routes = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _drivers = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _vehicles = <Map<String, dynamic>>[];
  String _search = '';

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? LogisticsApi();
    _reload();
  }

  void _reload() {
    _future = _load();
    if (mounted) setState(() {});
  }

  Future<List<Map<String, dynamic>>> _load() async {
    if (widget.resource == 'routes') {
      final results = await Future.wait(<Future<List<Map<String, dynamic>>>>[
        _api.list('admin', 'routes'),
        _api.listBranches(),
      ]);
      _branches = results[1];
      return results[0];
    }
    if (widget.resource == 'drivers') {
      final results = await Future.wait(<Future<List<Map<String, dynamic>>>>[
        _api.list('admin', 'drivers'),
        _api.listBranches(),
      ]);
      _branches = results[1];
      return results[0];
    }
    if (widget.resource == 'vehicles') {
      final results = await Future.wait(<Future<List<Map<String, dynamic>>>>[
        _api.list('admin', 'vehicles'),
        _api.listBranches(),
      ]);
      _branches = results[1];
      return results[0];
    }
    if (widget.resource == 'trips') {
      final results = await Future.wait(<Future<List<Map<String, dynamic>>>>[
        _api.list('admin', 'trips'),
        _api.list('admin', 'routes'),
        _api.list('admin', 'drivers'),
        _api.list('admin', 'vehicles'),
      ]);
      _routes = results[1].where((row) => row['status'] == 'ACTIVE').toList();
      _drivers = results[2].where((row) => row['status'] == 'ACTIVE').toList();
      _vehicles = results[3].where((row) => row['status'] == 'ACTIVE').toList();
      return results[0];
    }
    return _api.list('admin', widget.resource);
  }

  String get _title => switch (widget.resource) {
        'routes' => 'Routes & pricing',
        'drivers' => 'Transport drivers',
        'vehicles' => 'Transport vehicles',
        'trips' => 'Trip management',
        _ => 'Logistics setup',
      };

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(_title),
          actions: <Widget>[
            IconButton(
              tooltip: 'Refresh',
              onPressed: _reload,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        floatingActionButton: widget.resource == 'routes' ||
                widget.resource == 'drivers' ||
                widget.resource == 'vehicles' ||
                widget.resource == 'trips'
            ? FloatingActionButton.extended(
                onPressed: () => _create(context),
                icon: const Icon(Icons.add),
                label: Text(widget.resource == 'routes'
                    ? 'Create First Interstate Route'
                    : 'Create'),
              )
            : null,
        body: FutureBuilder<List<Map<String, dynamic>>>(
          future: _future,
          builder: (BuildContext context,
              AsyncSnapshot<List<Map<String, dynamic>>> snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text('${snapshot.error}', textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      OutlinedButton(
                          onPressed: _reload, child: const Text('Retry')),
                    ],
                  ),
                ),
              );
            }
            final rows = snapshot.data ?? <Map<String, dynamic>>[];
            if (widget.resource == 'routes') {
              return _routeList(context, rows);
            }
            if (rows.isEmpty) {
              return Center(
                child: Text(widget.resource == 'trips'
                    ? 'No trips created yet.'
                    : 'No ${widget.resource} created yet.'),
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
              itemCount: rows.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, int index) =>
                  _resourceCard(context, rows[index]),
            );
          },
        ),
      );

  Widget _routeList(BuildContext context, List<Map<String, dynamic>> rows) {
    final filtered = rows.where((row) {
      final text = <String>[
        logisticsText(row['name'], ''),
        logisticsText(row['originState'], ''),
        logisticsText(row['destinationState'], ''),
        logisticsText(LogisticsApi.map(row['originBranchId'])['name'], ''),
        logisticsText(LogisticsApi.map(row['destinationBranchId'])['name'], ''),
        logisticsText(row['status'], ''),
      ].join(' ').toLowerCase();
      return text.contains(_search.toLowerCase());
    }).toList();
    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: TextField(
            decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                labelText: 'Search routes',
                border: OutlineInputBorder()),
            onChanged: (value) => setState(() => _search = value),
          ),
        ),
        if (rows.isEmpty)
          const Expanded(
            child: Center(
              child: Text(
                'No active or inactive routes exist yet.\nCreate a real route to make Interstate Logistics available.',
                textAlign: TextAlign.center,
              ),
            ),
          )
        else
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
              itemCount: filtered.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, int index) {
                final row = filtered[index];
                final origin = LogisticsApi.map(row['originBranchId']);
                final destination = LogisticsApi.map(row['destinationBranchId']);
                return Card(
                  child: ListTile(
                    isThreeLine: true,
                    leading: const Icon(Icons.route_outlined),
                    title: Text(logisticsText(row['name'])),
                    subtitle: Text(
                        '${logisticsText(origin['name'], logisticsText(row['originState']))} → '
                        '${logisticsText(destination['name'], logisticsText(row['destinationState']))}\n'
                        '₦${logisticsText(row['baseFare'], '0')} base · '
                        '${logisticsText(row['minimumWeightKg'], '0')}–${logisticsText(row['maximumWeightKg'])} kg · '
                        '${logisticsText(row['status'])}'),
                    trailing: IconButton(
                      tooltip: 'Edit route',
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => _edit(context, row),
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }

  Widget _resourceCard(BuildContext context, Map<String, dynamic> row) {
    final id = logisticsText(row['_id'] ?? row['id'], '');
    final title = widget.resource == 'drivers'
        ? logisticsText(row['name'])
        : widget.resource == 'vehicles'
            ? logisticsText(row['registrationNumber'])
            : logisticsText(row['tripCode']);
    final subtitle = widget.resource == 'drivers'
        ? '${logisticsText(row['phone'])}\n${logisticsText(row['driverCode'])} · ${logisticsText(row['status'])}'
        : widget.resource == 'vehicles'
            ? '${logisticsText(row['vehicleType'])} · ${logisticsText(row['capacityKg'])} kg\n${logisticsText(row['status'])}'
            : '${logisticsText(row['status'])}\n${logisticsText(row['departureAt'])} → ${logisticsText(row['expectedArrivalAt'])}';
    return Card(
      child: ListTile(
        isThreeLine: true,
        leading: Icon(widget.resource == 'drivers'
            ? Icons.badge_outlined
            : widget.resource == 'vehicles'
                ? Icons.airport_shuttle_outlined
                : Icons.departure_board_outlined),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: widget.resource == 'trips'
            ? null
            : PopupMenuButton<String>(
                onSelected: (value) => value == 'edit'
                    ? _edit(context, row)
                    : _deactivate(context, id),
                itemBuilder: (_) => const <PopupMenuEntry<String>>[
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(
                      value: 'deactivate', child: Text('Mark inactive')),
                ],
              ),
      ),
    );
  }

  Future<void> _create(BuildContext context) async {
    final data = await _showForm(context);
    if (data == null) return;
    if (!mounted) return;
    try {
      await _api.request(
        'POST',
        '/admin/logistics/interstate/${widget.resource}',
        body: data,
      );
      _reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('${_title.replaceAll('& pricing', '')} created.')));
      }
    } on LogisticsApiException catch (error) {
      _error(context, error.message);
    }
  }

  Future<void> _edit(
      BuildContext context, Map<String, dynamic> row) async {
    final data = await _showForm(context, row: row);
    if (data == null) return;
    if (!mounted) return;
    final id = logisticsText(row['_id'] ?? row['id'], '');
    try {
      await _api.request('PATCH',
          '/admin/logistics/interstate/${widget.resource}/${Uri.encodeComponent(id)}',
          body: data);
      _reload();
    } on LogisticsApiException catch (error) {
      _error(context, error.message);
    }
  }

  Future<void> _deactivate(BuildContext context, String id) async {
    if (id.isEmpty) return;
    if (!mounted) return;
    try {
      await _api.request('DELETE',
          '/admin/logistics/interstate/${widget.resource}/${Uri.encodeComponent(id)}');
      _reload();
    } on LogisticsApiException catch (error) {
      _error(context, error.message);
    }
  }

  void _error(BuildContext context, String message) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<Map<String, dynamic>?> _showForm(BuildContext context,
      {Map<String, dynamic>? row}) async {
    if (widget.resource == 'routes') {
      return showDialog<Map<String, dynamic>>(
          context: context,
          builder: (_) => _RouteForm(
              branches: _branches, row: row));
    }
    if (widget.resource == 'drivers') {
      return showDialog<Map<String, dynamic>>(
          context: context,
          builder: (_) => _DriverForm(branches: _branches, row: row));
    }
    if (widget.resource == 'vehicles') {
      return showDialog<Map<String, dynamic>>(
          context: context,
          builder: (_) => _VehicleForm(branches: _branches, row: row));
    }
    return showDialog<Map<String, dynamic>>(
        context: context,
        builder: (_) => _TripForm(
            routes: _routes, drivers: _drivers, vehicles: _vehicles));
  }
}

class _RouteForm extends StatefulWidget {
  const _RouteForm({required this.branches, this.row});
  final List<Map<String, dynamic>> branches;
  final Map<String, dynamic>? row;
  @override
  State<_RouteForm> createState() => _RouteFormState();
}

class _RouteFormState extends State<_RouteForm> {
  late final Map<String, TextEditingController> c;
  String? origin;
  String? destination;
  String status = 'ACTIVE';
  bool express = false;
  bool protection = false;

  @override
  void initState() {
    super.initState();
    final row = widget.row ?? <String, dynamic>{};
    c = <String, TextEditingController>{
      for (final key in <String>[
        'name', 'baseFare', 'minimumWeightKg', 'maximumWeightKg',
        'pricePerAdditionalKg', 'expressSurcharge', 'pickupFee',
        'doorDeliveryFee', 'branchCollectionFee', 'protectionPercent',
        'protectionFlatFee', 'fragileItemSurcharge',
        'standardDeliveryTime', 'expressDeliveryTime', 'notes'
      ])
        key: TextEditingController(text: logisticsText(row[key], '')),
    };
    origin = _id(row['originBranchId']);
    destination = _id(row['destinationBranchId']);
    status = logisticsText(row['status'], 'ACTIVE');
    express = row['expressEnabled'] == true;
    protection = row['protectionEnabled'] == true;
  }

  String? _id(dynamic value) =>
      value is Map ? logisticsText(value['_id'] ?? value['id'], '') : logisticsText(value, '');

  @override
  void dispose() {
    for (final controller in c.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Widget _text(String key, String label, {bool number = false}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          controller: c[key],
          keyboardType: number
              ? const TextInputType.numberWithOptions(decimal: true)
              : TextInputType.text,
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        ),
      );

  double _number(String key) => double.tryParse(c[key]!.text.trim()) ?? 0;

  @override
  Widget build(BuildContext context) {
    final branchItems = widget.branches
        .map((branch) => DropdownMenuItem<String>(
              value: logisticsText(branch['_id'] ?? branch['id'], ''),
              child: Text('${logisticsText(branch['name'])} · ${logisticsText(branch['state'])}'),
            ))
        .toList();
    return AlertDialog(
      title: Text(widget.row == null ? 'Create Interstate Route' : 'Edit Interstate Route'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            children: <Widget>[
              _text('name', 'Route name'),
              DropdownButtonFormField<String>(
                value: origin,
                decoration: const InputDecoration(labelText: 'Origin branch', border: OutlineInputBorder()),
                items: branchItems,
                onChanged: (value) => setState(() => origin = value),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                value: destination,
                decoration: const InputDecoration(labelText: 'Destination branch', border: OutlineInputBorder()),
                items: branchItems,
                onChanged: (value) => setState(() => destination = value),
              ),
              const SizedBox(height: 10),
              _text('baseFare', 'Base price (₦)', number: true),
              _text('minimumWeightKg', 'Included weight (kg)', number: true),
              _text('maximumWeightKg', 'Maximum accepted weight (kg)', number: true),
              _text('pricePerAdditionalKg', 'Additional price per kg (₦)', number: true),
              SwitchListTile(title: const Text('Express service'), value: express, onChanged: (value) => setState(() => express = value)),
              _text('expressSurcharge', 'Express surcharge (₦)', number: true),
              _text('fragileItemSurcharge', 'Fragile-item surcharge (₦)', number: true),
              _text('pickupFee', 'Rider pickup fee (₦)', number: true),
              _text('doorDeliveryFee', 'Door delivery fee (₦)', number: true),
              _text('branchCollectionFee', 'Branch collection fee (₦)', number: true),
              SwitchListTile(title: const Text('Insurance/protection'), value: protection, onChanged: (value) => setState(() => protection = value)),
              _text('protectionPercent', 'Insurance rate (%)', number: true),
              _text('protectionFlatFee', 'Insurance flat fee (₦)', number: true),
              _text('standardDeliveryTime', 'Estimated standard delivery'),
              _text('expressDeliveryTime', 'Estimated express delivery'),
              _text('notes', 'Route notes'),
              DropdownButtonFormField<String>(
                value: status,
                decoration: const InputDecoration(labelText: 'Route status', border: OutlineInputBorder()),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem(value: 'ACTIVE', child: Text('Active')),
                  DropdownMenuItem(value: 'PAUSED', child: Text('Paused')),
                  DropdownMenuItem(value: 'UNAVAILABLE', child: Text('Unavailable')),
                ],
                onChanged: (value) => setState(() => status = value ?? 'ACTIVE'),
              ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: origin == null || destination == null || origin == destination
              ? null
              : () {
                  final originBranch = widget.branches.firstWhere((b) => logisticsText(b['_id'] ?? b['id'], '') == origin);
                  final destinationBranch = widget.branches.firstWhere((b) => logisticsText(b['_id'] ?? b['id'], '') == destination);
                  Navigator.pop(context, <String, dynamic>{
                    'name': c['name']!.text.trim(),
                    'originState': logisticsText(originBranch['state'], '').toUpperCase(),
                    'originBranchId': origin,
                    'destinationState': logisticsText(destinationBranch['state'], '').toUpperCase(),
                    'destinationBranchId': destination,
                    'baseFare': _number('baseFare'),
                    'minimumWeightKg': _number('minimumWeightKg'),
                    'maximumWeightKg': _number('maximumWeightKg'),
                    'pricePerAdditionalKg': _number('pricePerAdditionalKg'),
                    'expressEnabled': express,
                    'expressSurcharge': _number('expressSurcharge'),
                    'fragileItemSurcharge': _number('fragileItemSurcharge'),
                    'pickupFee': _number('pickupFee'),
                    'doorDeliveryFee': _number('doorDeliveryFee'),
                    'branchCollectionFee': _number('branchCollectionFee'),
                    'protectionEnabled': protection,
                    'protectionPercent': _number('protectionPercent'),
                    'protectionFlatFee': _number('protectionFlatFee'),
                    'standardDeliveryTime': c['standardDeliveryTime']!.text.trim(),
                    'expressDeliveryTime': c['expressDeliveryTime']!.text.trim(),
                    'notes': c['notes']!.text.trim(),
                    'status': status,
                  });
                },
          child: Text(widget.row == null ? 'Create route' : 'Save changes'),
        ),
      ],
    );
  }
}

class _DriverForm extends StatefulWidget {
  const _DriverForm({required this.branches, this.row});
  final List<Map<String, dynamic>> branches;
  final Map<String, dynamic>? row;
  @override
  State<_DriverForm> createState() => _DriverFormState();
}

class _DriverFormState extends State<_DriverForm> {
  late final TextEditingController name;
  late final TextEditingController phone;
  late final TextEditingController code;
  String? branch;
  String status = 'ACTIVE';
  @override
  void initState() {
    super.initState();
    final row = widget.row ?? <String, dynamic>{};
    name = TextEditingController(text: logisticsText(row['name'], ''));
    phone = TextEditingController(text: logisticsText(row['phone'], ''));
    code = TextEditingController(text: logisticsText(row['driverCode'], ''));
    branch = logisticsText(row['assignedBranchId'], '');
    status = logisticsText(row['status'], 'ACTIVE');
  }
  @override
  void dispose() { name.dispose(); phone.dispose(); code.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => _SimpleStaffForm(
        title: widget.row == null ? 'Create driver' : 'Edit driver',
        fields: <Widget>[
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder())),
          TextField(controller: phone, decoration: const InputDecoration(labelText: 'Phone', border: OutlineInputBorder())),
          TextField(controller: code, decoration: const InputDecoration(labelText: 'Driver ID/reference', border: OutlineInputBorder())),
          _branchDropdown(widget.branches, branch, (value) => setState(() => branch = value)),
          _statusDropdown(status, (value) => setState(() => status = value)),
        ],
        onSave: branch == null || branch!.isEmpty ? null : () => <String, dynamic>{'name': name.text.trim(), 'phone': phone.text.trim(), 'driverCode': code.text.trim(), 'assignedBranchId': branch, 'status': status},
      );
}

class _VehicleForm extends StatefulWidget {
  const _VehicleForm({required this.branches, this.row});
  final List<Map<String, dynamic>> branches;
  final Map<String, dynamic>? row;
  @override
  State<_VehicleForm> createState() => _VehicleFormState();
}

class _VehicleFormState extends State<_VehicleForm> {
  late final TextEditingController type;
  late final TextEditingController plate;
  late final TextEditingController capacity;
  String? branch;
  String status = 'ACTIVE';
  @override
  void initState() {
    super.initState();
    final row = widget.row ?? <String, dynamic>{};
    type = TextEditingController(text: logisticsText(row['vehicleType'], ''));
    plate = TextEditingController(text: logisticsText(row['registrationNumber'], ''));
    capacity = TextEditingController(text: logisticsText(row['capacityKg'], ''));
    branch = logisticsText(row['assignedBranchId'], '');
    status = logisticsText(row['status'], 'ACTIVE');
  }
  @override
  void dispose() { type.dispose(); plate.dispose(); capacity.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => _SimpleStaffForm(
        title: widget.row == null ? 'Create vehicle' : 'Edit vehicle',
        fields: <Widget>[
          TextField(controller: plate, decoration: const InputDecoration(labelText: 'Plate number', border: OutlineInputBorder())),
          TextField(controller: type, decoration: const InputDecoration(labelText: 'Vehicle type', border: OutlineInputBorder())),
          TextField(controller: capacity, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Capacity (kg)', border: OutlineInputBorder())),
          _branchDropdown(widget.branches, branch, (value) => setState(() => branch = value)),
          _statusDropdown(status, (value) => setState(() => status = value)),
        ],
        onSave: branch == null || branch!.isEmpty ? null : () => <String, dynamic>{'vehicleType': type.text.trim(), 'registrationNumber': plate.text.trim(), 'capacityKg': double.tryParse(capacity.text) ?? 0, 'assignedBranchId': branch, 'status': status},
      );
}

class _TripForm extends StatefulWidget {
  const _TripForm({required this.routes, required this.drivers, required this.vehicles});
  final List<Map<String, dynamic>> routes;
  final List<Map<String, dynamic>> drivers;
  final List<Map<String, dynamic>> vehicles;
  @override
  State<_TripForm> createState() => _TripFormState();
}

class _TripFormState extends State<_TripForm> {
  String? route;
  String? driver;
  String? vehicle;
  late final TextEditingController code;
  late final TextEditingController departure;
  late final TextEditingController arrival;
  late final TextEditingController shipments;

  @override
  void initState() {
    super.initState();
    code = TextEditingController();
    departure = TextEditingController();
    arrival = TextEditingController();
    shipments = TextEditingController();
  }

  @override
  void dispose() {
    code.dispose();
    departure.dispose();
    arrival.dispose();
    shipments.dispose();
    super.dispose();
  }

  List<DropdownMenuItem<String>> _items(
          List<Map<String, dynamic>> rows, String Function(Map<String, dynamic>) label) =>
      rows
          .map((row) => DropdownMenuItem<String>(
              value: logisticsText(row['_id'] ?? row['id'], ''),
              child: Text(label(row))))
          .toList();

  @override
  Widget build(BuildContext context) {
    final unavailable = widget.routes.isEmpty ||
        widget.drivers.isEmpty ||
        widget.vehicles.isEmpty;
    return AlertDialog(
        title: const Text('Create transport trip'),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: Column(
              children: <Widget>[
                if (unavailable)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: Text(
                      'Create at least one active route, driver, and vehicle before creating a trip.',
                      style: TextStyle(color: Colors.deepOrange),
                    ),
                  ),
                DropdownButtonFormField<String>(
                  value: route,
                  decoration: const InputDecoration(
                      labelText: 'Active route', border: OutlineInputBorder()),
                  items: _items(widget.routes, (row) =>
                      '${logisticsText(row['name'])} · ${logisticsText(row['originState'])} → ${logisticsText(row['destinationState'])}'),
                  onChanged: (value) => setState(() => route = value),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: driver,
                  decoration: const InputDecoration(
                      labelText: 'Driver', border: OutlineInputBorder()),
                  items: _items(widget.drivers, (row) =>
                      '${logisticsText(row['name'])} · ${logisticsText(row['driverCode'])}'),
                  onChanged: (value) => setState(() => driver = value),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: vehicle,
                  decoration: const InputDecoration(
                      labelText: 'Vehicle', border: OutlineInputBorder()),
                  items: _items(widget.vehicles, (row) =>
                      '${logisticsText(row['registrationNumber'])} · ${logisticsText(row['vehicleType'])}'),
                  onChanged: (value) => setState(() => vehicle = value),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: code,
                  decoration: const InputDecoration(
                    labelText: 'Trip code (optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: departure,
                  decoration: const InputDecoration(
                    labelText: 'Departure date/time',
                    helperText: 'Example: 2026-09-04T08:00:00+01:00',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: arrival,
                  decoration: const InputDecoration(
                    labelText: 'Expected arrival date/time',
                    helperText: 'Example: 2026-09-05T16:00:00+01:00',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: shipments,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Eligible shipment IDs',
                    helperText:
                        'Paste READY FOR INTERSTATE DISPATCH IDs, separated by commas or lines.',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
          FilledButton(
            onPressed: unavailable ||
                    route == null ||
                    driver == null ||
                    vehicle == null
                ? null
                : () {
                    final shipmentIds = shipments.text
                        .split(RegExp(r'[\s,]+'))
                        .map((value) => value.trim())
                        .where((value) => value.isNotEmpty)
                        .toList();
                    if (shipmentIds.isEmpty ||
                        departure.text.trim().isEmpty ||
                        arrival.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                          content: Text(
                              'Departure, arrival, and at least one shipment are required.')));
                      return;
                    }
                    Navigator.pop(context, <String, dynamic>{
                      'routeId': route,
                      'driverId': driver,
                      'vehicleId': vehicle,
                      if (code.text.trim().isNotEmpty)
                        'tripCode': code.text.trim(),
                      'departureAt': departure.text.trim(),
                      'expectedArrivalAt': arrival.text.trim(),
                      'shipmentIds': shipmentIds,
                    });
                  },
            child: const Text('Create trip'),
          ),
        ],
      );
  }
}

class _SimpleStaffForm extends StatelessWidget {
  const _SimpleStaffForm({required this.title, required this.fields, required this.onSave});
  final String title;
  final List<Widget> fields;
  final Map<String, dynamic> Function()? onSave;
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
                children: fields
                    .expand((field) => <Widget>[field, const SizedBox(height: 10)])
                    .toList()),
          ),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: onSave == null ? null : () => Navigator.pop(context, onSave!()),
            child: const Text('Save'),
          ),
        ],
      );
}

Widget _branchDropdown(List<Map<String, dynamic>> branches, String? value,
        ValueChanged<String?> onChanged) =>
    DropdownButtonFormField<String>(
      value: branches.any((b) => logisticsText(b['_id'] ?? b['id'], '') == value)
          ? value
          : null,
      decoration: const InputDecoration(labelText: 'Assigned branch', border: OutlineInputBorder()),
      items: branches
          .map((branch) => DropdownMenuItem<String>(
                value: logisticsText(branch['_id'] ?? branch['id'], ''),
                child: Text('${logisticsText(branch['name'])} · ${logisticsText(branch['state'])}'),
              ))
          .toList(),
      onChanged: onChanged,
    );

Widget _statusDropdown(String value, ValueChanged<String> onChanged) =>
    DropdownButtonFormField<String>(
      value: value,
      decoration: const InputDecoration(labelText: 'Status', border: OutlineInputBorder()),
      items: const <DropdownMenuItem<String>>[
        DropdownMenuItem(value: 'ACTIVE', child: Text('Active')),
        DropdownMenuItem(value: 'INACTIVE', child: Text('Inactive')),
      ],
      onChanged: (next) => onChanged(next ?? value),
    );