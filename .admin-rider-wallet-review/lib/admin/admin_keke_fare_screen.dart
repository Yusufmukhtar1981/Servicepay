import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminKekeFareScreen extends StatefulWidget {
  const AdminKekeFareScreen({
    super.key,
  });

  @override
  State<AdminKekeFareScreen> createState() =>
      _AdminKekeFareScreenState();
}

class _AdminKekeFareScreenState
    extends State<AdminKekeFareScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF0F766E);

  bool isLoading = true;
  bool isSavingGlobal = false;
  bool isSavingState = false;
  bool isDeletingState = false;

  String? errorMessage;

  final TextEditingController
      baseFareController =
      TextEditingController();

  final TextEditingController
      minimumFareController =
      TextEditingController();

  final TextEditingController
      pricePerKmController =
      TextEditingController();

  final TextEditingController
      waitingFeeController =
      TextEditingController();

  final TextEditingController
      commissionController =
      TextEditingController();

  final TextEditingController
      searchRadiusController =
      TextEditingController();

  final TextEditingController
      offerSecondsController =
      TextEditingController();

  /*
   * =====================================================
   * STATE OVERRIDE FORM
   * =====================================================
   */

  final TextEditingController
      stateNameController =
      TextEditingController();

  final TextEditingController
      stateBaseFareController =
      TextEditingController();

  final TextEditingController
      stateMinimumFareController =
      TextEditingController();

  final TextEditingController
      statePricePerKmController =
      TextEditingController();

  final TextEditingController
      stateWaitingFeeController =
      TextEditingController();

  final TextEditingController
      stateCommissionController =
      TextEditingController();

  final TextEditingController
      stateSearchRadiusController =
      TextEditingController();

  final TextEditingController
      stateOfferSecondsController =
      TextEditingController();

  List<Map<String, dynamic>> stateSettings =
      <Map<String, dynamic>>[];

  Map<String, dynamic>? editingStateSetting;

  @override
  void initState() {
    super.initState();

    _loadSettings();
  }

  @override
  void dispose() {
    baseFareController.dispose();
    minimumFareController.dispose();
    pricePerKmController.dispose();
    waitingFeeController.dispose();
    commissionController.dispose();
    searchRadiusController.dispose();
    offerSecondsController.dispose();

    stateNameController.dispose();
    stateBaseFareController.dispose();
    stateMinimumFareController.dispose();
    statePricePerKmController.dispose();
    stateWaitingFeeController.dispose();
    stateCommissionController.dispose();
    stateSearchRadiusController.dispose();
    stateOfferSecondsController.dispose();

    super.dispose();
  }

  /*
   * =====================================================
   * AUTH TOKEN
   * =====================================================
   */

  Future<String?> _getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    const List<String> keys =
        <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in keys) {
      final String? raw =
          prefs.getString(key);

      if (raw == null ||
          raw.trim().isEmpty) {
        continue;
      }

      String token =
          raw.trim();

      if (token
          .toLowerCase()
          .startsWith(
            'bearer ',
          )) {
        token =
            token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return null;
  }

  /*
   * =====================================================
   * HELPERS
   * =====================================================
   */

  double _number(
    dynamic value, {
    double fallback = 0,
  }) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        fallback;
  }

  String _cleanNumber(
    dynamic value,
  ) {
    final double number =
        _number(value);

    if (number ==
        number.roundToDouble()) {
      return number
          .round()
          .toString();
    }

    return number.toStringAsFixed(
      2,
    );
  }

  double? _readNumber(
    TextEditingController controller,
  ) {
    return double.tryParse(
      controller.text.trim(),
    );
  }

  String _normalizeStateName(
    String value,
  ) {
    return value
        .trim()
        .replaceAll(
          RegExp(r'\s+'),
          ' ',
        )
        .toUpperCase();
  }

  /*
   * =====================================================
   * LOAD SETTINGS
   * =====================================================
   */

  Future<void> _loadSettings() async {
    try {
      if (mounted) {
        setState(() {
          isLoading = true;
          errorMessage = null;
        });
      }

      final String? token =
          await _getToken();

      if (token == null) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response =
          await http
              .get(
        Uri.parse(
          '$baseUrl/admin/keke-fare',
        ),
        headers:
            <String, String>{
          'Accept':
              'application/json',
          'Authorization':
              'Bearer $token',
        },
      )
              .timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded =
          jsonDecode(
        response.body,
      );

      if (response.statusCode <
              200 ||
          response.statusCode >=
              300) {
        final String message =
            decoded is Map
                ? decoded['message']
                        ?.toString() ??
                    'Unable to load Keke fare settings.'
                : 'Unable to load Keke fare settings.';

        throw Exception(
          message,
        );
      }

      if (decoded is! Map) {
        throw Exception(
          'Invalid server response.',
        );
      }

      final dynamic rawSettings =
          decoded['settings'];

      if (rawSettings is! List) {
        throw Exception(
          'Keke fare settings were not received.',
        );
      }

      final List<Map<String, dynamic>>
          settings =
          rawSettings
              .whereType<Map>()
              .map(
                (
                  Map item,
                ) =>
                    Map<String, dynamic>.from(
                  item,
                ),
              )
              .toList();

      Map<String, dynamic>? global;

      final List<Map<String, dynamic>>
          states =
          <Map<String, dynamic>>[];

      for (final Map<String, dynamic>
          setting in settings) {
        final String scope =
            setting['scopeType']
                    ?.toString()
                    .toUpperCase() ??
                '';

        if (scope ==
            'GLOBAL') {
          global =
              setting;
        } else if (scope ==
            'STATE') {
          states.add(
            setting,
          );
        }
      }

      if (global == null) {
        throw Exception(
          'Global Keke fare setting was not found.',
        );
      }

      states.sort(
        (
          Map<String, dynamic> a,
          Map<String, dynamic> b,
        ) {
          final String aState =
              a['state']
                      ?.toString() ??
                  '';

          final String bState =
              b['state']
                      ?.toString() ??
                  '';

          return aState.compareTo(
            bState,
          );
        },
      );

      if (!mounted) {
        return;
      }

      setState(() {
        baseFareController.text =
            _cleanNumber(
          global!['baseFare'],
        );

        minimumFareController.text =
            _cleanNumber(
          global['minimumFare'],
        );

        pricePerKmController.text =
            _cleanNumber(
          global['pricePerKm'],
        );

        waitingFeeController.text =
            _cleanNumber(
          global[
              'waitingFeePerMinute'],
        );

        commissionController.text =
            _cleanNumber(
          global[
              'servicePayCommissionPercent'],
        );

        searchRadiusController.text =
            _cleanNumber(
          global[
              'maxSearchDistanceKm'],
        );

        offerSecondsController.text =
            _cleanNumber(
          global[
              'driverOfferSeconds'],
        );

        stateSettings =
            states;

        isLoading =
            false;

        errorMessage =
            null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading =
            false;

        errorMessage =
            error
                .toString()
                .replaceFirst(
                  'Exception: ',
                  '',
                );
      });
    }
  }

  /*
   * =====================================================
   * VALIDATE PRICING
   * =====================================================
   */

  String? _validatePricing({
    required double? baseFare,
    required double? minimumFare,
    required double? pricePerKm,
    required double? waitingFee,
    required double? commission,
    required double? searchRadius,
    required double? offerSeconds,
  }) {
    if (baseFare == null ||
        minimumFare == null ||
        pricePerKm == null ||
        waitingFee == null ||
        commission == null ||
        searchRadius == null ||
        offerSeconds == null) {
      return 'Please enter valid numbers in all fields.';
    }

    if (baseFare < 0 ||
        minimumFare < 0 ||
        pricePerKm < 0 ||
        waitingFee < 0) {
      return 'Fare values cannot be negative.';
    }

    if (commission < 0 ||
        commission > 100) {
      return 'ServicePay commission must be between 0% and 100%.';
    }

    if (searchRadius < 1 ||
        searchRadius > 100) {
      return 'Search radius must be between 1km and 100km.';
    }

    if (offerSeconds < 10 ||
        offerSeconds > 300) {
      return 'Driver offer time must be between 10 and 300 seconds.';
    }

    return null;
  }

  /*
   * =====================================================
   * SAVE GLOBAL
   * =====================================================
   */

  Future<void>
      _saveGlobalSettings()
      async {
    if (isSavingGlobal) {
      return;
    }

    final double? baseFare =
        _readNumber(
      baseFareController,
    );

    final double? minimumFare =
        _readNumber(
      minimumFareController,
    );

    final double? pricePerKm =
        _readNumber(
      pricePerKmController,
    );

    final double? waitingFee =
        _readNumber(
      waitingFeeController,
    );

    final double? commission =
        _readNumber(
      commissionController,
    );

    final double? searchRadius =
        _readNumber(
      searchRadiusController,
    );

    final double? offerSeconds =
        _readNumber(
      offerSecondsController,
    );

    final String? validation =
        _validatePricing(
      baseFare:
          baseFare,
      minimumFare:
          minimumFare,
      pricePerKm:
          pricePerKm,
      waitingFee:
          waitingFee,
      commission:
          commission,
      searchRadius:
          searchRadius,
      offerSeconds:
          offerSeconds,
    );

    if (validation != null) {
      _showMessage(
        validation,
        error:
            true,
      );

      return;
    }

    try {
      if (mounted) {
        setState(() {
          isSavingGlobal =
              true;
        });
      }

      final String? token =
          await _getToken();

      if (token == null) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response =
          await http
              .post(
        Uri.parse(
          '$baseUrl/admin/keke-fare',
        ),
        headers:
            <String, String>{
          'Accept':
              'application/json',
          'Content-Type':
              'application/json',
          'Authorization':
              'Bearer $token',
        },
        body:
            jsonEncode(
          <String, dynamic>{
            'scopeType':
                'GLOBAL',
            'baseFare':
                baseFare,
            'minimumFare':
                minimumFare,
            'pricePerKm':
                pricePerKm,
            'waitingFeePerMinute':
                waitingFee,
            'servicePayCommissionPercent':
                commission,
            'maxSearchDistanceKm':
                searchRadius,
            'driverOfferSeconds':
                offerSeconds!
                    .round(),
            'active':
                true,
          },
        ),
      )
              .timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded =
          jsonDecode(
        response.body,
      );

      if (response.statusCode <
              200 ||
          response.statusCode >=
              300) {
        final String message =
            decoded is Map
                ? decoded['message']
                        ?.toString() ??
                    'Unable to save Keke fare settings.'
                : 'Unable to save Keke fare settings.';

        throw Exception(
          message,
        );
      }

      _showMessage(
        decoded is Map
            ? decoded['message']
                    ?.toString() ??
                'Keke fare settings saved successfully.'
            : 'Keke fare settings saved successfully.',
      );

      await _loadSettings();
    } catch (error) {
      _showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        error:
            true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isSavingGlobal =
              false;
        });
      }
    }
  }

  /*
   * =====================================================
   * STATE FORM HELPERS
   * =====================================================
   */

  void _prefillStateFromGlobal() {
    stateBaseFareController.text =
        baseFareController.text;

    stateMinimumFareController.text =
        minimumFareController.text;

    statePricePerKmController.text =
        pricePerKmController.text;

    stateWaitingFeeController.text =
        waitingFeeController.text;

    stateCommissionController.text =
        commissionController.text;

    stateSearchRadiusController.text =
        searchRadiusController.text;

    stateOfferSecondsController.text =
        offerSecondsController.text;
  }

  void _clearStateForm() {
    stateNameController.clear();
    stateBaseFareController.clear();
    stateMinimumFareController.clear();
    statePricePerKmController.clear();
    stateWaitingFeeController.clear();
    stateCommissionController.clear();
    stateSearchRadiusController.clear();
    stateOfferSecondsController.clear();

    editingStateSetting =
        null;
  }

  void _startCreateState() {
    _clearStateForm();

    _prefillStateFromGlobal();

    setState(() {});
  }

  void _startEditState(
    Map<String, dynamic> setting,
  ) {
    editingStateSetting =
        setting;

    stateNameController.text =
        setting['state']
                ?.toString() ??
            '';

    stateBaseFareController.text =
        _cleanNumber(
      setting['baseFare'],
    );

    stateMinimumFareController.text =
        _cleanNumber(
      setting['minimumFare'],
    );

    statePricePerKmController.text =
        _cleanNumber(
      setting['pricePerKm'],
    );

    stateWaitingFeeController.text =
        _cleanNumber(
      setting[
          'waitingFeePerMinute'],
    );

    stateCommissionController.text =
        _cleanNumber(
      setting[
          'servicePayCommissionPercent'],
    );

    stateSearchRadiusController.text =
        _cleanNumber(
      setting[
          'maxSearchDistanceKm'],
    );

    stateOfferSecondsController.text =
        _cleanNumber(
      setting[
          'driverOfferSeconds'],
    );

    setState(() {});
  }

  /*
   * =====================================================
   * SAVE STATE OVERRIDE
   * =====================================================
   */

  Future<void>
      _saveStateSetting()
      async {
    if (isSavingState) {
      return;
    }

    final String state =
        _normalizeStateName(
      stateNameController.text,
    );

    if (state.isEmpty) {
      _showMessage(
        'Please enter the state name.',
        error:
            true,
      );

      return;
    }

    final double? baseFare =
        _readNumber(
      stateBaseFareController,
    );

    final double? minimumFare =
        _readNumber(
      stateMinimumFareController,
    );

    final double? pricePerKm =
        _readNumber(
      statePricePerKmController,
    );

    final double? waitingFee =
        _readNumber(
      stateWaitingFeeController,
    );

    final double? commission =
        _readNumber(
      stateCommissionController,
    );

    final double? searchRadius =
        _readNumber(
      stateSearchRadiusController,
    );

    final double? offerSeconds =
        _readNumber(
      stateOfferSecondsController,
    );

    final String? validation =
        _validatePricing(
      baseFare:
          baseFare,
      minimumFare:
          minimumFare,
      pricePerKm:
          pricePerKm,
      waitingFee:
          waitingFee,
      commission:
          commission,
      searchRadius:
          searchRadius,
      offerSeconds:
          offerSeconds,
    );

    if (validation != null) {
      _showMessage(
        validation,
        error:
            true,
      );

      return;
    }

    try {
      if (mounted) {
        setState(() {
          isSavingState =
              true;
        });
      }

      final String? token =
          await _getToken();

      if (token == null) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response =
          await http
              .post(
        Uri.parse(
          '$baseUrl/admin/keke-fare',
        ),
        headers:
            <String, String>{
          'Accept':
              'application/json',
          'Content-Type':
              'application/json',
          'Authorization':
              'Bearer $token',
        },
        body:
            jsonEncode(
          <String, dynamic>{
            'scopeType':
                'STATE',
            'state':
                state,
            'baseFare':
                baseFare,
            'minimumFare':
                minimumFare,
            'pricePerKm':
                pricePerKm,
            'waitingFeePerMinute':
                waitingFee,
            'servicePayCommissionPercent':
                commission,
            'maxSearchDistanceKm':
                searchRadius,
            'driverOfferSeconds':
                offerSeconds!
                    .round(),
            'active':
                true,
          },
        ),
      )
              .timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded =
          jsonDecode(
        response.body,
      );

      if (response.statusCode <
              200 ||
          response.statusCode >=
              300) {
        final String message =
            decoded is Map
                ? decoded['message']
                        ?.toString() ??
                    'Unable to save state Keke fare.'
                : 'Unable to save state Keke fare.';

        throw Exception(
          message,
        );
      }

      _showMessage(
        decoded is Map
            ? decoded['message']
                    ?.toString() ??
                '$state Keke fare saved successfully.'
            : '$state Keke fare saved successfully.',
      );

      _clearStateForm();

      await _loadSettings();
    } catch (error) {
      _showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        error:
            true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isSavingState =
              false;
        });
      }
    }
  }

  /*
   * =====================================================
   * DELETE STATE OVERRIDE
   * =====================================================
   */

  Future<void> _deleteStateSetting(
    Map<String, dynamic> setting,
  ) async {
    if (isDeletingState) {
      return;
    }

    final String id =
        setting['_id']
                ?.toString() ??
            setting['id']
                ?.toString() ??
            '';

    final String state =
        setting['state']
                ?.toString() ??
            'State';

    if (id.trim().isEmpty) {
      _showMessage(
        'Invalid state fare setting.',
        error:
            true,
      );

      return;
    }

    final bool confirmed =
        await showDialog<bool>(
              context:
                  context,
              builder:
                  (
                BuildContext dialogContext,
              ) {
                return AlertDialog(
                  title:
                      const Text(
                    'Remove State Pricing?',
                  ),
                  content:
                      Text(
                    '$state will return to the global Keke fare settings.',
                  ),
                  actions:
                      <Widget>[
                    TextButton(
                      onPressed:
                          () {
                        Navigator.of(
                          dialogContext,
                        ).pop(
                          false,
                        );
                      },
                      child:
                          const Text(
                        'Cancel',
                      ),
                    ),
                    FilledButton(
                      onPressed:
                          () {
                        Navigator.of(
                          dialogContext,
                        ).pop(
                          true,
                        );
                      },
                      style:
                          FilledButton.styleFrom(
                        backgroundColor:
                            Colors.red,
                      ),
                      child:
                          const Text(
                        'Remove',
                      ),
                    ),
                  ],
                );
              },
            ) ??
            false;

    if (!confirmed) {
      return;
    }

    try {
      setState(() {
        isDeletingState =
            true;
      });

      final String? token =
          await _getToken();

      if (token == null) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response =
          await http
              .delete(
        Uri.parse(
          '$baseUrl/admin/keke-fare/$id',
        ),
        headers:
            <String, String>{
          'Accept':
              'application/json',
          'Authorization':
              'Bearer $token',
        },
      )
              .timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded =
          jsonDecode(
        response.body,
      );

      if (response.statusCode <
              200 ||
          response.statusCode >=
              300) {
        final String message =
            decoded is Map
                ? decoded['message']
                        ?.toString() ??
                    'Unable to remove state pricing.'
                : 'Unable to remove state pricing.';

        throw Exception(
          message,
        );
      }

      if (editingStateSetting !=
          null) {
        final String editingId =
            editingStateSetting!['_id']
                    ?.toString() ??
                '';

        if (editingId ==
            id) {
          _clearStateForm();
        }
      }

      _showMessage(
        decoded is Map
            ? decoded['message']
                    ?.toString() ??
                '$state state pricing removed.'
            : '$state state pricing removed.',
      );

      await _loadSettings();
    } catch (error) {
      _showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        error:
            true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isDeletingState =
              false;
        });
      }
    }
  }

  /*
   * =====================================================
   * MESSAGE
   * =====================================================
   */

  void _showMessage(
    String message, {
    bool error = false,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content:
              Text(
            message,
          ),
          behavior:
              SnackBarBehavior.floating,
          backgroundColor:
              error
                  ? Colors.red.shade700
                  : primaryGreen,
        ),
      );
  }

  /*
   * =====================================================
   * COMMISSION DISPLAY
   * =====================================================
   */

  double get _commissionPercent {
    return double.tryParse(
          commissionController
              .text
              .trim(),
        ) ??
        0;
  }

  double get _driverSharePercent {
    final double value =
        100 -
            _commissionPercent;

    if (value < 0) {
      return 0;
    }

    if (value > 100) {
      return 100;
    }

    return value;
  }

  /*
   * =====================================================
   * GENERIC NUMBER FIELD
   * =====================================================
   */

  Widget _numberField({
    required TextEditingController controller,
    required String label,
    required String helper,
    required IconData icon,
    String? prefix,
    String? suffix,
  }) {
    return TextField(
      controller:
          controller,
      keyboardType:
          const TextInputType
              .numberWithOptions(
        decimal:
            true,
      ),
      onChanged:
          (_) {
        if (mounted) {
          setState(() {});
        }
      },
      decoration:
          InputDecoration(
        labelText:
            label,
        helperText:
            helper,
        prefixText:
            prefix,
        suffixText:
            suffix,
        prefixIcon:
            Icon(
          icon,
        ),
        border:
            const OutlineInputBorder(),
      ),
    );
  }

  Widget _summaryCard({
    required String title,
    required String value,
    required IconData icon,
  }) {
    return Expanded(
      child:
          Container(
        padding:
            const EdgeInsets.all(
          14,
        ),
        decoration:
            BoxDecoration(
          color:
              Colors.white,
          borderRadius:
              BorderRadius.circular(
            16,
          ),
          border:
              Border.all(
            color:
                const Color(
              0xFFE2E8F0,
            ),
          ),
        ),
        child:
            Column(
          children:
              <Widget>[
            Icon(
              icon,
              color:
                  primaryGreen,
              size:
                  25,
            ),
            const SizedBox(
              height:
                  7,
            ),
            Text(
              value,
              style:
                  const TextStyle(
                fontSize:
                    18,
                fontWeight:
                    FontWeight.w900,
              ),
            ),
            const SizedBox(
              height:
                  3,
            ),
            Text(
              title,
              textAlign:
                  TextAlign.center,
              style:
                  const TextStyle(
                color:
                    Color(
                  0xFF667085,
                ),
                fontSize:
                    11,
              ),
            ),
          ],
        ),
      ),
    );
  }
  /*
   * =====================================================
   * STATE TEXT FIELD
   * =====================================================
   */

  Widget _stateNameField() {
    return TextField(
      controller:
          stateNameController,
      textCapitalization:
          TextCapitalization.words,
      enabled:
          editingStateSetting ==
              null,
      decoration:
          InputDecoration(
        labelText:
            'State',
        hintText:
            'Example: Kano',
        helperText:
            editingStateSetting ==
                    null
                ? 'Enter the state that should use different Keke pricing.'
                : 'State name cannot be changed while editing. Delete and recreate if needed.',
        prefixIcon:
            const Icon(
          Icons
              .location_on_outlined,
        ),
        border:
            const OutlineInputBorder(),
      ),
    );
  }

  /*
   * =====================================================
   * STATE FORM
   * =====================================================
   */

  Widget _buildStateForm() {
    final bool isEditing =
        editingStateSetting !=
            null;

    return Card(
      elevation:
          0,
      color:
          Colors.white,
      child:
          Padding(
        padding:
            const EdgeInsets.all(
          16,
        ),
        child:
            Column(
          crossAxisAlignment:
              CrossAxisAlignment
                  .stretch,
          children:
              <Widget>[
            Row(
              children:
                  <Widget>[
                Expanded(
                  child:
                      Text(
                    isEditing
                        ? 'Edit State Pricing'
                        : 'Create State Pricing',
                    style:
                        const TextStyle(
                      fontSize:
                          18,
                      fontWeight:
                          FontWeight
                              .w900,
                    ),
                  ),
                ),
                if (isEditing)
                  TextButton.icon(
                    onPressed:
                        () {
                      _clearStateForm();

                      _prefillStateFromGlobal();

                      setState(() {});
                    },
                    icon:
                        const Icon(
                      Icons.close_rounded,
                    ),
                    label:
                        const Text(
                      'Cancel Edit',
                    ),
                  ),
              ],
            ),

            const SizedBox(
              height:
                  6,
            ),

            Text(
              isEditing
                  ? 'Update the Keke fare for ${stateNameController.text}.'
                  : 'Create different Keke pricing for a specific state.',
              style:
                  const TextStyle(
                color:
                    Color(
                  0xFF667085,
                ),
                height:
                    1.4,
              ),
            ),

            const SizedBox(
              height:
                  16,
            ),

            _stateNameField(),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  stateBaseFareController,
              label:
                  'Base Fare',
              helper:
                  'Starting charge in this state.',
              icon:
                  Icons
                      .flag_circle_outlined,
              prefix:
                  '₦',
            ),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  stateMinimumFareController,
              label:
                  'Minimum Fare',
              helper:
                  'Lowest fare a customer can pay in this state.',
              icon:
                  Icons
                      .payments_outlined,
              prefix:
                  '₦',
            ),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  statePricePerKmController,
              label:
                  'Price per KM',
              helper:
                  'Distance charge for every kilometre.',
              icon:
                  Icons
                      .route_outlined,
              prefix:
                  '₦',
              suffix:
                  '/km',
            ),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  stateWaitingFeeController,
              label:
                  'Waiting Fee',
              helper:
                  'Charge per waiting minute.',
              icon:
                  Icons
                      .timer_outlined,
              prefix:
                  '₦',
              suffix:
                  '/min',
            ),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  stateCommissionController,
              label:
                  'ServicePay Commission',
              helper:
                  'Driver receives the remaining percentage.',
              icon:
                  Icons
                      .percent_rounded,
              suffix:
                  '%',
            ),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  stateSearchRadiusController,
              label:
                  'Driver Search Radius',
              helper:
                  'Maximum distance to search for nearby riders.',
              icon:
                  Icons
                      .radar_rounded,
              suffix:
                  'km',
            ),

            const SizedBox(
              height:
                  14,
            ),

            _numberField(
              controller:
                  stateOfferSecondsController,
              label:
                  'Driver Offer Time',
              helper:
                  'Time allowed for the driver to accept.',
              icon:
                  Icons
                      .alarm_rounded,
              suffix:
                  'seconds',
            ),

            const SizedBox(
              height:
                  18,
            ),

            SizedBox(
              height:
                  52,
              child:
                  FilledButton.icon(
                onPressed:
                    isSavingState
                        ? null
                        : _saveStateSetting,
                style:
                    FilledButton
                        .styleFrom(
                  backgroundColor:
                      primaryGreen,
                ),
                icon:
                    isSavingState
                        ? const SizedBox(
                            width:
                                19,
                            height:
                                19,
                            child:
                                CircularProgressIndicator(
                              strokeWidth:
                                  2,
                              color:
                                  Colors.white,
                            ),
                          )
                        : Icon(
                            isEditing
                                ? Icons
                                    .save_as_rounded
                                : Icons
                                    .add_location_alt_rounded,
                          ),
                label:
                    Text(
                  isSavingState
                      ? 'Saving...'
                      : isEditing
                          ? 'Update State Pricing'
                          : 'Save State Pricing',
                  style:
                      const TextStyle(
                    fontWeight:
                        FontWeight
                            .w800,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /*
   * =====================================================
   * STATE OVERRIDE CARD
   * =====================================================
   */

  Widget _buildStateSettingCard(
    Map<String, dynamic> setting,
  ) {
    final String state =
        setting['state']
                ?.toString() ??
            'STATE';

    final double commission =
        _number(
      setting[
          'servicePayCommissionPercent'],
    );

    final double driverShare =
        (100 - commission)
            .clamp(
              0,
              100,
            )
            .toDouble();

    return Card(
      elevation:
          0,
      color:
          Colors.white,
      margin:
          const EdgeInsets.only(
        bottom:
            12,
      ),
      child:
          Padding(
        padding:
            const EdgeInsets.all(
          14,
        ),
        child:
            Column(
          crossAxisAlignment:
              CrossAxisAlignment
                  .stretch,
          children:
              <Widget>[
            Row(
              children:
                  <Widget>[
                Container(
                  width:
                      46,
                  height:
                      46,
                  decoration:
                      BoxDecoration(
                    color:
                        const Color(
                      0xFFEAF7F0,
                    ),
                    borderRadius:
                        BorderRadius
                            .circular(
                      14,
                    ),
                  ),
                  child:
                      const Icon(
                    Icons
                        .location_on_rounded,
                    color:
                        primaryGreen,
                  ),
                ),

                const SizedBox(
                  width:
                      12,
                ),

                Expanded(
                  child:
                      Column(
                    crossAxisAlignment:
                        CrossAxisAlignment
                            .start,
                    children:
                        <Widget>[
                      Text(
                        state,
                        style:
                            const TextStyle(
                          fontSize:
                              17,
                          fontWeight:
                              FontWeight
                                  .w900,
                        ),
                      ),
                      const SizedBox(
                        height:
                            3,
                      ),
                      const Text(
                        'State override active',
                        style:
                            TextStyle(
                          color:
                              Color(
                            0xFF667085,
                          ),
                          fontSize:
                              12,
                        ),
                      ),
                    ],
                  ),
                ),

                PopupMenuButton<String>(
                  onSelected:
                      (
                    String action,
                  ) {
                    if (action ==
                        'EDIT') {
                      _startEditState(
                        setting,
                      );
                    } else if (action ==
                        'DELETE') {
                      _deleteStateSetting(
                        setting,
                      );
                    }
                  },
                  itemBuilder:
                      (
                    BuildContext context,
                  ) =>
                          const <
                              PopupMenuEntry<
                                  String>>[
                    PopupMenuItem<String>(
                      value:
                          'EDIT',
                      child:
                          Row(
                        children:
                            <Widget>[
                          Icon(
                            Icons
                                .edit_outlined,
                          ),
                          SizedBox(
                            width:
                                8,
                          ),
                          Text(
                            'Edit',
                          ),
                        ],
                      ),
                    ),
                    PopupMenuItem<String>(
                      value:
                          'DELETE',
                      child:
                          Row(
                        children:
                            <Widget>[
                          Icon(
                            Icons
                                .delete_outline,
                            color:
                                Colors.red,
                          ),
                          SizedBox(
                            width:
                                8,
                          ),
                          Text(
                            'Remove Override',
                            style:
                                TextStyle(
                              color:
                                  Colors.red,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(
              height:
                  14,
            ),

            Wrap(
              spacing:
                  8,
              runSpacing:
                  8,
              children:
                  <Widget>[
                _StateMetricChip(
                  label:
                      'Base',
                  value:
                      '₦${_cleanNumber(setting['baseFare'])}',
                ),
                _StateMetricChip(
                  label:
                      'Minimum',
                  value:
                      '₦${_cleanNumber(setting['minimumFare'])}',
                ),
                _StateMetricChip(
                  label:
                      'Per KM',
                  value:
                      '₦${_cleanNumber(setting['pricePerKm'])}',
                ),
                _StateMetricChip(
                  label:
                      'Waiting',
                  value:
                      '₦${_cleanNumber(setting['waitingFeePerMinute'])}/min',
                ),
                _StateMetricChip(
                  label:
                      'ServicePay',
                  value:
                      '${_cleanNumber(commission)}%',
                ),
                _StateMetricChip(
                  label:
                      'Driver',
                  value:
                      '${_cleanNumber(driverShare)}%',
                ),
                _StateMetricChip(
                  label:
                      'Radius',
                  value:
                      '${_cleanNumber(setting['maxSearchDistanceKm'])}km',
                ),
                _StateMetricChip(
                  label:
                      'Offer',
                  value:
                      '${_cleanNumber(setting['driverOfferSeconds'])}s',
                ),
              ],
            ),

            const SizedBox(
              height:
                  12,
            ),

            Row(
              children:
                  <Widget>[
                Expanded(
                  child:
                      OutlinedButton.icon(
                    onPressed:
                        () {
                      _startEditState(
                        setting,
                      );
                    },
                    icon:
                        const Icon(
                      Icons.edit_outlined,
                    ),
                    label:
                        const Text(
                      'Edit',
                    ),
                  ),
                ),

                const SizedBox(
                  width:
                      10,
                ),

                Expanded(
                  child:
                      OutlinedButton.icon(
                    onPressed:
                        isDeletingState
                            ? null
                            : () {
                                _deleteStateSetting(
                                  setting,
                                );
                              },
                    style:
                        OutlinedButton
                            .styleFrom(
                      foregroundColor:
                          Colors.red,
                      side:
                          const BorderSide(
                        color:
                            Colors.red,
                      ),
                    ),
                    icon:
                        const Icon(
                      Icons
                          .delete_outline,
                    ),
                    label:
                        const Text(
                      'Remove',
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /*
   * =====================================================
   * MAIN UI
   * =====================================================
   */

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF7F9FB,
      ),
      body:
          isLoading
              ? const Center(
                  child:
                      CircularProgressIndicator(),
                )
              : errorMessage !=
                      null
                  ? Center(
                      child:
                          Padding(
                        padding:
                            const EdgeInsets.all(
                          24,
                        ),
                        child:
                            Column(
                          mainAxisSize:
                              MainAxisSize.min,
                          children:
                              <Widget>[
                            const Icon(
                              Icons
                                  .error_outline_rounded,
                              color:
                                  Colors.red,
                              size:
                                  55,
                            ),
                            const SizedBox(
                              height:
                                  12,
                            ),
                            Text(
                              errorMessage!,
                              textAlign:
                                  TextAlign.center,
                            ),
                            const SizedBox(
                              height:
                                  16,
                            ),
                            FilledButton.icon(
                              onPressed:
                                  _loadSettings,
                              icon:
                                  const Icon(
                                Icons
                                    .refresh_rounded,
                              ),
                              label:
                                  const Text(
                                'Try Again',
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      color:
                          primaryGreen,
                      onRefresh:
                          _loadSettings,
                      child:
                          ListView(
                        padding:
                            const EdgeInsets.fromLTRB(
                          16,
                          16,
                          16,
                          40,
                        ),
                        children:
                            <Widget>[
                          const Text(
                            'Keke Fare Settings',
                            style:
                                TextStyle(
                              fontSize:
                                  24,
                              fontWeight:
                                  FontWeight
                                      .w900,
                            ),
                          ),

                          const SizedBox(
                            height:
                                6,
                          ),

                          const Text(
                            'Control ServicePay Keke pricing, commission, driver matching and state-specific fare rules.',
                            style:
                                TextStyle(
                              color:
                                  Color(
                                0xFF667085,
                              ),
                              height:
                                  1.4,
                            ),
                          ),

                          const SizedBox(
                            height:
                                20,
                          ),

                          /*
                           * COMMISSION SUMMARY
                           */
                          Row(
                            children:
                                <Widget>[
                              _summaryCard(
                                title:
                                    'ServicePay',
                                value:
                                    '${_commissionPercent.toStringAsFixed(0)}%',
                                icon:
                                    Icons
                                        .business_rounded,
                              ),

                              const SizedBox(
                                width:
                                    10,
                              ),

                              _summaryCard(
                                title:
                                    'Driver Share',
                                value:
                                    '${_driverSharePercent.toStringAsFixed(0)}%',
                                icon:
                                    Icons
                                        .electric_rickshaw_rounded,
                              ),
                            ],
                          ),

                          const SizedBox(
                            height:
                                22,
                          ),

                          /*
                           * GLOBAL FARE
                           */
                          Card(
                            elevation:
                                0,
                            color:
                                Colors.white,
                            child:
                                Padding(
                              padding:
                                  const EdgeInsets.all(
                                16,
                              ),
                              child:
                                  Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment
                                        .stretch,
                                children:
                                    <Widget>[
                                  const Text(
                                    'Global Fare',
                                    style:
                                        TextStyle(
                                      fontSize:
                                          18,
                                      fontWeight:
                                          FontWeight
                                              .w900,
                                    ),
                                  ),

                                  const SizedBox(
                                    height:
                                        6,
                                  ),

                                  const Text(
                                    'Used everywhere unless a state override exists.',
                                    style:
                                        TextStyle(
                                      color:
                                          Color(
                                        0xFF667085,
                                      ),
                                    ),
                                  ),

                                  const SizedBox(
                                    height:
                                        16,
                                  ),

                                  _numberField(
                                    controller:
                                        baseFareController,
                                    label:
                                        'Base Fare',
                                    helper:
                                        'Starting charge before distance.',
                                    icon:
                                        Icons
                                            .flag_circle_outlined,
                                    prefix:
                                        '₦',
                                  ),

                                  const SizedBox(
                                    height:
                                        14,
                                  ),

                                  _numberField(
                                    controller:
                                        minimumFareController,
                                    label:
                                        'Minimum Fare',
                                    helper:
                                        'Lowest amount a customer can pay.',
                                    icon:
                                        Icons
                                            .payments_outlined,
                                    prefix:
                                        '₦',
                                  ),

                                  const SizedBox(
                                    height:
                                        14,
                                  ),

                                  _numberField(
                                    controller:
                                        pricePerKmController,
                                    label:
                                        'Price per KM',
                                    helper:
                                        'Distance charge for every kilometre.',
                                    icon:
                                        Icons
                                            .route_outlined,
                                    prefix:
                                        '₦',
                                    suffix:
                                        '/km',
                                  ),

                                  const SizedBox(
                                    height:
                                        14,
                                  ),

                                  _numberField(
                                    controller:
                                        waitingFeeController,
                                    label:
                                        'Waiting Fee',
                                    helper:
                                        'Charge per waiting minute.',
                                    icon:
                                        Icons
                                            .timer_outlined,
                                    prefix:
                                        '₦',
                                    suffix:
                                        '/min',
                                  ),
                                ],
                              ),
                            ),
                          ),

                          const SizedBox(
                            height:
                                16,
                          ),

                          /*
                           * COMMISSION / MATCHING
                           */
                          Card(
                            elevation:
                                0,
                            color:
                                Colors.white,
                            child:
                                Padding(
                              padding:
                                  const EdgeInsets.all(
                                16,
                              ),
                              child:
                                  Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment
                                        .stretch,
                                children:
                                    <Widget>[
                                  const Text(
                                    'Commission & Matching',
                                    style:
                                        TextStyle(
                                      fontSize:
                                          18,
                                      fontWeight:
                                          FontWeight
                                              .w900,
                                    ),
                                  ),

                                  const SizedBox(
                                    height:
                                        16,
                                  ),

                                  _numberField(
                                    controller:
                                        commissionController,
                                    label:
                                        'ServicePay Commission',
                                    helper:
                                        'Driver automatically receives the remaining percentage.',
                                    icon:
                                        Icons
                                            .percent_rounded,
                                    suffix:
                                        '%',
                                  ),

                                  const SizedBox(
                                    height:
                                        14,
                                  ),

                                  _numberField(
                                    controller:
                                        searchRadiusController,
                                    label:
                                        'Driver Search Radius',
                                    helper:
                                        'Maximum distance for nearest-driver search.',
                                    icon:
                                        Icons
                                            .radar_rounded,
                                    suffix:
                                        'km',
                                  ),

                                  const SizedBox(
                                    height:
                                        14,
                                  ),

                                  _numberField(
                                    controller:
                                        offerSecondsController,
                                    label:
                                        'Driver Offer Time',
                                    helper:
                                        'How long a rider has to accept.',
                                    icon:
                                        Icons
                                            .alarm_rounded,
                                    suffix:
                                        'seconds',
                                  ),
                                ],
                              ),
                            ),
                          ),

                          const SizedBox(
                            height:
                                20,
                          ),

                          SizedBox(
                            height:
                                54,
                            child:
                                FilledButton.icon(
                              onPressed:
                                  isSavingGlobal
                                      ? null
                                      : _saveGlobalSettings,
                              style:
                                  FilledButton
                                      .styleFrom(
                                backgroundColor:
                                    primaryGreen,
                              ),
                              icon:
                                  isSavingGlobal
                                      ? const SizedBox(
                                          width:
                                              20,
                                          height:
                                              20,
                                          child:
                                              CircularProgressIndicator(
                                            strokeWidth:
                                                2,
                                            color:
                                                Colors.white,
                                          ),
                                        )
                                      : const Icon(
                                          Icons
                                              .save_rounded,
                                        ),
                              label:
                                  Text(
                                isSavingGlobal
                                    ? 'Saving...'
                                    : 'Save Global Keke Fare',
                                style:
                                    const TextStyle(
                                  fontWeight:
                                      FontWeight
                                          .w800,
                                ),
                              ),
                            ),
                          ),

                          const SizedBox(
                            height:
                                28,
                          ),

                          /*
                           * STATE PRICING HEADER
                           */
                          Row(
                            children:
                                <Widget>[
                              const Expanded(
                                child:
                                    Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment
                                          .start,
                                  children:
                                      <Widget>[
                                    Text(
                                      'State Overrides',
                                      style:
                                          TextStyle(
                                        fontSize:
                                            20,
                                        fontWeight:
                                            FontWeight
                                                .w900,
                                      ),
                                    ),
                                    SizedBox(
                                      height:
                                          4,
                                    ),
                                    Text(
                                      'Create different pricing for individual states.',
                                      style:
                                          TextStyle(
                                        color:
                                            Color(
                                          0xFF667085,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),

                              FilledButton.icon(
                                onPressed:
                                    _startCreateState,
                                icon:
                                    const Icon(
                                  Icons
                                      .add_rounded,
                                ),
                                label:
                                    const Text(
                                  'New State',
                                ),
                              ),
                            ],
                          ),

                          const SizedBox(
                            height:
                                14,
                          ),

                          /*
                           * CREATE / EDIT STATE FORM
                           */
                          _buildStateForm(),

                          const SizedBox(
                            height:
                                20,
                          ),

                          if (stateSettings
                              .isEmpty)
                            Container(
                              padding:
                                  const EdgeInsets.all(
                                18,
                              ),
                              decoration:
                                  BoxDecoration(
                                color:
                                    Colors.white,
                                borderRadius:
                                    BorderRadius.circular(
                                  16,
                                ),
                                border:
                                    Border.all(
                                  color:
                                      const Color(
                                    0xFFE2E8F0,
                                  ),
                                ),
                              ),
                              child:
                                  const Row(
                                crossAxisAlignment:
                                    CrossAxisAlignment.start,
                                children:
                                    <Widget>[
                                  Icon(
                                    Icons
                                        .info_outline_rounded,
                                    color:
                                        primaryGreen,
                                  ),
                                  SizedBox(
                                    width:
                                        10,
                                  ),
                                  Expanded(
                                    child:
                                        Text(
                                      'No state-specific fare has been created yet. Global pricing is currently used everywhere.',
                                      style:
                                          TextStyle(
                                        color:
                                            Color(
                                          0xFF667085,
                                        ),
                                        height:
                                            1.4,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            )
                          else ...<Widget>[
                            Text(
                              '${stateSettings.length} state override${stateSettings.length == 1 ? '' : 's'}',
                              style:
                                  const TextStyle(
                                color:
                                    Color(
                                  0xFF667085,
                                ),
                                fontWeight:
                                    FontWeight
                                        .w700,
                              ),
                            ),

                            const SizedBox(
                              height:
                                  10,
                            ),

                            ...stateSettings.map(
                              _buildStateSettingCard,
                            ),
                          ],
                        ],
                      ),
                    ),
    );
  }
}

/*
 * =====================================================
 * STATE METRIC CHIP
 * =====================================================
 */

class _StateMetricChip
    extends StatelessWidget {
  const _StateMetricChip({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal:
            10,
        vertical:
            7,
      ),
      decoration:
          BoxDecoration(
        color:
            const Color(
          0xFFF1F5F9,
        ),
        borderRadius:
            BorderRadius.circular(
          20,
        ),
      ),
      child:
          RichText(
        text:
            TextSpan(
          style:
              const TextStyle(
            color:
                Color(
              0xFF344054,
            ),
            fontSize:
                12,
          ),
          children:
              <InlineSpan>[
            TextSpan(
              text:
                  '$label: ',
              style:
                  const TextStyle(
                color:
                    Color(
                  0xFF667085,
                ),
              ),
            ),
            TextSpan(
              text:
                  value,
              style:
                  const TextStyle(
                fontWeight:
                    FontWeight
                        .w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}