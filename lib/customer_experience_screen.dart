import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'servicepay_theme.dart';
import 'services/receipt_download.dart';
import 'services/session_store.dart';

const String customerExperienceApiRoot = String.fromEnvironment(
  'SERVICEPAY_API_BASE_URL',
  defaultValue: 'https://api.servicepay.ng/api',
);
const String customerExperienceApiBase =
    '$customerExperienceApiRoot/customer-experience';

String formatKobo(dynamic minor) {
  final int value =
      minor is num ? minor.toInt() : int.tryParse(minor?.toString() ?? '') ?? 0;
  final whole = (value.abs() ~/ 100).toString().replaceAllMapped(
        RegExp(r'\B(?=(\d{3})+(?!\d))'),
        (_) => ',',
      );
  final fraction = (value.abs() % 100).toString().padLeft(2, '0');
  return '${value < 0 ? '-' : ''}₦$whole.$fraction';
}

class CustomerExperienceApi {
  CustomerExperienceApi(
      {http.Client? client, this.baseUrl = customerExperienceApiBase})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;
  final http.Client _client;
  final bool _ownsClient;
  final String baseUrl;

  Future<Map<String, String>> _headers(
      {String accept = 'application/json'}) async {
    final String? token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) {
      throw const CustomerExperienceException(
          'Your session has expired. Please sign in again.');
    }
    return <String, String>{
      'Accept': accept,
      'Authorization':
          'Bearer ${token.trim().replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')}',
    };
  }

  Future<Map<String, dynamic>> cashback({int page = 1}) async {
    final response = await _client
        .get(
          Uri.parse('$baseUrl/cashback')
              .replace(queryParameters: {'page': '$page', 'limit': '20'}),
          headers: await _headers(),
        )
        .timeout(const Duration(seconds: 25));
    final data = _json(response);
    final requiredFields = <String>[
      'balanceMinor',
      'totalMinor',
      'monthMinor',
      'yearMinor',
      'history'
    ];
    final missing =
        requiredFields.where((field) => !data.containsKey(field)).toList();
    if (missing.isNotEmpty || data['history'] is! List) {
      throw const CustomerExperienceException(
        'Cashback records are incomplete on the server. Balances and history are unavailable until ServicePay records can be verified.',
      );
    }
    for (final row in (data['history'] as List).whereType<Map>()) {
      if (!row.containsKey('amountMinor') ||
          row['createdAt'] == null ||
          row['reference'] == null ||
          row['status'] == null ||
          row['description'] == null) {
        throw const CustomerExperienceException(
          'Cashback history contains incomplete server evidence. Please contact ServicePay support.',
        );
      }
    }
    return data;
  }

  Future<Uint8List> statement(
      {required DateTime start, required DateTime end}) async {
    final uri = Uri.parse('$baseUrl/statement').replace(queryParameters: {
      'start': _customerDateKey(start),
      'end': _customerDateKey(end),
    });
    final response = await _client
        .get(uri,
            headers:
                await _headers(accept: 'application/pdf, application/json'))
        .timeout(const Duration(seconds: 45));
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        response.headers['content-type']
                ?.toLowerCase()
                .contains('application/pdf') !=
            true) {
      dynamic decoded;
      try {
        decoded = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {}
      final message = decoded is Map ? decoded['message']?.toString() : null;
      throw CustomerExperienceException(message?.isNotEmpty == true
          ? message!
          : 'The server could not prepare a complete statement. Please try again later.');
    }
    return response.bodyBytes;
  }

  Future<Map<String, dynamic>> appUpdate() async {
    final response = await _client
        .get(
          Uri.parse('$baseUrl/app-update'),
          headers: await _headers(),
        )
        .timeout(const Duration(seconds: 15));
    return _json(response);
  }

  Map<String, dynamic> _json(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final result = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        result['success'] == false) {
      throw CustomerExperienceException(result['message']?.toString() ??
          'Unable to load cashback information.');
    }
    return result;
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

class CustomerExperienceException implements Exception {
  const CustomerExperienceException(this.message);
  final String message;
  @override
  String toString() => message;
}

class CashbackScreen extends StatefulWidget {
  const CashbackScreen({super.key, this.api});
  final CustomerExperienceApi? api;
  @override
  State<CashbackScreen> createState() => _CashbackScreenState();
}

class _CashbackScreenState extends State<CashbackScreen> {
  late final CustomerExperienceApi _api = widget.api ?? CustomerExperienceApi();
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;
  int _page = 1;
  int _pages = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Future<void> _load({int page = 1}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final data = await _api.cashback(page: page);
      if (!mounted) return;
      setState(() {
        _data = data;
        _page = int.tryParse('${data['page'] ?? page}') ?? page;
        _pages = (int.tryParse('${data['pages'] ?? 1}') ?? 1).clamp(1, 100000);
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final entries = _data?['history'] is List
        ? (_data!['history'] as List).whereType<Map>().toList()
        : <Map>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Cashback')),
      body: RefreshIndicator(
        onRefresh: () => _load(page: _page),
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [
                  ServicePayColors.brandDeep,
                  ServicePayColors.brand
                ]),
                borderRadius: BorderRadius.circular(22),
              ),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('CASHBACK BALANCE',
                        style: TextStyle(
                            color: Color(0xFFD8F1E3),
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1)),
                    const SizedBox(height: 8),
                    if (_loading && _data == null)
                      const SizedBox(
                          height: 38,
                          width: 38,
                          child: CircularProgressIndicator(
                              color: Colors.white, strokeWidth: 2))
                    else
                      Text(_data == null ? '—' : formatKobo(_data?['balanceMinor']),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 32,
                              fontWeight: FontWeight.w900)),
                    const SizedBox(height: 20),
                    Row(children: [
                      Expanded(
                          child: _metric('THIS MONTH', _data?['monthMinor'])),
                      Expanded(
                          child: _metric('THIS YEAR', _data?['yearMinor'])),
                    ]),
                  ]),
            ),
            const SizedBox(height: 22),
            Row(children: [
              const Expanded(
                  child: Text('Cashback history',
                      style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                          color: ServicePayColors.ink))),
              Text('Page $_page of $_pages',
                  style: const TextStyle(
                      color: ServicePayColors.muted, fontSize: 12)),
            ]),
            const SizedBox(height: 10),
            if (_error != null) _errorPanel(_error!, () => _load(page: _page)),
            if (_loading && _data == null)
              ...List.generate(4, (_) => const _HistorySkeleton()),
            if (!_loading && _error == null && entries.isEmpty)
              _emptyCashback(),
            ...entries.map(_historyRow),
            if (entries.isNotEmpty || _page > 1)
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                OutlinedButton.icon(
                    onPressed: _loading || _page <= 1
                        ? null
                        : () => _load(page: _page - 1),
                    icon: const Icon(Icons.chevron_left),
                    label: const Text('Previous')),
                FilledButton.icon(
                    onPressed: _loading || _page >= _pages
                        ? null
                        : () => _load(page: _page + 1),
                    icon: const Icon(Icons.chevron_right),
                    label: const Text('Next')),
              ]),
            const SizedBox(height: 16),
            const Text(
                'Cashback activity shown here is provided by ServicePay. Cashback cannot be withdrawn, transferred, or converted.',
                style: TextStyle(
                    color: ServicePayColors.muted, fontSize: 12, height: 1.4)),
          ],
        ),
      ),
    );
  }

  Widget _metric(String label, dynamic value) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(
                color: Color(0xFFD8F1E3),
                fontSize: 10,
                fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(_data == null ? '—' : formatKobo(value),
            style: const TextStyle(
                color: Colors.white,
                fontSize: 17,
                fontWeight: FontWeight.w800)),
      ]);

  Widget _historyRow(Map item) {
    final date = DateTime.tryParse('${item['createdAt'] ?? ''}');
    final status =
        (item['status'] ?? 'Unknown').toString().replaceAll('_', ' ');
    return Card(
      margin: const EdgeInsets.only(bottom: 9),
      child: ListTile(
        leading: const CircleAvatar(
            backgroundColor: ServicePayColors.brandSoft,
            child: Icon(Icons.savings_outlined, color: ServicePayColors.accent)),
        title: Text((item['description'] ?? 'Cashback activity').toString(),
            style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(
            '${date == null ? 'Date unavailable' : _dateLabel(date)}  •  $status\nRef: ${item['reference'] ?? 'Not provided'}'),
        isThreeLine: true,
        trailing: Text(formatKobo(item['amountMinor']),
            style: const TextStyle(
                fontWeight: FontWeight.w900, color: ServicePayColors.accent)),
      ),
    );
  }

  Widget _errorPanel(String error, VoidCallback retry) => Container(
        padding: const EdgeInsets.all(16),
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
            color: const Color(0xFF4B2016),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFA8432E))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Cashback unavailable',
              style: TextStyle(
                  fontWeight: FontWeight.w900, color: ServicePayColors.danger)),
          const SizedBox(height: 6),
          Text(error, style: const TextStyle(color: ServicePayColors.ink)),
          Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                  onPressed: retry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'))),
        ]),
      );

  Widget _emptyCashback() => Container(
        padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 20),
        decoration: BoxDecoration(
            color: ServicePayColors.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: ServicePayColors.border)),
        child: const Column(children: [
          Icon(Icons.receipt_long_outlined,
              size: 34, color: ServicePayColors.accent),
          SizedBox(height: 10),
          Text('No cashback activity yet',
              style: TextStyle(
                  fontWeight: FontWeight.w900, color: ServicePayColors.ink)),
          SizedBox(height: 4),
          Text('When cashback activity is recorded, it will appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: ServicePayColors.muted)),
        ]),
      );
}

class _HistorySkeleton extends StatelessWidget {
  const _HistorySkeleton();
  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 9),
        child: const SizedBox(
            height: 78,
            child: Padding(
              padding: EdgeInsets.all(18),
              child: Row(children: [
                CircleAvatar(backgroundColor: ServicePayColors.brandSoft),
                SizedBox(width: 14),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                      _SkeletonBar(width: 160),
                      SizedBox(height: 9),
                      _SkeletonBar(width: 105),
                    ])),
              ]),
            )),
      );
}

class _SkeletonBar extends StatelessWidget {
  const _SkeletonBar({required this.width});
  final double width;
  @override
  Widget build(BuildContext context) => Container(
      width: width,
      height: 9,
      decoration: BoxDecoration(
          color: ServicePayColors.brandSoft,
          borderRadius: BorderRadius.circular(8)));
}

class GenerateStatementScreen extends StatefulWidget {
  const GenerateStatementScreen({super.key, this.api});
  final CustomerExperienceApi? api;
  @override
  State<GenerateStatementScreen> createState() =>
      _GenerateStatementScreenState();
}

class _GenerateStatementScreenState extends State<GenerateStatementScreen> {
  late final CustomerExperienceApi _api = widget.api ?? CustomerExperienceApi();
  DateTimeRange _range = DateTimeRange(
    start: DateTime.now().subtract(const Duration(days: 29)),
    end: DateTime.now(),
  );
  bool _busy = false;
  @override
  void dispose() {
    if (widget.api == null) _api.close();
    super.dispose();
  }

  String _dateKey(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  Future<void> _pickRange() async {
    final selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime.now(),
      initialDateRange: _range,
      helpText: 'Choose statement dates',
    );
    if (selected != null && mounted) setState(() => _range = selected);
  }

  Future<void> _generate({required bool share}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final bytes = await _api.statement(start: _range.start, end: _range.end);
      final fileName =
          'servicepay-statement-${_dateKey(_range.start)}-${_dateKey(_range.end)}.pdf';
      if (share) {
        await SharePlus.instance.share(ShareParams(files: [
          XFile.fromData(bytes, mimeType: 'application/pdf', name: fileName)
        ], fileNameOverrides: [
          fileName
        ]));
      } else {
        final message = await downloadReceiptBytes(bytes, fileName,
            mimeType: 'application/pdf');
        if (mounted) _message(message);
      }
    } catch (error) {
      if (mounted) _message(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _message(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Generate Statement')),
        body: ListView(padding: const EdgeInsets.all(18), children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
                color: ServicePayColors.brand,
                borderRadius: BorderRadius.circular(22)),
            child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.picture_as_pdf_outlined,
                      color: Colors.white, size: 32),
                  SizedBox(height: 14),
                  Text('Your account, clearly stated.',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w900)),
                  SizedBox(height: 6),
                  Text(
                      'A PDF statement prepared from ServicePay records for your selected dates.',
                      style: TextStyle(color: Color(0xFFE0F2E8), height: 1.4)),
                ]),
          ),
          const SizedBox(height: 22),
          const Text('STATEMENT PERIOD',
              style: TextStyle(
                  fontSize: 11,
                  letterSpacing: 1,
                  fontWeight: FontWeight.w900,
                  color: ServicePayColors.muted)),
          const SizedBox(height: 9),
          Card(
              child: ListTile(
            leading: const Icon(Icons.calendar_month_outlined,
                color: ServicePayColors.accent),
            title: Text('${_dateKey(_range.start)}  —  ${_dateKey(_range.end)}',
                style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: const Text('Select a start and end date'),
            trailing: const Icon(Icons.edit_calendar_outlined),
            onTap: _busy ? null : _pickRange,
          )),
          const SizedBox(height: 14),
          const Text(
              'Balances and transaction records are prepared by the server. ServicePay does not estimate or calculate statement balances on this device.',
              style: TextStyle(color: ServicePayColors.muted, height: 1.45)),
          const SizedBox(height: 26),
          FilledButton.icon(
              onPressed: _busy ? null : () => _generate(share: false),
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.download_outlined),
              label: Text(
                  _busy ? 'Preparing secure PDF…' : 'Generate & download PDF')),
          const SizedBox(height: 10),
          OutlinedButton.icon(
              onPressed: _busy ? null : () => _generate(share: true),
              icon: const Icon(Icons.ios_share_outlined),
              label: const Text('Generate & share PDF')),
        ]),
      );
}

String _dateLabel(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year}';

String _customerDateKey(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

/// Native Android reports its actual installed package version. The channel is
/// deliberately unavailable on web and other platforms.
class InstalledAppVersion {
  const InstalledAppVersion(
      {required this.versionName, required this.versionCode});
  final String versionName;
  final int versionCode;
  static const MethodChannel _channel =
      MethodChannel('ng.servicepay.app/version');
  static Future<InstalledAppVersion?> read(
      {required bool isWeb, required TargetPlatform platform}) async {
    if (isWeb || platform != TargetPlatform.android) return null;
    try {
      final result =
          await _channel.invokeMapMethod<String, dynamic>('getVersion');
      if (result == null) return null;
      final code = result['versionCode'];
      return InstalledAppVersion(
        versionName: result['versionName']?.toString() ?? '',
        versionCode: code is num ? code.toInt() : int.tryParse('$code') ?? 0,
      );
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }
}

bool shouldRequireUpdate({
  required bool active,
  required int installedVersionCode,
  required int minimumVersionCode,
  int? latestVersionCode,
  required bool forceUpdate,
}) =>
    active &&
    forceUpdate &&
    installedVersionCode < (latestVersionCode ?? minimumVersionCode);

bool shouldOfferOptionalUpdate({
  required bool active,
  required int installedVersionCode,
  required int latestVersionCode,
  required int dismissedLatestVersionCode,
}) =>
    active &&
    installedVersionCode < latestVersionCode &&
    dismissedLatestVersionCode != latestVersionCode;

Future<void> persistDismissedUpdate(int latestVersionCode) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setInt('servicepay_dismissed_update_latest', latestVersionCode);
}

Future<int> dismissedUpdateVersion() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getInt('servicepay_dismissed_update_latest') ?? -1;
}

Future<void> checkCustomerAppUpdate({
  required BuildContext context,
  required bool isWeb,
  required TargetPlatform platform,
  required CustomerExperienceApi api,
}) async {
  if (isWeb || platform != TargetPlatform.android) return;
  final installed =
      await InstalledAppVersion.read(isWeb: isWeb, platform: platform);
  if (installed == null || !context.mounted) return;
  try {
    final response = await api.appUpdate();
    final raw = response['update'];
    if (raw is! Map || raw['active'] != true || !context.mounted) return;
    final update = Map<String, dynamic>.from(raw);
    final latestCode = int.tryParse('${update['latestVersionCode'] ?? 0}') ?? 0;
    final minimumCode =
        int.tryParse('${update['minimumVersionCode'] ?? 0}') ?? 0;
    final force = update['forceUpdate'] == true &&
        shouldRequireUpdate(
            active: true,
            installedVersionCode: installed.versionCode,
            minimumVersionCode: minimumCode,
            latestVersionCode: latestCode,
            forceUpdate: true);
    final dismissed = await dismissedUpdateVersion();
    final optional = shouldOfferOptionalUpdate(
      active: true,
      installedVersionCode: installed.versionCode,
      latestVersionCode: latestCode,
      dismissedLatestVersionCode: dismissed,
    );
    if ((!force && !optional) || !context.mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: !force,
      builder: (dialogContext) => PopScope(
        canPop: !force,
        child: AlertDialog(
          title:
              Text((update['releaseTitle'] ?? 'ServicePay update').toString()),
          content: SingleChildScrollView(
              child: Text(
            (update['releaseNotes'] ??
                    'A newer version of ServicePay is available.')
                .toString(),
          )),
          actions: [
            if (!force)
              TextButton(
                onPressed: () async {
                  await persistDismissedUpdate(latestCode);
                  if (dialogContext.mounted) Navigator.of(dialogContext).pop();
                },
                child: const Text('Not now'),
              ),
            FilledButton(
              onPressed: () => launchUrl(
                Uri.parse(
                    'https://play.google.com/store/apps/details?id=ng.servicepay.app'),
                mode: LaunchMode.externalApplication,
              ),
              child: const Text('Update now'),
            ),
          ],
        ),
      ),
    );
  } catch (_) {
    // An unavailable version endpoint must never lock an offline customer out.
  }
}
