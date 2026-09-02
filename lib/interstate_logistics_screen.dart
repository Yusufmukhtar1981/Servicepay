import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'servicepay_theme.dart';
import 'transaction_pin_dialog.dart';

/// Customer-facing interstate logistics. Routes, availability and every
/// monetary value are deliberately obtained from the logistics API.
class InterstateLogisticsHub extends StatelessWidget {
  const InterstateLogisticsHub({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ServicePay Logistics')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: <Color>[ServicePayColors.brand, Color(0xFF0B5C4D)],
                ),
                borderRadius: BorderRadius.circular(22),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.local_shipping_rounded,
                      color: Colors.white, size: 40),
                  SizedBox(height: 16),
                  Text('Move parcels with confidence',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w800)),
                  SizedBox(height: 6),
                  Text(
                      'Send across states, pay securely from your wallet, and follow every update.',
                      style: TextStyle(color: Colors.white70, height: 1.4)),
                ],
              ),
            ),
            const SizedBox(height: 22),
            _HubAction(
              icon: Icons.add_box_outlined,
              title: 'Send Interstate Parcel',
              subtitle: 'Get a live route quote and create a shipment.',
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const InterstateShipmentWizard(),
              )),
            ),
            _HubAction(
              icon: Icons.location_searching_rounded,
              title: 'Track Parcel',
              subtitle: 'Use a tracking number for public-safe updates.',
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const InterstateTrackingScreen(),
              )),
            ),
            _HubAction(
              icon: Icons.inventory_2_outlined,
              title: 'My Shipments',
              subtitle:
                  'Review active, delivered, returned and cancelled parcels.',
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const MyInterstateShipmentsScreen(),
              )),
            ),
          ],
        ),
      ),
    );
  }
}

class _HubAction extends StatelessWidget {
  const _HubAction(
      {required this.icon,
      required this.title,
      required this.subtitle,
      required this.onTap});
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: CircleAvatar(
                backgroundColor: ServicePayColors.brandSoft,
                child: Icon(icon, color: ServicePayColors.brand)),
            title: Text(title,
                style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Padding(
                padding: const EdgeInsets.only(top: 4), child: Text(subtitle)),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: onTap,
          ),
        ),
      );
}

class _LogisticsApi {
  static const String _base =
      'https://api.servicepay.ng/api/logistics/interstate';
  static const Duration _timeout = Duration(seconds: 35);

  static Future<String> token() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt'
    ]) {
      String value = prefs.getString(key)?.trim() ?? '';
      if (value.toLowerCase().startsWith('bearer '))
        value = value.substring(7).trim();
      if (value.isNotEmpty) return value;
    }
    throw StateError('Your login session has expired. Please sign in again.');
  }

  static Future<dynamic> get(String path, {bool authenticated = true}) async {
    final Map<String, String> headers = <String, String>{
      'Accept': 'application/json'
    };
    if (authenticated) headers['Authorization'] = 'Bearer ${await token()}';
    final http.Response response = await http
        .get(Uri.parse('$_base$path'), headers: headers)
        .timeout(_timeout);
    return _response(response);
  }

  static Future<dynamic> post(
    String path,
    Map<String, dynamic> body, {
    String? idempotencyKey,
  }) async {
    final Map<String, String> headers = <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${await token()}',
    };
    if (idempotencyKey != null && idempotencyKey.isNotEmpty) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    final http.Response response = await http
        .post(Uri.parse('$_base$path'),
            headers: headers, body: jsonEncode(body))
        .timeout(_timeout);
    return _response(response);
  }

  static dynamic _response(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = <String, dynamic>{};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final String message = decoded is Map
          ? '${decoded['message'] ?? decoded['error'] ?? 'The logistics service could not process this request.'}'
          : 'The logistics service could not process this request.';
      throw StateError(message);
    }
    return decoded;
  }

  static Map<String, dynamic> map(dynamic raw) =>
      raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
  static List<Map<String, dynamic>> list(dynamic raw) => raw is List
      ? raw
          .whereType<Map>()
          .map((Map e) => Map<String, dynamic>.from(e))
          .toList()
      : <Map<String, dynamic>>[];
  static dynamic data(dynamic root) =>
      root is Map && root['data'] != null ? root['data'] : root;
}

/// Canonical response and request adapters kept public for contract tests.
abstract final class InterstateLogisticsContracts {
  static Map<String, dynamic> quote(dynamic response) =>
      _LogisticsApi.map(response is Map ? response['quote'] : null);

  static Map<String, dynamic> shipment(dynamic response) =>
      _LogisticsApi.map(response is Map ? response['shipment'] : null);

  static Map<String, dynamic> shipmentWithTimeline(dynamic response) {
    final Map<String, dynamic> result = shipment(response);
    result['timeline'] = _LogisticsApi.list(
      response is Map ? response['timeline'] : null,
    );
    return result;
  }

  static List<Map<String, dynamic>> breakdownRows(Map<String, dynamic> quote) {
    final dynamic breakdown = quote['breakdown'] ?? quote['priceBreakdown'];
    if (breakdown is Map) {
      return breakdown.entries
          .map((MapEntry<dynamic, dynamic> entry) => <String, dynamic>{
                'label': _label(entry.key.toString()),
                'amount': entry.value,
              })
          .toList();
    }
    return _LogisticsApi.list(breakdown);
  }

  static Map<String, dynamic> latestWeightAdjustment(
      Map<String, dynamic> shipment) {
    final List<Map<String, dynamic>> values =
        _LogisticsApi.list(shipment['priceAdjustments']);
    return values.isEmpty ? <String, dynamic>{} : values.last;
  }

  static num adjustmentDue(Map<String, dynamic> shipment) {
    final dynamic value = latestWeightAdjustment(shipment)['difference'];
    return value is num ? value : num.tryParse('${value ?? ''}') ?? 0;
  }

  static String _label(String key) => key
      .replaceAllMapped(
          RegExp(r'([a-z])([A-Z])'), (Match m) => '${m[1]} ${m[2]}')
      .replaceAll('_', ' ')
      .trim();
}

class InterstateShipmentWizard extends StatefulWidget {
  const InterstateShipmentWizard({super.key});
  @override
  State<InterstateShipmentWizard> createState() =>
      _InterstateShipmentWizardState();
}

class _InterstateShipmentWizardState extends State<InterstateShipmentWizard> {
  final GlobalKey<FormState> _form = GlobalKey<FormState>();
  final PageController _pages = PageController();
  int _step = 0;
  bool _busy = true;
  bool _submitting = false;
  String _error = '';
  List<Map<String, dynamic>> _routes = <Map<String, dynamic>>[];
  Map<String, dynamic>? _route;
  Map<String, dynamic>? _quote;
  Map<String, dynamic>? _createdShipment;
  Map<String, dynamic>? _shipment;
  final Map<String, TextEditingController> _fields =
      <String, TextEditingController>{
    for (final String key in <String>[
      'senderName',
      'senderPhone',
      'pickupLga',
      'pickupAddress',
      'pickupLandmark',
      'receiverName',
      'receiverPhone',
      'destinationLga',
      'deliveryAddress',
      'deliveryLandmark',
      'description',
      'quantity',
      'declaredValue',
      'weightKg',
      'length',
      'width',
      'height',
      'specialHandling'
    ])
      key: TextEditingController(),
  };
  String _pickupMethod = 'RIDER_PICKUP';
  String _deliveryMethod = 'DOOR_DELIVERY';
  String _category = 'DOCUMENTS';
  String _serviceType = 'STANDARD';
  bool _fragile = false;
  bool _prohibitedAcknowledged = false;
  bool _protection = false;
  String _quoteId = '';
  String _quoteVersion = '';
  DateTime? _quoteExpiresAt;
  late final String _paymentIdempotencyKey;

  @override
  void initState() {
    super.initState();
    _paymentIdempotencyKey = _newIdempotencyKey();
    _loadConfiguration();
  }

  @override
  void dispose() {
    _pages.dispose();
    for (final TextEditingController c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _value(String key) => _fields[key]!.text.trim();

  Future<void> _loadConfiguration() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final dynamic root = await _LogisticsApi.get('/routes');
      final Map<String, dynamic> data =
          _LogisticsApi.map(_LogisticsApi.data(root));
      final List<Map<String, dynamic>> routes = _LogisticsApi.list(
          data['routes'] ?? (root is Map ? root['routes'] : null));
      if (routes.isEmpty)
        throw StateError('No interstate routes are currently available.');
      if (!mounted) return;
      setState(() {
        _routes = routes;
        _busy = false;
      });
    } catch (e) {
      if (mounted)
        setState(() {
          _error = e.toString().replaceFirst('Bad state: ', '');
          _busy = false;
        });
    }
  }

  Map<String, dynamic> _payload() => <String, dynamic>{
        'routeId': _route?['_id'] ?? _route?['id'],
        'sender': <String, dynamic>{
          'name': _value('senderName'),
          'phone': _value('senderPhone'),
          'state': _route?['originState'],
          'lga': _value('pickupLga'),
          'address': _value('pickupAddress'),
          'landmark': _value('pickupLandmark')
        },
        'receiver': <String, dynamic>{
          'name': _value('receiverName'),
          'phone': _value('receiverPhone'),
          'state': _route?['destinationState'],
          'lga': _value('destinationLga'),
          'address': _value('deliveryAddress'),
          'landmark': _value('deliveryLandmark')
        },
        'parcel': <String, dynamic>{
          'category': _category,
          'description': _value('description'),
          'quantity': int.tryParse(_value('quantity')),
          'declaredValue': num.tryParse(_value('declaredValue')),
          'weightKg': num.tryParse(_value('weightKg')),
          'dimensions': <String, dynamic>{
            'length': num.tryParse(_value('length')),
            'width': num.tryParse(_value('width')),
            'height': num.tryParse(_value('height'))
          },
          'fragile': _fragile,
          'specialHandling': _value('specialHandling')
        },
        'pickupMethod': _pickupMethod,
        'deliveryMethod': _deliveryMethod,
        'serviceType': _serviceType,
        'protection': _protection,
        'prohibitedItemsAcknowledged': _prohibitedAcknowledged,
        // Pricing validates these canonical top-level parcel measures.
        'weightKg': num.tryParse(_value('weightKg')),
        'declaredValue': num.tryParse(_value('declaredValue')),
      };

  Future<void> _quoteShipment() async {
    setState(() => _submitting = true);
    try {
      final dynamic result = await _LogisticsApi.post('/quote', _payload());
      final Map<String, dynamic> quote =
          InterstateLogisticsContracts.quote(result);
      if (quote.isEmpty)
        throw StateError('A quote was not returned. Please try again.');
      final String quoteId =
          '${quote['quoteId'] ?? (result is Map ? result['quoteId'] : '')}';
      final String quoteVersion =
          '${quote['version'] ?? quote['routeVersion'] ?? (result is Map ? result['version'] : '')}';
      final DateTime? expiry = DateTime.tryParse(
        '${quote['expiresAt'] ?? quote['expiry'] ?? (result is Map ? result['expiresAt'] : '')}',
      );
      if (mounted) {
        setState(() {
          _quote = quote;
          _quoteId = quoteId;
          _quoteVersion = quoteVersion;
          _quoteExpiresAt = expiry;
        });
      }
    } catch (e) {
      _notice(e.toString().replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _createAndPay() async {
    setState(() => _submitting = true);
    try {
      if (_quoteExpiresAt != null && DateTime.now().isAfter(_quoteExpiresAt!)) {
        _quote = null;
        _quoteId = '';
        _quoteVersion = '';
        if (mounted) {
          setState(() => _step = 3);
          await _pages.animateToPage(3,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut);
        }
        _notice('This quote has expired. Please get a new quote.');
        return;
      }
      Map<String, dynamic> shipment = _createdShipment ?? <String, dynamic>{};
      if (shipment.isEmpty) {
        final dynamic created = await _LogisticsApi.post(
          '/shipments',
          <String, dynamic>{
            ..._payload(),
            'quoteId': _quoteId,
            'quoteVersion': _quoteVersion,
          },
        );
        shipment = InterstateLogisticsContracts.shipment(created);
        if (shipment.isNotEmpty) {
          _createdShipment = shipment;
        }
      }
      final String id = '${shipment['_id'] ?? shipment['id'] ?? ''}';
      if (id.isEmpty)
        throw StateError(
            'Shipment creation could not be confirmed. Your wallet has not been charged.');
      final String? pin =
          mounted ? await showTransactionPinDialog(context) : null;
      if (pin == null) return;
      final dynamic paid = await _LogisticsApi.post(
        '/shipments/$id/pay',
        <String, dynamic>{
          'transactionPin': pin,
          'idempotencyKey': _paymentIdempotencyKey,
        },
        idempotencyKey: _paymentIdempotencyKey,
      );
      final Map<String, dynamic> paidShipment = _LogisticsApi.map(
        paid is Map ? paid['shipment'] : null,
      );
      if (!mounted) return;
      setState(() {
        _shipment = paidShipment.isEmpty ? shipment : paidShipment;
        _step = 6;
      });
      await _pages.animateToPage(6,
          duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    } catch (e) {
      final String message = e.toString().replaceFirst('Bad state: ', '');
      if (message.toUpperCase().contains('STALE') ||
          message.toUpperCase().contains('QUOTE') &&
              (message.toUpperCase().contains('EXPIRE') ||
                  message.toUpperCase().contains('VERSION'))) {
        _quote = null;
        _quoteId = '';
        _quoteVersion = '';
        if (mounted) {
          setState(() => _step = 3);
          await _pages.animateToPage(3,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut);
        }
        _notice('Your quote changed or expired. Please request a fresh quote.');
      } else {
        _notice(message);
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _newIdempotencyKey() {
    final Random random = Random.secure();
    final String timestamp =
        DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    final String entropy = List<String>.generate(
      24,
      (_) => random.nextInt(16).toRadixString(16),
    ).join();
    return 'spx-$timestamp-$entropy';
  }

  void _notice(String message) {
    if (mounted)
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
  }

  bool _validate() {
    if (_step == 0 && _route == null) {
      _notice('Choose an available route.');
      return false;
    }
    if (_step == 2 && !_prohibitedAcknowledged) {
      _notice('Please acknowledge the prohibited items policy.');
      return false;
    }
    return _step == 0 || (_form.currentState?.validate() ?? false);
  }

  Future<void> _next() async {
    if (!_validate()) return;
    if (_step == 3) {
      await _quoteShipment();
      if (_quote == null) return;
    }
    if (_step == 5) {
      await _createAndPay();
      return;
    }
    if (_step < 6) {
      setState(() => _step++);
      await _pages.animateToPage(_step,
          duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
    }
  }

  void _back() {
    if (_step > 0) {
      setState(() => _step--);
      _pages.animateToPage(_step,
          duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_busy)
      return Scaffold(
          appBar: AppBar(title: const Text('Send Interstate Parcel')),
          body: const Center(child: CircularProgressIndicator()));
    if (_error.isNotEmpty)
      return Scaffold(
          appBar: AppBar(title: const Text('Send Interstate Parcel')),
          body: _ErrorState(message: _error, retry: _loadConfiguration));
    return Scaffold(
      appBar: AppBar(title: const Text('Send Interstate Parcel')),
      body: Form(
        key: _form,
        child: Column(children: <Widget>[
          _StepHeader(step: _step),
          Expanded(
              child: PageView(
                  controller: _pages,
                  physics: const NeverScrollableScrollPhysics(),
                  children: <Widget>[
                _routePage(),
                _peoplePage(),
                _parcelPage(),
                _optionsPage(),
                _pricePage(),
                _paymentPage(),
                _successPage()
              ])),
          if (_step < 6)
            SafeArea(
                child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                    child: Row(children: <Widget>[
                      if (_step > 0)
                        TextButton(
                            onPressed: _submitting ? null : _back,
                            child: const Text('Back')),
                      const Spacer(),
                      FilledButton(
                          onPressed: _submitting ? null : _next,
                          child: _submitting
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : Text(_step == 5
                                  ? 'Pay securely'
                                  : _step == 3
                                      ? 'Get live quote'
                                      : 'Continue')),
                    ]))),
        ]),
      ),
    );
  }

  Widget _scroll(List<Widget> children) => LayoutBuilder(
      builder: (_, BoxConstraints c) => SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: c.maxHeight),
              child: Center(
                  child: SizedBox(
                      width: 680,
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: children))))));
  Widget _routePage() => _scroll(<Widget>[
        const _PageTitle(
            'Route', 'Select an active route configured by ServicePay.'),
        ..._routes.map((Map<String, dynamic> route) {
          return Card(
              child: RadioListTile<Map<String, dynamic>>(
                  value: route,
                  groupValue: _route,
                  onChanged: (Map<String, dynamic>? v) =>
                      setState(() => _route = v),
                  title: Text(
                      '${route['routeName'] ?? '${route['originState']} → ${route['destinationState']}'}',
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                  subtitle: Text(
                      '${route['expectedDeliveryTime'] ?? route['deliveryTimeframe'] ?? 'Timeframe supplied at quote'}')));
        })
      ]);
  Widget _peoplePage() => _scroll(<Widget>[
        const _PageTitle('Sender & receiver',
            'Contact details are used only to process this shipment.'),
        _heading('Sender'),
        _field('senderName', 'Sender name'),
        _field('senderPhone', 'Sender phone', phone: true),
        _field('pickupLga', 'Pickup LGA'),
        _field('pickupAddress', 'Pickup address', lines: 2),
        _field('pickupLandmark', 'Pickup landmark (optional)', required: false),
        const SizedBox(height: 12),
        _heading('Receiver'),
        _field('receiverName', 'Receiver full name'),
        _field('receiverPhone', 'Receiver phone', phone: true),
        _field('destinationLga', 'Destination LGA'),
        _field('deliveryAddress', 'Full delivery address', lines: 2),
        _field('deliveryLandmark', 'Landmark (optional)', required: false)
      ]);
  Widget _parcelPage() => _scroll(<Widget>[
        const _PageTitle('Parcel details',
            'Accurate details help ServicePay protect and handle your parcel.'),
        DropdownButtonFormField<String>(
            value: _category,
            decoration: const InputDecoration(labelText: 'Parcel category'),
            items: const <String>[
              'DOCUMENTS',
              'ELECTRONICS',
              'FASHION',
              'FOOD_NON_PERISHABLE',
              'COSMETICS',
              'HOUSEHOLD_ITEMS',
              'SPARE_PARTS',
              'BUSINESS_GOODS',
              'OTHER'
            ]
                .map((String x) => DropdownMenuItem<String>(
                    value: x, child: Text(x.replaceAll('_', ' '))))
                .toList(),
            onChanged: (String? v) => setState(() => _category = v!)),
        const SizedBox(height: 12),
        _field('description', 'Parcel description', lines: 2),
        _field('quantity', 'Quantity', number: true),
        _field('declaredValue', 'Declared value (₦)', number: true),
        _field('weightKg', 'Weight (KG)', number: true),
        _heading('Dimensions (where available)'),
        Row(children: <Widget>[
          Expanded(
              child: _field('length', 'Length', number: true, required: false)),
          const SizedBox(width: 8),
          Expanded(
              child: _field('width', 'Width', number: true, required: false)),
          const SizedBox(width: 8),
          Expanded(
              child: _field('height', 'Height', number: true, required: false))
        ]),
        SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _fragile,
            onChanged: (bool value) => setState(() => _fragile = value),
            title: const Text('Fragile parcel'),
            subtitle: const Text('Requires careful handling')),
        _field('specialHandling', 'Special handling note (optional)',
            required: false, lines: 2),
        CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _prohibitedAcknowledged,
            onChanged: (bool? value) =>
                setState(() => _prohibitedAcknowledged = value ?? false),
            title: const Text(
                'I confirm this parcel contains no prohibited, illegal or dangerous goods.'),
            controlAffinity: ListTileControlAffinity.leading)
      ]);
  Widget _optionsPage() {
    final bool expressAvailable = _route?['expressEnabled'] == true ||
        _route?['supportsExpress'] == true ||
        _route?['express'] == true;
    return _scroll(<Widget>[
      const _PageTitle('Delivery options',
          'Your quote is calculated securely by the backend.'),
      _choice(
          'Pickup method',
          _pickupMethod,
          <String, String>{
            'RIDER_PICKUP': 'Rider pickup',
            'BRANCH_DROP_OFF': 'Drop at ServicePay branch / service centre'
          },
          (String v) => setState(() => _pickupMethod = v)),
      _choice(
          'Final delivery',
          _deliveryMethod,
          <String, String>{
            'DOOR_DELIVERY': 'Door delivery',
            'BRANCH_COLLECTION': 'Collect from ServicePay branch / hub'
          },
          (String v) => setState(() => _deliveryMethod = v)),
      _choice(
          'Service type',
          _serviceType,
          <String, String>{
            'STANDARD': 'Standard',
            if (expressAvailable) 'EXPRESS': 'Express'
          },
          (String v) => setState(() => _serviceType = v)),
      SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _protection,
          onChanged: (bool value) => setState(() => _protection = value),
          title: const Text('Add protection when available'))
    ]);
  }

  Widget _pricePage() => _scroll(<Widget>[
        const _PageTitle(
            'Price review', 'This is the authoritative backend quote.'),
        _QuoteCard(quote: _quote ?? <String, dynamic>{}),
        const SizedBox(height: 10),
        const Text(
            'The final amount is verified by ServicePay before your wallet is debited.',
            style: TextStyle(color: ServicePayColors.muted))
      ]);
  Widget _paymentPage() => _scroll(<Widget>[
        const _PageTitle(
            'PIN & payment', 'Confirm with your ServicePay transaction PIN.'),
        _QuoteCard(quote: _quote ?? <String, dynamic>{}),
        const SizedBox(height: 18),
        const ListTile(
            leading: Icon(Icons.lock_outline, color: ServicePayColors.brand),
            title: Text('Secure wallet payment'),
            subtitle: Text(
                'Your PIN is requested only after the shipment is created. Do not share it.'))
      ]);
  Widget _successPage() {
    final Map<String, dynamic> shipment = _shipment ?? <String, dynamic>{};
    final String tracking =
        '${shipment['trackingNumber'] ?? shipment['trackingId'] ?? ''}';
    return _scroll(<Widget>[
      const SizedBox(height: 32),
      const Center(
          child: CircleAvatar(
              radius: 38,
              backgroundColor: ServicePayColors.brandSoft,
              child: Icon(Icons.check_circle,
                  color: ServicePayColors.success, size: 55))),
      const SizedBox(height: 18),
      const Center(
          child: Text('Shipment paid successfully',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
      const SizedBox(height: 8),
      const Center(child: Text('Keep your tracking number safe.')),
      const SizedBox(height: 24),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(children: <Widget>[
            const Text('TRACKING NUMBER',
                style: TextStyle(
                    color: ServicePayColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            SelectableText(
                tracking.isEmpty ? 'Available in My Shipments' : tracking,
                style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: ServicePayColors.brand)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                      builder: (_) =>
                          InterstateTrackingScreen(initialTracking: tracking))),
              icon: const Icon(Icons.location_searching),
              label: const Text('Track parcel'),
            ),
          ]),
        ),
      ),
    ]);
  }

  Widget _field(String key, String label,
          {bool phone = false,
          bool number = false,
          bool required = true,
          int lines = 1}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
              controller: _fields[key],
              maxLines: lines,
              keyboardType: number
                  ? const TextInputType.numberWithOptions(decimal: true)
                  : phone
                      ? TextInputType.phone
                      : TextInputType.text,
              decoration: InputDecoration(labelText: label),
              validator: required
                  ? (String? v) {
                      if (v == null || v.trim().isEmpty)
                        return 'Enter ${label.toLowerCase()}.';
                      if (phone &&
                          !RegExp(r'^[0-9+ ]{10,18}$').hasMatch(v.trim()))
                        return 'Enter a valid phone number.';
                      return null;
                    }
                  : null));
  Widget _heading(String value) => Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 10),
      child: Text(value,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)));
  Widget _choice(String title, String current, Map<String, String> choices,
          ValueChanged<String> change) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        _heading(title),
        ...choices.entries
            .map((MapEntry<String, String> entry) => RadioListTile<String>(
                contentPadding: EdgeInsets.zero,
                value: entry.key,
                groupValue: current,
                title: Text(entry.value),
                onChanged: (String? v) {
                  if (v != null) change(v);
                }))
      ]);
}

class _StepHeader extends StatelessWidget {
  const _StepHeader({required this.step});
  final int step;
  static const List<String> _labels = <String>[
    'Route',
    'People',
    'Parcel',
    'Options',
    'Quote',
    'Payment',
    'Success'
  ];
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('Step ${step + 1} of 7 • ${_labels[step]}',
                style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: ServicePayColors.brand)),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: (step + 1) / 7)
          ]));
}

class _PageTitle extends StatelessWidget {
  const _PageTitle(this.title, this.subtitle);
  final String title;
  final String subtitle;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 6),
            Text(subtitle)
          ]));
}

class _QuoteCard extends StatelessWidget {
  const _QuoteCard({required this.quote});
  final Map<String, dynamic> quote;
  num? _amount(dynamic value) =>
      value is num ? value : num.tryParse('${value ?? ''}'.replaceAll(',', ''));
  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> rows =
        InterstateLogisticsContracts.breakdownRows(quote);
    final num? total =
        _amount(quote['total'] ?? quote['totalAmount'] ?? quote['amount']);
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(children: <Widget>[
              if (rows.isEmpty)
                const Text(
                    'The live quote does not include a display breakdown.')
              else
                ...rows.map((Map<String, dynamic> row) => Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: Row(children: <Widget>[
                      Expanded(
                          child:
                              Text('${row['label'] ?? row['name'] ?? 'Fee'}')),
                      Text(_money(row['amount'] ?? row['value']))
                    ]))),
              const Divider(),
              Row(children: <Widget>[
                const Expanded(
                    child: Text('Total',
                        style: TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 17))),
                Text(total == null ? 'Provided by ServicePay' : _money(total),
                    style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 17,
                        color: ServicePayColors.brand))
              ])
            ])));
  }

  String _money(dynamic value) {
    final num? n = _amount(value);
    return n == null ? '${value ?? '-'}' : '₦${n.toStringAsFixed(2)}';
  }
}

class InterstateTrackingScreen extends StatefulWidget {
  const InterstateTrackingScreen({super.key, this.initialTracking = ''});
  final String initialTracking;
  @override
  State<InterstateTrackingScreen> createState() =>
      _InterstateTrackingScreenState();
}

class _InterstateTrackingScreenState extends State<InterstateTrackingScreen> {
  late final TextEditingController _tracking;
  Map<String, dynamic>? _result;
  bool _busy = false;
  String _error = '';
  @override
  void initState() {
    super.initState();
    _tracking = TextEditingController(text: widget.initialTracking);
    if (widget.initialTracking.isNotEmpty) _track();
  }

  @override
  void dispose() {
    _tracking.dispose();
    super.dispose();
  }

  Future<void> _track() async {
    final String number = _tracking.text.trim().toUpperCase();
    if (number.isEmpty) {
      setState(() => _error = 'Enter a tracking number.');
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
      _result = null;
    });
    try {
      final dynamic root = await _LogisticsApi.get(
          '/track/${Uri.encodeComponent(number)}',
          authenticated: false);
      if (mounted) {
        setState(() =>
            _result = InterstateLogisticsContracts.shipmentWithTimeline(root));
      }
    } catch (e) {
      if (mounted)
        setState(() => _error = e.toString().replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Track Parcel')),
      body: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
        TextField(
            controller: _tracking,
            textCapitalization: TextCapitalization.characters,
            onSubmitted: (_) => _track(),
            decoration: const InputDecoration(
                labelText: 'Tracking number',
                prefixIcon: Icon(Icons.qr_code_2))),
        const SizedBox(height: 12),
        FilledButton.icon(
            onPressed: _busy ? null : _track,
            icon: const Icon(Icons.search),
            label: Text(_busy ? 'Tracking…' : 'Track parcel')),
        if (_error.isNotEmpty)
          Padding(
              padding: const EdgeInsets.only(top: 18),
              child: Text(_error,
                  style: const TextStyle(color: ServicePayColors.danger))),
        if (_result != null) _TrackingResult(shipment: _result!)
      ]));
}

class _TrackingResult extends StatelessWidget {
  const _TrackingResult({required this.shipment});
  final Map<String, dynamic> shipment;
  String _text(dynamic value) => '${value ?? ''}'.trim();
  String _pretty(String v) => v
      .replaceAll('_', ' ')
      .toLowerCase()
      .split(' ')
      .map((String e) =>
          e.isEmpty ? e : '${e[0].toUpperCase()}${e.substring(1)}')
      .join(' ');
  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> timeline = _LogisticsApi.list(
        shipment['timeline'] ??
            shipment['statusHistory'] ??
            shipment['history']);
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(_text(shipment['trackingNumber']),
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 19)),
                const SizedBox(height: 12),
                _line('Route',
                    '${_text(shipment['origin'] ?? shipment['originState'])} → ${_text(shipment['destination'] ?? shipment['destinationState'])}'),
                _line('Current status', _pretty(_text(shipment['status']))),
                _line(
                    'Expected delivery',
                    _text(shipment['expectedDelivery'] ??
                        shipment['expectedDeliveryDate'])),
                const Divider(height: 30),
                const Text('Timeline',
                    style:
                        TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                if (timeline.isEmpty)
                  const Padding(
                      padding: EdgeInsets.only(top: 10),
                      child:
                          Text('No public tracking events are available yet.'))
                else
                  ...timeline.map((Map<String, dynamic> event) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.radio_button_checked,
                          color: ServicePayColors.brand),
                      title: Text(_pretty(_text(event['status']))),
                      subtitle: Text(_text(event['timestamp'] ??
                          event['createdAt'] ??
                          event['date'])))),
              ]),
        ),
      ),
    );
  }

  Widget _line(String label, String value) => Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child:
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        SizedBox(
            width: 130,
            child: Text(label,
                style: const TextStyle(color: ServicePayColors.muted))),
        Expanded(
            child: Text(value.isEmpty ? '—' : value,
                style: const TextStyle(fontWeight: FontWeight.w700)))
      ]));
}

class MyInterstateShipmentsScreen extends StatefulWidget {
  const MyInterstateShipmentsScreen({super.key});
  @override
  State<MyInterstateShipmentsScreen> createState() =>
      _MyInterstateShipmentsScreenState();
}

class _MyInterstateShipmentsScreenState
    extends State<MyInterstateShipmentsScreen> {
  bool _busy = true;
  String _error = '';
  List<Map<String, dynamic>> _shipments = <Map<String, dynamic>>[];
  String _filter = 'All';
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final dynamic root = await _LogisticsApi.get('/shipments/my');
      final Map<String, dynamic> data =
          _LogisticsApi.map(_LogisticsApi.data(root));
      if (mounted)
        setState(() => _shipments = _LogisticsApi.list(
            data['shipments'] ?? (root is Map ? root['shipments'] : root)));
    } catch (e) {
      if (mounted)
        setState(() => _error = e.toString().replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool _show(Map<String, dynamic> s) {
    final String status = '${s['status'] ?? ''}'.toUpperCase();
    if (_filter == 'Active')
      return !<String>['DELIVERED', 'CANCELLED', 'RETURNED'].contains(status);
    return _filter == 'All' || status == _filter.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> shown = _shipments.where(_show).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('My Shipments')),
      body: Column(children: <Widget>[
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.all(12),
          child: Row(
              children: <String>[
            'All',
            'Active',
            'Delivered',
            'Cancelled',
            'Returned'
          ]
                  .map((String filter) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                            label: Text(filter),
                            selected: _filter == filter,
                            onSelected: (_) =>
                                setState(() => _filter = filter)),
                      ))
                  .toList()),
        ),
        Expanded(
          child: _busy
              ? const Center(child: CircularProgressIndicator())
              : _error.isNotEmpty
                  ? _ErrorState(message: _error, retry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: shown.length,
                        itemBuilder: (_, int index) {
                          final Map<String, dynamic> shipment = shown[index];
                          return Card(
                              child: ListTile(
                            contentPadding: const EdgeInsets.all(16),
                            leading: const Icon(Icons.inventory_2_outlined,
                                color: ServicePayColors.brand),
                            title: Text(
                                '${shipment['trackingNumber'] ?? 'Shipment'}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800)),
                            subtitle: Text(
                                '${shipment['originState'] ?? shipment['origin'] ?? ''} → ${shipment['destinationState'] ?? shipment['destination'] ?? ''}\n${shipment['status'] ?? 'Status unavailable'}'),
                            isThreeLine: true,
                            trailing: IconButton(
                              icon: const Icon(Icons.location_searching),
                              tooltip: 'Track shipment',
                              onPressed: () => Navigator.of(context).push(
                                  MaterialPageRoute<void>(
                                      builder: (_) => InterstateTrackingScreen(
                                          initialTracking:
                                              '${shipment['trackingNumber'] ?? ''}'))),
                            ),
                            onTap: () {
                              final String id =
                                  '${shipment['_id'] ?? shipment['id'] ?? ''}';
                              if (id.isNotEmpty) {
                                Navigator.of(context).push(
                                  MaterialPageRoute<void>(
                                    builder: (_) =>
                                        InterstateShipmentDetailScreen(
                                      shipmentId: id,
                                    ),
                                  ),
                                );
                              }
                            },
                          ));
                        },
                      ),
                    ),
        ),
      ]),
    );
  }
}

class InterstateShipmentDetailScreen extends StatefulWidget {
  const InterstateShipmentDetailScreen({super.key, required this.shipmentId});
  final String shipmentId;

  @override
  State<InterstateShipmentDetailScreen> createState() =>
      _InterstateShipmentDetailScreenState();
}

class _InterstateShipmentDetailScreenState
    extends State<InterstateShipmentDetailScreen> {
  Map<String, dynamic>? _shipment;
  String _error = '';
  late final String _adjustmentIdempotencyKey;
  bool _payingAdjustment = false;

  @override
  void initState() {
    super.initState();
    _adjustmentIdempotencyKey = _idempotencyKey();
    _load();
  }

  Future<void> _load() async {
    try {
      final dynamic response =
          await _LogisticsApi.get('/shipments/${widget.shipmentId}');
      if (mounted) {
        setState(() => _shipment =
            InterstateLogisticsContracts.shipmentWithTimeline(response));
      }
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Bad state: ', ''));
      }
    }
  }

  Future<void> _cancel() async {
    try {
      final dynamic response = await _LogisticsApi.post(
          '/shipments/${widget.shipmentId}/cancel', <String, dynamic>{});
      if (mounted) {
        setState(
            () => _shipment = InterstateLogisticsContracts.shipment(response));
        final String message = response is Map
            ? '${response['message'] ?? 'Cancellation request recorded.'}'
            : 'Cancellation request recorded.';
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', ''))));
      }
    }
  }

  Future<void> _payAdjustment() async {
    final String? pin = await showTransactionPinDialog(context);
    if (pin == null || !mounted) return;
    setState(() => _payingAdjustment = true);
    try {
      final dynamic response = await _LogisticsApi.post(
        '/shipments/${widget.shipmentId}/pay-adjustment',
        <String, dynamic>{
          'transactionPin': pin,
          'idempotencyKey': _adjustmentIdempotencyKey,
        },
        idempotencyKey: _adjustmentIdempotencyKey,
      );
      if (mounted) {
        setState(
            () => _shipment = InterstateLogisticsContracts.shipment(response));
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Additional payment completed securely.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', ''))));
      }
    } finally {
      if (mounted) setState(() => _payingAdjustment = false);
    }
  }

  String _idempotencyKey() {
    final Random random = Random.secure();
    final String entropy =
        List<String>.generate(24, (_) => random.nextInt(16).toRadixString(16))
            .join();
    return 'spx-adjust-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-$entropy';
  }

  @override
  Widget build(BuildContext context) {
    if (_shipment == null) {
      return Scaffold(
          appBar: AppBar(title: const Text('Shipment details')),
          body: _error.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _ErrorState(message: _error, retry: _load));
    }
    final String status = '${_shipment!['status'] ?? ''}'.toUpperCase();
    final bool canCancel = <String>[
      'AWAITING_PAYMENT',
      'PAID',
      'AWAITING_PICKUP',
      'PICKUP_ASSIGNED'
    ].contains(status);
    final Map<String, dynamic> adjustment =
        InterstateLogisticsContracts.latestWeightAdjustment(_shipment!);
    final num additionalDue =
        InterstateLogisticsContracts.adjustmentDue(_shipment!);
    return Scaffold(
      appBar: AppBar(title: const Text('Shipment details')),
      body: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
        _TrackingResult(shipment: _shipment!),
        if (adjustment.isNotEmpty)
          Card(
            margin: const EdgeInsets.only(top: 16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text('Verified weight adjustment',
                      style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  Text(
                      'Declared: ${adjustment['declaredWeightKg'] ?? '—'} kg  •  Verified: ${adjustment['verifiedWeightKg'] ?? _shipment!['verifiedWeightKg'] ?? '—'} kg'),
                  const SizedBox(height: 5),
                  Text(
                      'Original: ₦${adjustment['previousTotal'] ?? '—'}  •  Adjusted: ₦${adjustment['adjustedTotal'] ?? '—'}'),
                  if (status == 'ADDITIONAL_PAYMENT_REQUIRED')
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: FilledButton.icon(
                        onPressed: _payingAdjustment ? null : _payAdjustment,
                        icon: _payingAdjustment
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.account_balance_wallet_outlined),
                        label: Text(_payingAdjustment
                            ? 'Processing…'
                            : 'Pay additional ₦${additionalDue.toStringAsFixed(2)}'),
                      ),
                    ),
                ],
              ),
            ),
          ),
        if (canCancel)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: OutlinedButton.icon(
                onPressed: _cancel,
                icon: const Icon(Icons.cancel_outlined),
                label: const Text('Cancel shipment')),
          ),
        if (status == 'CANCELLED' || status == 'REFUND_REVIEW_REQUIRED')
          const Padding(
            padding: EdgeInsets.only(top: 16),
            child: Text(
                'Your refund is under controlled ServicePay review. No refund has been issued to your wallet yet.',
                style: TextStyle(color: ServicePayColors.warning)),
          ),
      ]),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.retry});
  final String message;
  final Future<void> Function() retry;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            const Icon(Icons.cloud_off_outlined,
                size: 42, color: ServicePayColors.warning),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: retry, child: const Text('Try again'))
          ])));
}
