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
    this.requestId,
    this.pending = false,
    this.nonBlocking = false,
  });
  final bool processing;
  final bool pending;
  final bool nonBlocking;
  final String service;
  final Widget child;
  final String? requestId;

  @override
  Widget build(BuildContext context) {
    final visible = processing || pending;
    final isBillPayment =
        const ['DATA', 'AIRTIME'].contains(service.toUpperCase());
    final statusLabel = pending
        ? 'PROCESSING — check History for updates.'
        : isBillPayment
            ? 'Processing your transaction. Please wait.'
            : 'Processing your $service purchase...';

    if (nonBlocking) {
      return Stack(
        children: [
          child,
          if (visible)
            Positioned(
              top: 8,
              left: 12,
              right: 12,
              child: IgnorePointer(
                child: SafeArea(
                  bottom: false,
                  child: Semantics(
                    liveRegion: true,
                    label: pending
                        ? 'Purchase status processing. Check History for updates.'
                        : 'Processing your $service purchase',
                    child: Material(
                      elevation: 4,
                      color: Theme.of(context).colorScheme.surface,
                      borderRadius: BorderRadius.circular(14),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 12),
                        child: Row(
                          children: [
                            if (processing)
                              const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2.2),
                              )
                            else
                              const Icon(Icons.pending_actions_rounded),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(statusLabel,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleSmall),
                                  if (pending)
                                    const Text(
                                      'Your request key is saved. Do not submit again.',
                                    ),
                                  if (requestId?.isNotEmpty == true)
                                    Text(
                                      'Request ID: $requestId',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      );
    }

    return PopScope(
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
                          Text(statusLabel,
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 12),
                          if (requestId?.isNotEmpty == true)
                            Text('Request ID: $requestId',
                                textAlign: TextAlign.center),
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
}
