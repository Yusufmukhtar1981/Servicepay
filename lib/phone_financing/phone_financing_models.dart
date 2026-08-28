class PhoneProduct {
  const PhoneProduct({
    required this.id,
    required this.name,
    required this.brand,
    required this.cashPrice,
    required this.financedPrice,
    required this.depositPercent,
    required this.weeklyInstallments,
    required this.stock,
    this.description = '',
    this.interestPercent = 0,
    this.minimumKycTier = '',
    this.durationOptionsWeeks = const <int>[],
    this.terms = const <String, dynamic>{},
    this.specifications = const <String, dynamic>{},
    this.images = const <String>[],
    this.active = true,
  });
  final String id, name, brand, description;
  final double cashPrice, financedPrice, depositPercent, interestPercent;
  final String minimumKycTier;
  final List<int> durationOptionsWeeks;
  final int weeklyInstallments, stock;
  final Map<String, dynamic> terms, specifications;
  final List<String> images;
  final bool active;
  double get deposit => financedPrice * depositPercent / 100;
  double get totalPayable => financedPrice * (1 + interestPercent / 100);
  /// Mirrors the server: interest is applied before the financed remainder is
  /// divided. The server adjusts only the last row for rounding.
  double weeklyFor(int weeks) => weeks == 0 ? 0 : (totalPayable - deposit) / weeks;
  double get weekly => weeklyFor(weeklyInstallments);
  factory PhoneProduct.fromJson(Map<String, dynamic> j) => PhoneProduct(
    id: '${j['_id'] ?? j['id'] ?? ''}', name: '${j['name'] ?? ''}', brand: '${j['brand'] ?? ''}',
    description: '${j['description'] ?? ''}', cashPrice: _number(j['cashPrice']), financedPrice: _number(j['financedPrice']),
    depositPercent: _number(j['depositPercent']), interestPercent: _number(j['interestPercent']), minimumKycTier: '${j['minimumKycTier'] ?? ''}',
    durationOptionsWeeks: j['durationOptionsWeeks'] is List ? (j['durationOptionsWeeks'] as List).map((e) => _number(e).round()).toList() : const <int>[],
    weeklyInstallments: _number(j['weeklyInstallments']).round(), stock: _number(j['stock']).round(),
    terms: _map(j['terms']), specifications: _map(j['specifications']),
    images: (j['images'] is List ? (j['images'] as List).map((e) => '$e').toList() : const <String>[]),
    active: j['active'] != false,
  );
}

class PhoneApplication {
  const PhoneApplication({required this.id, required this.status, required this.reference, required this.product, this.history = const [], this.depositRequired = 0, this.depositPaid = 0, this.input = const <String, dynamic>{}});
  final String id, status, reference;
  final PhoneProduct? product;
  final List<Map<String, dynamic>> history;
  final double depositRequired, depositPaid;
  final Map<String, dynamic> input;
  factory PhoneApplication.fromJson(Map<String, dynamic> j) => PhoneApplication(
    id: '${j['_id'] ?? j['id'] ?? ''}', status: '${j['status'] ?? 'SUBMITTED'}', reference: '${j['reference'] ?? ''}',
    product: j['productSnapshot'] is Map ? PhoneProduct.fromJson(Map<String, dynamic>.from(j['productSnapshot'])) : (j['product'] is Map ? PhoneProduct.fromJson(Map<String, dynamic>.from(j['product'])) : null),
    history: j['statusHistory'] is List ? (j['statusHistory'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [],
    depositRequired: _number(j['depositRequired']), depositPaid: _number(j['depositPaid']), input: _map(j['applicationInput']),
  );
}

class PhoneFinance {
  const PhoneFinance({required this.id, required this.reference, required this.status, required this.total, required this.paid, required this.outstanding, this.schedule = const [], this.product, this.device = const <String, dynamic>{}});
  final String id, reference, status;
  final double total, paid, outstanding;
  final List<Map<String, dynamic>> schedule;
  final PhoneProduct? product;
  final Map<String, dynamic> device;
  factory PhoneFinance.fromJson(Map<String, dynamic> j) => PhoneFinance(
    id: '${j['_id'] ?? j['id'] ?? ''}', reference: '${j['reference'] ?? ''}', status: '${j['status'] ?? 'ACTIVE'}',
    total: _number(j['totalPayable']), paid: _number(j['amountPaid']), outstanding: _number(j['outstandingBalance']),
    schedule: j['paymentSchedule'] is List ? (j['paymentSchedule'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [],
    product: j['termsSnapshot'] is Map && (j['termsSnapshot'] as Map)['product'] is Map ? PhoneProduct.fromJson(Map<String, dynamic>.from((j['termsSnapshot'] as Map)['product'])) : null,
    device: _map(j['device']),
  );
}

double _number(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};