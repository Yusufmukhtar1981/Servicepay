import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CardsScreen extends StatefulWidget {
  const CardsScreen({super.key});

  @override
  State<CardsScreen> createState() => _CardsScreenState();
}

class _CardsScreenState extends State<CardsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);
  static const Color softGreen = Color(0xFFEAF7F0);
  static const Color darkText = Color(0xFF172B22);

  bool isLoading = true;
  bool isProcessing = false;
  String errorMessage = '';

  List<Map<String, dynamic>> cards = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    loadCards();
  }

  Future<String> getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    String token = prefs.getString('auth_token') ?? '';

    if (token.toLowerCase().startsWith('bearer ')) {
      token = token.substring(7).trim();
    }

    return token;
  }

  Map<String, String> headers(String token) {
    return <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  dynamic decodeResponse(http.Response response) {
    try {
      return jsonDecode(response.body);
    } catch (_) {
      return <String, dynamic>{
        'message': response.body.isEmpty
            ? 'Unable to process server response.'
            : response.body,
      };
    }
  }

  String responseMessage(dynamic data,
      {String fallback = 'Something went wrong.'}) {
    if (data is Map) {
      final dynamic message = data['message'] ?? data['error'];

      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }

    return fallback;
  }

  List<Map<String, dynamic>> extractCards(dynamic payload) {
    dynamic rawCards;

    if (payload is List) {
      rawCards = payload;
    } else if (payload is Map) {
      rawCards = payload['cards'] ??
          payload['data']?['cards'] ??
          payload['data'] ??
          payload['results'];
    }

    if (rawCards is! List) {
      return <Map<String, dynamic>>[];
    }

    return rawCards
        .whereType<Map>()
        .map(
          (Map item) => item.map(
            (dynamic key, dynamic value) =>
                MapEntry<String, dynamic>(key.toString(), value),
          ),
        )
        .toList();
  }

  Future<void> loadCards() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception('Session expired. Please login again.');
      }

      final http.Response response = await http
          .get(
            Uri.parse('$baseUrl/cards'),
            headers: headers(token),
          )
          .timeout(const Duration(seconds: 35));

      final dynamic data = decodeResponse(response);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        setState(() {
          cards = extractCards(data);
          isLoading = false;
        });
        return;
      }

      throw Exception(
        responseMessage(
          data,
          fallback: 'Unable to load your cards.',
        ),
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> requestVirtualCard() async {
    await requestCard(
      endpoint: '/cards/virtual/request',
      body: const <String, dynamic>{
        'cardType': 'VIRTUAL',
      },
      loadingMessage: 'Creating your virtual card...',
      successFallback: 'Virtual card request submitted successfully.',
    );
  }

  Future<void> requestPhysicalCard() async {
    final TextEditingController addressController = TextEditingController();

    final String? address = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(28),
        ),
      ),
      builder: (BuildContext sheetContext) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            22,
            22,
            22,
            MediaQuery.of(sheetContext).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: softGreen,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(
                      Icons.credit_card_rounded,
                      color: primaryGreen,
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Request Physical Card',
                          style: TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w800,
                            color: darkText,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Enter the address where you want your ServicePay card delivered.',
                          style: TextStyle(
                            fontSize: 13,
                            color: Color(0xFF6C7A72),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              TextField(
                controller: addressController,
                minLines: 3,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  labelText: 'Delivery Address',
                  hintText: 'House number, street, LGA, state...',
                  prefixIcon: const Icon(
                    Icons.location_on_outlined,
                    color: primaryGreen,
                  ),
                  filled: true,
                  fillColor: const Color(0xFFF7FAF8),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(18),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(18),
                    borderSide: const BorderSide(
                      color: Color(0xFFE4ECE7),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(18),
                    borderSide: const BorderSide(
                      color: primaryGreen,
                      width: 1.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: FilledButton.icon(
                  onPressed: () {
                    final String address = addressController.text.trim();

                    if (address.length < 8) {
                      ScaffoldMessenger.of(sheetContext).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Please enter a complete delivery address.',
                          ),
                        ),
                      );
                      return;
                    }

                    Navigator.of(sheetContext).pop(address);
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                  icon: const Icon(Icons.check_circle_outline),
                  label: const Text(
                    'Submit Card Request',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );

    addressController.dispose();

    if (address == null || address.trim().isEmpty) {
      return;
    }

    await requestCard(
      endpoint: '/cards/physical/request',
      body: <String, dynamic>{
        'cardType': 'PHYSICAL',
        'deliveryAddress': address.trim(),
        'address': address.trim(),
      },
      loadingMessage: 'Submitting physical card request...',
      successFallback: 'Physical card request submitted successfully.',
    );
  }

  Future<void> requestCard({
    required String endpoint,
    required Map<String, dynamic> body,
    required String loadingMessage,
    required String successFallback,
  }) async {
    if (isProcessing) return;

    setState(() {
      isProcessing = true;
    });

    showProcessingDialog(loadingMessage);

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception('Session expired. Please login again.');
      }

      final http.Response response = await http
          .post(
            Uri.parse('$baseUrl$endpoint'),
            headers: headers(token),
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 40));

      final dynamic data = decodeResponse(response);

      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        showMessage(
          responseMessage(
            data,
            fallback: successFallback,
          ),
          success: true,
        );

        await loadCards();
        return;
      }

      throw Exception(
        responseMessage(
          data,
          fallback: 'Card request could not be completed.',
        ),
      );
    } catch (e) {
      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }

      if (mounted) {
        showMessage(
          e.toString().replaceFirst('Exception: ', ''),
          success: false,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          isProcessing = false;
        });
      }
    }
  }

  Future<void> changeCardFreezeStatus(
    Map<String, dynamic> card,
    bool freeze,
  ) async {
    final String cardId = (card['_id'] ?? card['id'] ?? '').toString();

    if (cardId.isEmpty) {
      showMessage(
        'Unable to identify this card.',
        success: false,
      );
      return;
    }

    setState(() {
      isProcessing = true;
    });

    try {
      final String token = await getToken();

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/cards/$cardId/${freeze ? 'freeze' : 'unfreeze'}',
            ),
            headers: headers(token),
            body: jsonEncode(<String, dynamic>{}),
          )
          .timeout(const Duration(seconds: 35));

      final dynamic data = decodeResponse(response);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        showMessage(
          responseMessage(
            data,
            fallback: freeze
                ? 'Card frozen successfully.'
                : 'Card unfrozen successfully.',
          ),
          success: true,
        );

        await loadCards();
        return;
      }

      throw Exception(
        responseMessage(
          data,
          fallback: 'Unable to update card.',
        ),
      );
    } catch (e) {
      if (mounted) {
        showMessage(
          e.toString().replaceFirst('Exception: ', ''),
          success: false,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          isProcessing = false;
        });
      }
    }
  }

  void showProcessingDialog(String message) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
          content: Row(
            children: <Widget>[
              const CircularProgressIndicator(
                color: primaryGreen,
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void showMessage(
    String message, {
    required bool success,
  }) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: success ? primaryGreen : const Color(0xFFB42318),
          content: Text(message),
        ),
      );
  }

  String cardType(Map<String, dynamic> card) {
    return (card['cardType'] ?? card['type'] ?? card['card_type'] ?? 'CARD')
        .toString()
        .toUpperCase();
  }

  String cardStatus(Map<String, dynamic> card) {
    return (card['status'] ?? 'PENDING').toString().toUpperCase();
  }

  bool cardIsFrozen(Map<String, dynamic> card) {
    if (card['isFrozen'] == true || card['frozen'] == true) {
      return true;
    }

    final String status = cardStatus(card);
    return status == 'FROZEN' || status == 'BLOCKED';
  }

  String displayCardNumber(Map<String, dynamic> card) {
    final String direct = (card['maskedPan'] ??
            card['maskedCardNumber'] ??
            card['cardNumberMasked'] ??
            '')
        .toString()
        .trim();

    if (direct.isNotEmpty) {
      return direct;
    }

    final String last4 =
        (card['last4'] ?? card['lastFour'] ?? card['lastFourDigits'] ?? '')
            .toString()
            .trim();

    if (last4.isNotEmpty) {
      return '••••  ••••  ••••  $last4';
    }

    return '••••  ••••  ••••  ••••';
  }

  String expiryText(Map<String, dynamic> card) {
    final String month = (card['expiryMonth'] ?? card['expMonth'] ?? '')
        .toString()
        .padLeft(2, '0');

    String year = (card['expiryYear'] ?? card['expYear'] ?? '').toString();

    if (year.length == 4) {
      year = year.substring(2);
    }

    if (month == '00' || month.isEmpty || year.isEmpty) {
      return '--/--';
    }

    return '$month/$year';
  }

  String holderName(Map<String, dynamic> card) {
    final String value = (card['cardHolderName'] ??
            card['holderName'] ??
            card['name'] ??
            'SERVICEPAY CUSTOMER')
        .toString()
        .trim();

    return value.isEmpty ? 'SERVICEPAY CUSTOMER' : value.toUpperCase();
  }

  Color statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'ACTIVE':
      case 'APPROVED':
        return const Color(0xFF08783E);

      case 'REJECTED':
      case 'BLOCKED':
      case 'CANCELLED':
        return const Color(0xFFB42318);

      case 'FROZEN':
        return const Color(0xFF175CD3);

      default:
        return const Color(0xFFB54708);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text(
          'ServicePay Cards',
          style: TextStyle(
            color: darkText,
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading ? null : loadCards,
            icon: const Icon(
              Icons.refresh_rounded,
              color: primaryGreen,
            ),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: RefreshIndicator(
        color: primaryGreen,
        onRefresh: loadCards,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
          children: <Widget>[
            buildHero(),
            const SizedBox(height: 20),
            buildRequestCards(),
            const SizedBox(height: 26),
            Row(
              children: <Widget>[
                const Expanded(
                  child: Text(
                    'My Cards',
                    style: TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                      color: darkText,
                    ),
                  ),
                ),
                if (cards.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: softGreen,
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: Text(
                      '${cards.length}',
                      style: const TextStyle(
                        color: primaryGreen,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            if (isLoading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 50),
                child: Center(
                  child: CircularProgressIndicator(
                    color: primaryGreen,
                  ),
                ),
              )
            else if (errorMessage.isNotEmpty)
              buildError()
            else if (cards.isEmpty)
              buildEmptyState()
            else
              ...cards.map(buildExistingCard),
          ],
        ),
      ),
    );
  }

  Widget buildHero() {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            Color(0xFF075E32),
            Color(0xFF0A8D4A),
          ],
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.credit_card_rounded,
                color: Colors.white,
                size: 32,
              ),
              Spacer(),
              Text(
                'ServicePay',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          SizedBox(height: 28),
          Text(
            'Cards made simple.',
            style: TextStyle(
              color: Colors.white,
              fontSize: 23,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 7),
          Text(
            'Request and manage your Physical and Virtual ServicePay cards from one secure place.',
            style: TextStyle(
              color: Color(0xFFE4F6EC),
              height: 1.45,
              fontSize: 13.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildRequestCards() {
    return Row(
      children: <Widget>[
        Expanded(
          child: buildRequestTile(
            icon: Icons.credit_card_rounded,
            title: 'Physical Card',
            subtitle: 'Request delivery',
            onTap: requestPhysicalCard,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: buildRequestTile(
            icon: Icons.phone_android_rounded,
            title: 'Virtual Card',
            subtitle: 'Request instantly',
            onTap: requestVirtualCard,
          ),
        ),
      ],
    );
  }

  Widget buildRequestTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: isProcessing ? null : onTap,
        child: Container(
          padding: const EdgeInsets.all(17),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: const Color(0xFFE4ECE7),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: softGreen,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(
                  icon,
                  color: primaryGreen,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                title,
                style: const TextStyle(
                  color: darkText,
                  fontWeight: FontWeight.w900,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: const TextStyle(
                  color: Color(0xFF758078),
                  fontSize: 11.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildExistingCard(Map<String, dynamic> card) {
    final String type = cardType(card);
    final String status = cardStatus(card);
    final bool frozen = cardIsFrozen(card);

    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        children: <Widget>[
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(
              minHeight: 205,
            ),
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: type.contains('VIRTUAL')
                    ? const <Color>[
                        Color(0xFF102C25),
                        Color(0xFF08783E),
                      ]
                    : const <Color>[
                        Color(0xFF08783E),
                        Color(0xFF18A35D),
                      ],
              ),
              borderRadius: BorderRadius.circular(28),
              boxShadow: const <BoxShadow>[
                BoxShadow(
                  color: Color(0x2208783E),
                  blurRadius: 20,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    const Text(
                      'ServicePay',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 19,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 11,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(30),
                      ),
                      child: Text(
                        type.contains('VIRTUAL') ? 'VIRTUAL' : 'PHYSICAL',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.7,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 26),
                Text(
                  displayCardNumber(card),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.3,
                  ),
                ),
                const Spacer(),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          const Text(
                            'CARD HOLDER',
                            style: TextStyle(
                              color: Color(0xFFBFE7CE),
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            holderName(card),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        const Text(
                          'VALID THRU',
                          style: TextStyle(
                            color: Color(0xFFBFE7CE),
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          expiryText(card),
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.fromLTRB(14, 11, 9, 11),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(17),
              border: Border.all(
                color: const Color(0xFFE7ECE9),
              ),
            ),
            child: Row(
              children: <Widget>[
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: statusColor(status),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    frozen ? 'FROZEN' : status,
                    style: TextStyle(
                      color: statusColor(
                        frozen ? 'FROZEN' : status,
                      ),
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (status == 'ACTIVE' || status == 'APPROVED' || frozen)
                  TextButton.icon(
                    onPressed: isProcessing
                        ? null
                        : () => changeCardFreezeStatus(
                              card,
                              !frozen,
                            ),
                    icon: Icon(
                      frozen ? Icons.lock_open_rounded : Icons.ac_unit_rounded,
                      size: 17,
                    ),
                    label: Text(
                      frozen ? 'Unfreeze' : 'Freeze',
                    ),
                    style: TextButton.styleFrom(
                      foregroundColor:
                          frozen ? primaryGreen : const Color(0xFF175CD3),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget buildEmptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 42,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFE7ECE9),
        ),
      ),
      child: const Column(
        children: <Widget>[
          CircleAvatar(
            radius: 34,
            backgroundColor: softGreen,
            child: Icon(
              Icons.credit_card_off_rounded,
              size: 31,
              color: primaryGreen,
            ),
          ),
          SizedBox(height: 16),
          Text(
            'No cards yet',
            style: TextStyle(
              color: darkText,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 7),
          Text(
            'Request a Physical or Virtual ServicePay card above to get started.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF758078),
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildError() {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4F2),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        children: <Widget>[
          const Icon(
            Icons.error_outline_rounded,
            size: 38,
            color: Color(0xFFB42318),
          ),
          const SizedBox(height: 12),
          Text(
            errorMessage,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF7A271A),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: loadCards,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Try Again'),
          ),
        ],
      ),
    );
  }
}
