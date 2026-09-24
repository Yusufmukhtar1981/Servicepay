import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'biometric_auth_service.dart';

class TransactionAuthorizationService {
  static const transfer = 'TRANSFER';
  static const withdrawal = 'WITHDRAWAL';
  static const marketplaceOrder = 'MARKETPLACE_ORDER';
  static const electricityPayment = 'ELECTRICITY_PAYMENT';
  static const airtimePurchase = 'AIRTIME_PURCHASE';
  static const dataPurchase = 'DATA_PURCHASE';
  static const solarPayment = 'SOLAR_PAYMENT';
  static const solarFinancePayment = 'SOLAR_FINANCE_PAYMENT';
  static const phoneFinancingDeposit = 'PHONE_FINANCING_DEPOSIT';
  static const phoneFinancingInstallment = 'PHONE_FINANCING_INSTALLMENT';
  static const riderWithdrawal = 'RIDER_WITHDRAWAL';
  static const requestMoneyPayment = 'REQUEST_MONEY_PAYMENT';
  static const payLinkPayment = 'PAY_LINK_PAYMENT';
  static const groupWalletContribution = 'GROUP_WALLET_CONTRIBUTION';
  static const organizationPayment = 'ORGANIZATION_PAYMENT';
  static const treasuryWithdrawal = 'ORGANIZATION_TREASURY_WITHDRAWAL';
  static const bankTransfer = 'BANK_TRANSFER';
  static const trustFund = 'TRUST_FUND';
  static const trustRelease = 'TRUST_RELEASE';
  static const interstatePayment = 'INTERSTATE_PAYMENT';
  static const interstateAdjustment = 'INTERSTATE_ADJUSTMENT';
  static const edupayContribution = 'EDUPAY_CONTRIBUTION';
  static const edupaySponsorContribution = 'EDUPAY_SPONSOR_CONTRIBUTION';
  static const edupayRepayment = 'EDUPAY_REPAYMENT';

  /// Populated only by the security settings screen after a successful
  /// server response for this device. Payments must remain PIN-only otherwise.
  static bool transactionBiometricsEnabled = false;

  static void setTransactionBiometricsEnabled(bool enabled) {
    transactionBiometricsEnabled = enabled;
  }

  TransactionAuthorizationService({
    BiometricAuthService? biometrics,
    http.Client? client,
  })  : _biometrics = biometrics ?? BiometricAuthService(),
        _client = client ?? http.Client();
  final BiometricAuthService _biometrics;
  final http.Client _client;
  static const baseUrl = BiometricAuthService.baseUrl;

  /// Refresh the server-backed flag before falling back to PIN. The static
  /// value is only an optimization for the current process; it is not an
  /// authorization decision and is never trusted by the backend.
  Future<bool> _refreshEnabled(String token) async {
    try {
      final settings = await _biometrics.settings(token);
      final localId = await _biometrics.deviceId();
      final enabled = settings != null &&
          settings.transactionEnabled &&
          localId != null &&
          localId == settings.deviceId;
      setTransactionBiometricsEnabled(enabled);
      return enabled;
    } catch (_) {
      setTransactionBiometricsEnabled(false);
      return false;
    }
  }

  /// Returns the server-backed authorization state for this device without
  /// reading the biometric credential. The credential is only requested after
  /// the user chooses biometrics for a specific transaction.
  Future<bool> isTransactionAuthorizationEnabled(String token) =>
      _refreshEnabled(token);

  /// Matches the backend canonical intent binding exactly.
  static String intentHash({
    required String operation,
    required String idempotencyKey,
    required Map<String, dynamic> body,
  }) {
    final canonical = _canonicalize(body);
    return sha256
        .convert(
          utf8.encode('$operation:$idempotencyKey:${jsonEncode(canonical)}'),
        )
        .toString();
  }

  static dynamic _canonicalize(dynamic value) {
    if (value is Map) {
      final keys = value.keys.map((key) => key.toString()).toList()..sort();
      return <String, dynamic>{
        for (final key in keys)
          if (!const {
            'transactionPin',
            'pin',
            'biometricGrant',
            'authorization',
            'auth',
            'token',
            'deviceId',
            'idempotencyKey',
          }.contains(key))
            key: _canonicalize(value[key]),
      };
    }
    if (value is List) return value.map(_canonicalize).toList();
    return value;
  }

  Future<String?> authorizeTransaction({
    required String token,
    required String operation,
    required Map<String, dynamic> requestBody,
    required String idempotencyKey,
  }) async {
    try {
      if (!transactionBiometricsEnabled && !await _refreshEnabled(token)) {
        return null;
      }
      if (!await _biometrics.isEnrolled()) {
        setTransactionBiometricsEnabled(false);
        return null;
      }
      final deviceId = await _biometrics.deviceId();
      if (deviceId == null) {
        setTransactionBiometricsEnabled(false);
        return null;
      }
      final credential = await _biometrics.credentialAfterAuthentication();
      if (credential == null || credential.isEmpty) return null;
      final hash = intentHash(
        operation: operation,
        idempotencyKey: idempotencyKey,
        body: requestBody,
      );
      final response = await _client.post(
        Uri.parse('$baseUrl/auth/biometric/grant'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'deviceId': deviceId,
          'credential': credential,
          'operation': operation,
          'intentHash': hash,
          'idempotencyKey': idempotencyKey,
          'intent': requestBody,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) return null;
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final nextCredential = data['credential']?.toString();
      if (nextCredential != null) {
        await _biometrics.rotateCredential(nextCredential);
      }
      return data['biometricGrant']?.toString();
    } catch (_) {
      // Biometric authorization is optional; callers retain their PIN path.
      return null;
    }
  }
}
