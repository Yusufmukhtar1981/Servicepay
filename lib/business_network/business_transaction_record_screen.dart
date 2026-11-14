import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../services/receipt_download.dart';

/// A scoped Business Network record, not a provider receipt or proof of
/// settlement. Values are displayed exactly from the authenticated API record.
class BusinessTransactionRecordScreen extends StatefulWidget {
  const BusinessTransactionRecordScreen({
    super.key,
    required this.transaction,
  });

  final Map<String, dynamic> transaction;

  @override
  State<BusinessTransactionRecordScreen> createState() =>
      _BusinessTransactionRecordScreenState();
}

class _BusinessTransactionRecordScreenState
    extends State<BusinessTransactionRecordScreen> {
  bool _busy = false;

  String get _recordText {
    final transaction = widget.transaction;
    final amount = transaction['amountKobo'];
    final amountLabel = amount is num
        ? '₦${(amount / 100).toStringAsFixed(2)}'
        : 'Not supplied';
    return <String>[
      'SERVICEPAY BUSINESS TRANSACTION RECORD',
      'This is a record from the Business Network API, not provider confirmation or proof of settlement.',
      'Reference: ${transaction['reference'] ?? transaction['_id'] ?? 'Not supplied'}',
      'Service: ${transaction['serviceType'] ?? 'Not supplied'}',
      'Amount: $amountLabel',
      'Status: ${transaction['status'] ?? 'Not supplied'}',
      'Created: ${transaction['createdAt'] ?? 'Not supplied'}',
      if (transaction['branch'] != null)
        'Branch: ${transaction['branch']}',
    ].join('\n');
  }

  String get _fileName {
    final raw =
        (widget.transaction['reference'] ?? widget.transaction['_id'] ?? 'record')
            .toString();
    final safe = raw.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'servicepay-business-record-${safe.isEmpty ? 'record' : safe}.txt';
  }

  Future<void> _download() async {
    setState(() => _busy = true);
    try {
      final message = await downloadReceiptBytes(
        Uint8List.fromList(utf8.encode(_recordText)),
        _fileName,
        mimeType: 'text/plain;charset=utf-8',
      );
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Unable to save the business record: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _share() async {
    setState(() => _busy = true);
    try {
      await SharePlus.instance.share(ShareParams(
        text: _recordText,
        files: <XFile>[
          XFile.fromData(
            Uint8List.fromList(utf8.encode(_recordText)),
            mimeType: 'text/plain',
            name: _fileName,
          ),
        ],
      ));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Unable to share the business record: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final transaction = widget.transaction;
    return Scaffold(
      appBar: AppBar(title: const Text('Business transaction record')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFE8F3EC),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Text(
              'This business record reflects data returned by ServicePay. It is not a provider receipt, payment confirmation, or proof of settlement.',
              style: TextStyle(height: 1.45),
            ),
          ),
          const SizedBox(height: 18),
          _recordField('Reference',
              (transaction['reference'] ?? transaction['_id'])?.toString()),
          _recordField('Service', transaction['serviceType']?.toString()),
          _recordField('Amount', _recordText.split('\n').firstWhere(
            (line) => line.startsWith('Amount: '),
          ).replaceFirst('Amount: ', '')),
          _recordField('Status', transaction['status']?.toString()),
          _recordField('Created', transaction['createdAt']?.toString()),
          if (transaction['branch'] != null)
            _recordField('Branch', transaction['branch'].toString()),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: _busy ? null : _download,
            icon: const Icon(Icons.download_outlined),
            label: const Text('Download record'),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _busy ? null : _share,
            icon: const Icon(Icons.share_outlined),
            label: const Text('Share record'),
          ),
        ],
      ),
    );
  }

  Widget _recordField(String label, String? value) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label, style: const TextStyle(color: Color(0xFF66756D))),
        subtitle: Text(
          value?.isNotEmpty == true ? value! : 'Not supplied by the API',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      );
}
