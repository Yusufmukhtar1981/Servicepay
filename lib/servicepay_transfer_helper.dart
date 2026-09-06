import 'dart:convert';
import 'dart:math' as math;
import 'package:shared_preferences/shared_preferences.dart';

enum ServicePayTransferState { success, failed, pending }

class ServicePayTransferResult {
  const ServicePayTransferResult({
    required this.state,
    required this.data,
    required this.message,
  });

  final ServicePayTransferState state;
  final Map<String, dynamic> data;
  final String message;
}

class PendingServicePayTransfer {
  const PendingServicePayTransfer({
    required this.reference,
    required this.idempotencyKey,
    required this.receiverPhone,
    required this.amount,
    required this.flowType,
    required this.createdAt,
  });
  final String reference;
  final String idempotencyKey;
  final String receiverPhone;
  final double amount;
  final String flowType;
  final DateTime createdAt;
}

const _pendingIntentPreference = 'servicepay_pending_transfer_intent';

String? servicePayAccountScope(SharedPreferences preferences) {
  final id = preferences.getString('user_id')?.trim() ?? '';
  final phone = preferences.getString('user_phone')?.trim() ?? '';
  if (id.isEmpty && phone.isEmpty) return null;
  return '$id|$phone';
}

Future<void> savePendingServicePayTransfer(
  SharedPreferences preferences,
  PendingServicePayTransfer intent,
) async {
  final scope = servicePayAccountScope(preferences);
  if (scope == null) return;
  await preferences.setString(_pendingIntentPreference, jsonEncode({
    'accountScope': scope,
    'reference': intent.reference,
    'idempotencyKey': intent.idempotencyKey,
    'receiverPhone': intent.receiverPhone,
    'amount': intent.amount,
    'flowType': intent.flowType,
    'createdAt': intent.createdAt.toUtc().toIso8601String(),
  }));
}

PendingServicePayTransfer? restorePendingServicePayTransfer(
  SharedPreferences preferences, {
  required String flowType,
}) {
  final scope = servicePayAccountScope(preferences);
  final raw = preferences.getString(_pendingIntentPreference);
  if (scope == null || raw == null) {
    return null;
  }
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map ||
        decoded['accountScope'] != scope ||
        decoded['flowType'] != flowType) {
      return null;
    }
    final reference = decoded['reference']?.toString() ?? '';
    final key = decoded['idempotencyKey']?.toString() ?? '';
    final phone = decoded['receiverPhone']?.toString() ?? '';
    final amount = double.tryParse(decoded['amount']?.toString() ?? '');
    final createdAt = DateTime.tryParse(decoded['createdAt']?.toString() ?? '');
    if (reference.isEmpty || key.isEmpty || phone.isEmpty || amount == null ||
        createdAt == null) {
      return null;
    }
    return PendingServicePayTransfer(
      reference: reference, idempotencyKey: key, receiverPhone: phone,
      amount: amount, flowType: flowType, createdAt: createdAt);
  } catch (_) {
    return null;
  }
}

Future<void> clearPendingServicePayTransfer(
    SharedPreferences preferences) =>
    preferences.remove(_pendingIntentPreference);

String newServicePayClientReference() {
  final random = math.Random.secure();
  final entropy = List<int>.generate(16, (_) => random.nextInt(256))
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return 'SPC-${DateTime.now().microsecondsSinceEpoch}-$entropy';
}

Map<String, dynamic> decodeServicePayResponse(String body) {
  try {
    final dynamic decoded = jsonDecode(body);
    return decoded is Map ? Map<String, dynamic>.from(decoded) : {};
  } catch (_) {
    return {};
  }
}

Map<String, dynamic> servicePayData(Map<String, dynamic> root) {
  final dynamic data = root['data'];
  return data is Map ? Map<String, dynamic>.from(data) : root;
}

String servicePayMessage(Map<String, dynamic> root, Map<String, dynamic> data,
    {required String fallback}) {
  final String value =
      (root['message'] ?? root['error'] ?? data['message'] ?? data['error'])
              ?.toString()
              .trim() ??
          '';
  return value.isEmpty ? fallback : value;
}

String servicePayStatus(Map<String, dynamic> data) {
  final dynamic receipt = data['receipt'];
  return (data['status'] ??
          data['paymentStatus'] ??
          (receipt is Map ? receipt['status'] : null) ??
          '')
      .toString()
      .trim()
      .toUpperCase();
}

ServicePayTransferResult parseServicePayTransferResponse({
  required int statusCode,
  required Map<String, dynamic> root,
}) {
  final data = servicePayData(root);
  final status = servicePayStatus(data);
  final message = servicePayMessage(root, data,
      fallback: 'Payment could not be completed.');
  final code = (root['code'] ?? data['code'] ?? '').toString().toUpperCase();
  final pending = status == 'PENDING' ||
      status == 'PROCESSING' ||
      status == 'IN_PROGRESS' ||
      code == 'TRANSFER_PENDING' ||
      code == 'TRANSFER_RESULT_UNCONFIRMED' ||
      code == 'TRANSFER_TEMPORARILY_UNAVAILABLE' ||
      status == 'TRANSFER_PENDING' ||
      status == 'TRANSFER_RESULT_UNCONFIRMED' ||
      status == 'TRANSFER_TEMPORARILY_UNAVAILABLE' ||
      statusCode == 202 ||
      statusCode == 404;
  if (pending) {
    return const ServicePayTransferResult(
      state: ServicePayTransferState.pending,
      data: <String, dynamic>{},
      message: 'Payment is being confirmed.',
    );
  }
  final failed = status == 'FAILED' ||
      status == 'FAIL' ||
      status == 'DECLINED' ||
      status == 'CANCELLED' ||
      root['success'] == false ||
      data['success'] == false;
  final successful = status == 'SUCCESS' ||
      status == 'SUCCESSFUL' ||
      status == 'COMPLETED' ||
      status == 'PAID';
  if (statusCode >= 200 && statusCode < 300 && successful && !failed) {
    return ServicePayTransferResult(
        state: ServicePayTransferState.success, data: data, message: message);
  }
  if (failed) {
    return ServicePayTransferResult(
        state: ServicePayTransferState.failed, data: data, message: message);
  }
  return ServicePayTransferResult(
      state: ServicePayTransferState.pending,
      data: data,
      message: 'Payment is being confirmed.');
}