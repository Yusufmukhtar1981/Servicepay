import 'package:flutter/material.dart';

enum PurchasePhase { idle, confirming, processing, success, failed, pending }

/// Transport acceptance is not proof of delivery.
PurchasePhase purchaseOutcome(Map<String, dynamic> result) {
  final status = '${result['status'] ?? ''}'.toUpperCase();
  final reference = '${result['reference'] ?? ''}';
  if (result['pending'] == true ||
      const {'PENDING', 'UNKNOWN', 'READY', 'SENDING'}.contains(status)) {
    return PurchasePhase.pending;
  }
  if (result['success'] == true &&
      reference.isNotEmpty &&
      const {'SUCCESS', 'SUCCESSFUL', 'COMPLETED'}.contains(status)) {
    return PurchasePhase.success;
  }
  final http = result['httpStatus'] is int ? result['httpStatus'] as int : 0;
  if (const {'REFUNDED', 'REVERSED'}.contains(status) ||
      (status == 'FAILED' && result['dispatchStatus'] == 'REFUNDED') ||
      (http >= 400 && http < 500 && http != 409 && reference.isEmpty)) {
    return PurchasePhase.failed;
  }
  return PurchasePhase.pending;
}

/// Blocks navigation and underlying inputs until the financial response arrives.
/// This is route-owned: it never pushes/pops a modal over a subsequent receipt.
class PurchaseProcessing extends StatelessWidget {
  const PurchaseProcessing({
    super.key,
    required this.processing,
    required this.service,
    required this.child,
  });
  final bool processing;
  final String service;
  final Widget child;

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: !processing,
        child: Stack(
          children: [
            child,
            if (processing) ...[
              const Positioned.fill(
                child: ModalBarrier(dismissible: false, color: Colors.black54),
              ),
              Positioned.fill(
                child: Center(
                  child: Semantics(
                    liveRegion: true,
                    label: 'Processing your $service purchase',
                    child: Dialog(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const CircularProgressIndicator(),
                            const SizedBox(height: 20),
                            Text('Processing your $service purchase...',
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 12),
                            const Text(
                              'Please wait. Do not close this page or submit again.',
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      );
}
