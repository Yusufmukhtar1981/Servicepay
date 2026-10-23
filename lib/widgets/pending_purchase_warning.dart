import 'dart:async';
import 'package:flutter/material.dart';

typedef PendingPurchaseContextLoader = Future<Map<String, dynamic>> Function(
    Map<String, String> query);

/// null = cancelled; false = no earlier request; true = explicitly acknowledged.
Future<bool?> acknowledgeNewBillPurchase(
  BuildContext context, {
  required PendingPurchaseContextLoader load,
  required String service,
  required String phone,
  required String network,
  String? planCode,
  required bool localPending,
}) async {
  bool uncertain = false;
  bool pending = localPending;
  bool matching = false;
  try {
    final result = await load({
      'serviceType': service,
      'phone': phone,
      'network': network,
      if (planCode != null) 'planCode': planCode,
    }).timeout(const Duration(seconds: 6));
    if (result['httpStatus'] == 401 || result['httpStatus'] == 403) {
      throw StateError('Please sign in again before purchasing.');
    }
    uncertain = result['success'] != true || result['pendingCount'] is! num;
    pending = pending || (result['pendingCount'] as num? ?? 0) > 0;
    matching = (result['matchingPendingCount'] as num? ?? 0) > 0;
  } on StateError {
    rethrow;
  } catch (_) {
    uncertain = true;
  }
  if (!context.mounted) return null;
  if (!pending && !uncertain) return false;
  bool completed = false;
  return await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Confirm a new purchase'),
      content: Text(
        '${uncertain ? "We could not check all earlier requests. " : ""}'
        '${matching ? "An earlier purchase for this same number${service == "DATA" ? " and plan" : ""} is still awaiting confirmation. " : "An earlier purchase may still complete. "}'
        'It will not be retried, cancelled or refunded by this action. '
        'Continuing authorises a NEW purchase with its own reference and a '
        'separate wallet charge. Both purchases could be delivered.',
      ),
      actions: [
        TextButton(
            onPressed: () {
              if (completed) return;
              completed = true;
              Navigator.pop(dialogContext);
            },
            child: const Text('Cancel')),
        FilledButton(
            onPressed: () {
              if (completed) return;
              completed = true;
              Navigator.pop(dialogContext, true);
            },
            child: const Text('I understand — new purchase')),
      ],
    ),
  );
}
