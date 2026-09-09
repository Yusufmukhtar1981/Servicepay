import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminRidersScreen extends StatefulWidget {
  const AdminRidersScreen({
    super.key,
  });

  @override
  State<AdminRidersScreen> createState() =>
      _AdminRidersScreenState();
}

class _AdminRidersScreenState
    extends State<AdminRidersScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF159447);

  final TextEditingController searchController =
      TextEditingController();

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';

  String selectedStatus = 'ALL';
  String selectedVerification = 'ALL';

  List<Map<String, dynamic>> riders =
      <Map<String, dynamic>>[];

  int totalRiders = 0;
  int activeRiders = 0;
  int suspendedRiders = 0;
  int verifiedRiders = 0;
  int pendingVerification = 0;
  int onlineRiders = 0;

  @override
  void initState() {
    super.initState();
    loadRiders();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  List<Map<String, dynamic>> listFromDynamic(
    dynamic value,
  ) {
    if (value is! List) {
      return <Map<String, dynamic>>[];
    }

    return value
        .whereType<Map>()
        .map(
          (Map item) =>
              Map<String, dynamic>.from(item),
        )
        .toList();
  }

  String normalizeText(
    dynamic value, {
    String fallback = '',
  }) {
    final String result =
        value?.toString().trim() ?? '';

    return result.isEmpty ? fallback : result;
  }

  String normalizeUppercase(
    dynamic value, {
    String fallback = '',
  }) {
    return normalizeText(
      value,
      fallback: fallback,
    ).toUpperCase();
  }

  int numberFromDynamic(
    dynamic value,
  ) {
    return int.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  Future<String> getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token =
          prefs.getString(key)?.trim() ?? '';

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return '';
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 4),
          backgroundColor: isError
              ? Colors.red.shade700
              : Colors.green.shade700,
        ),
      );
  }

  Future<Map<String, dynamic>> decodeResponse(
    http.Response response,
  ) async {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded = jsonDecode(body);

    return mapFromDynamic(decoded);
  }

  Future<void> loadRiders({
    bool refresh = false,
  }) async {
    if (mounted) {
      setState(() {
        if (refresh) {
          isRefreshing = true;
        } else {
          isLoading = true;
        }

        hasError = false;
        errorMessage = '';
      });
    }

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final Map<String, String> queryParameters =
          <String, String>{
        'limit': '100',
      };

      final String search =
          searchController.text.trim();

      if (search.isNotEmpty) {
        queryParameters['search'] = search;
      }

      if (selectedStatus != 'ALL') {
        queryParameters['status'] =
            selectedStatus;
      }

      if (selectedVerification != 'ALL') {
        queryParameters[
                'verificationStatus'] =
            selectedVerification;
      }

      final Uri endpoint = Uri.parse(
        '$baseUrl/admin/riders',
      ).replace(
        queryParameters: queryParameters,
      );

      final http.Response response = await http
          .get(
            endpoint,
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(
            const Duration(seconds: 35),
          );

      final Map<String, dynamic> result =
          await decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          normalizeText(
            result['message'],
            fallback:
                'Unable to load delivery riders.',
          ),
        );
      }

      final Map<String, dynamic> summary =
          mapFromDynamic(result['summary']);

      if (!mounted) {
        return;
      }

      setState(() {
        riders = listFromDynamic(
          result['riders'],
        );

        totalRiders = numberFromDynamic(
          summary['totalRiders'],
        );

        activeRiders = numberFromDynamic(
          summary['activeRiders'],
        );

        suspendedRiders = numberFromDynamic(
          summary['suspendedRiders'],
        );

        verifiedRiders = numberFromDynamic(
          summary['verifiedRiders'],
        );

        pendingVerification = numberFromDynamic(
          summary['pendingVerification'],
        );

        onlineRiders = numberFromDynamic(
          summary['onlineRiders'],
        );

        hasError = false;
        errorMessage = '';
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        hasError = true;
        errorMessage =
            'The server took too long to respond.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        hasError = true;
        errorMessage =
            'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        hasError = true;
        errorMessage = error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  Future<void> createRider(
    Map<String, dynamic> payload,
  ) async {
    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/admin/riders',
            ),
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(payload),
          )
          .timeout(
            const Duration(seconds: 35),
          );

      final Map<String, dynamic> result =
          await decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          normalizeText(
            result['message'],
            fallback:
                'Unable to create delivery rider.',
          ),
        );
      }

      showMessage(
        normalizeText(
          result['message'],
          fallback:
              'Delivery rider created successfully.',
        ),
        isError: false,
      );

      await loadRiders(
        refresh: true,
      );
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );

      rethrow;
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );

      rethrow;
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );

      rethrow;
    }
  }

  Future<void> updateRiderStatus(
    Map<String, dynamic> rider,
    String status,
  ) async {
    final String riderMongoId =
        normalizeText(rider['_id']);

    if (riderMongoId.isEmpty) {
      showMessage(
        'Rider ID was not found.',
      );
      return;
    }

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/riders/'
                  '$riderMongoId/status',
                ),
                headers: {
                  'Content-Type':
                      'application/json',
                  'Accept': 'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'status': status,
                }),
              )
              .timeout(
                const Duration(seconds: 30),
              );

      final Map<String, dynamic> result =
          await decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          normalizeText(
            result['message'],
            fallback:
                'Unable to update rider status.',
          ),
        );
      }

      showMessage(
        normalizeText(
          result['message'],
          fallback:
              'Rider status updated successfully.',
        ),
        isError: false,
      );

      await loadRiders(
        refresh: true,
      );
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    }
  }

  Future<void> updateRiderVerification(
    Map<String, dynamic> rider,
    String verificationStatus, {
    String note = '',
  }) async {
    final String riderMongoId =
        normalizeText(rider['_id']);

    if (riderMongoId.isEmpty) {
      showMessage(
        'Rider ID was not found.',
      );
      return;
    }

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/riders/'
                  '$riderMongoId/verification',
                ),
                headers: {
                  'Content-Type':
                      'application/json',
                  'Accept': 'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'verificationStatus':
                      verificationStatus,
                  'note': note,
                }),
              )
              .timeout(
                const Duration(seconds: 30),
              );

      final Map<String, dynamic> result =
          await decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          normalizeText(
            result['message'],
            fallback:
                'Unable to update rider verification.',
          ),
        );
      }

      showMessage(
        normalizeText(
          result['message'],
          fallback:
              'Rider verification updated successfully.',
        ),
        isError: false,
      );

      await loadRiders(
        refresh: true,
      );
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    }
  }
  void openCreateRiderDialog() {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return CreateRiderDialog(
          onCreate: createRider,
        );
      },
    );
  }

  void openRiderDetails(
    Map<String, dynamic> rider,
  ) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (
        BuildContext sheetContext,
      ) {
        return RiderDetailsSheet(
          rider: rider,
          onStatusChanged: updateRiderStatus,
          onVerificationChanged:
              updateRiderVerification,
        );
      },
    );
  }

  Widget buildSummaryCard({
    required String title,
    required int value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(
                alpha: 0.12,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: color,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  value.toString(),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget buildRiderCard(
    Map<String, dynamic> rider,
  ) {
    final String fullName = normalizeText(
      rider['fullName'],
      fallback: 'Delivery Rider',
    );

    final String riderId = normalizeText(
      rider['riderId'],
      fallback: 'No rider ID',
    );

    final String phone = normalizeText(
      rider['phone'],
      fallback: 'No phone',
    );

    final String vehicleType =
        normalizeUppercase(
      rider['vehicleType'],
      fallback: 'NOT SET',
    ).replaceAll('_', ' ');

    final String state = normalizeText(
      rider['riderState'] ?? rider['state'],
      fallback: 'State not set',
    );

    final String status = normalizeUppercase(
      rider['status'],
      fallback: 'ACTIVE',
    );

    final String verification =
        normalizeUppercase(
      rider['riderVerificationStatus'],
      fallback: 'PENDING',
    );

    final String availability =
        normalizeUppercase(
      rider['availabilityStatus'],
      fallback: 'OFFLINE',
    );

    return Card(
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(
          color: Color(0xFFE2E8F0),
        ),
      ),
      child: InkWell(
        onTap: () => openRiderDetails(rider),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: primaryGreen.withValues(
                    alpha: 0.10,
                  ),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.delivery_dining_rounded,
                  color: primaryGreen,
                  size: 30,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            fullName,
                            maxLines: 1,
                            overflow:
                                TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight:
                                  FontWeight.bold,
                            ),
                          ),
                        ),
                        StatusChip(
                          text: status,
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      riderId,
                      style: const TextStyle(
                        color: Colors.black54,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        MiniInfoChip(
                          icon: Icons.phone_outlined,
                          text: phone,
                        ),
                        MiniInfoChip(
                          icon:
                              Icons.two_wheeler_outlined,
                          text: vehicleType,
                        ),
                        MiniInfoChip(
                          icon:
                              Icons.location_on_outlined,
                          text: state,
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        VerificationChip(
                          status: verification,
                        ),
                        AvailabilityChip(
                          status: availability,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.chevron_right_rounded,
                color: Colors.black38,
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final double screenWidth =
        MediaQuery.sizeOf(context).width;

    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      floatingActionButton:
          FloatingActionButton.extended(
        onPressed: openCreateRiderDialog,
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        icon: const Icon(
          Icons.person_add_alt_1_rounded,
        ),
        label: const Text(
          'Add Rider',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => loadRiders(
          refresh: true,
        ),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Delivery Riders',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight:
                              FontWeight.bold,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Create, verify and manage ServicePay riders.',
                        style: TextStyle(
                          color: Colors.black54,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  onPressed: isRefreshing
                      ? null
                      : () => loadRiders(
                            refresh: true,
                          ),
                  icon: isRefreshing
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child:
                              CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(
                          Icons.refresh_rounded,
                        ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            GridView.count(
              crossAxisCount:
                  screenWidth > 900 ? 3 : 2,
              shrinkWrap: true,
              physics:
                  const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio:
                  screenWidth > 900 ? 2.6 : 1.55,
              children: [
                buildSummaryCard(
                  title: 'Total Riders',
                  value: totalRiders,
                  icon: Icons.groups_rounded,
                  color: Colors.blue,
                ),
                buildSummaryCard(
                  title: 'Active',
                  value: activeRiders,
                  icon:
                      Icons.check_circle_rounded,
                  color: Colors.green,
                ),
                buildSummaryCard(
                  title: 'Verified',
                  value: verifiedRiders,
                  icon: Icons.verified_rounded,
                  color: primaryGreen,
                ),
                buildSummaryCard(
                  title: 'Pending',
                  value: pendingVerification,
                  icon:
                      Icons.hourglass_top_rounded,
                  color: Colors.orange,
                ),
                buildSummaryCard(
                  title: 'Online',
                  value: onlineRiders,
                  icon:
                      Icons.radio_button_checked,
                  color: Colors.teal,
                ),
                buildSummaryCard(
                  title: 'Suspended',
                  value: suspendedRiders,
                  icon: Icons.block_rounded,
                  color: Colors.red,
                ),
              ],
            ),
            const SizedBox(height: 18),
            TextField(
              controller: searchController,
              textInputAction:
                  TextInputAction.search,
              onChanged: (_) {
                setState(() {});
              },
              onSubmitted: (_) {
                loadRiders();
              },
              decoration: InputDecoration(
                hintText:
                    'Search by name, phone, Rider ID or plate number',
                prefixIcon: const Icon(
                  Icons.search_rounded,
                ),
                suffixIcon:
                    searchController.text.isEmpty
                        ? null
                        : IconButton(
                            onPressed: () {
                              searchController.clear();
                              setState(() {});
                              loadRiders();
                            },
                            icon: const Icon(
                              Icons.clear,
                            ),
                          ),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius:
                      BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
                enabledBorder:
                    OutlineInputBorder(
                  borderRadius:
                      BorderRadius.circular(14),
                  borderSide:
                      const BorderSide(
                    color:
                        Color(0xFFE2E8F0),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                DropdownButton<String>(
                  value: selectedStatus,
                  items: const [
                    DropdownMenuItem(
                      value: 'ALL',
                      child: Text(
                        'All account statuses',
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'ACTIVE',
                      child: Text('Active'),
                    ),
                    DropdownMenuItem(
                      value: 'SUSPENDED',
                      child: Text('Suspended'),
                    ),
                    DropdownMenuItem(
                      value: 'BLOCKED',
                      child: Text('Blocked'),
                    ),
                  ],
                  onChanged: (
                    String? value,
                  ) {
                    if (value == null) {
                      return;
                    }

                    setState(() {
                      selectedStatus = value;
                    });

                    loadRiders();
                  },
                ),
                DropdownButton<String>(
                  value:
                      selectedVerification,
                  items: const [
                    DropdownMenuItem(
                      value: 'ALL',
                      child: Text(
                        'All verification statuses',
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'PENDING',
                      child: Text('Pending'),
                    ),
                    DropdownMenuItem(
                      value: 'VERIFIED',
                      child: Text('Verified'),
                    ),
                    DropdownMenuItem(
                      value: 'REJECTED',
                      child: Text('Rejected'),
                    ),
                    DropdownMenuItem(
                      value: 'NOT_SUBMITTED',
                      child: Text(
                        'Not submitted',
                      ),
                    ),
                  ],
                  onChanged: (
                    String? value,
                  ) {
                    if (value == null) {
                      return;
                    }

                    setState(() {
                      selectedVerification =
                          value;
                    });

                    loadRiders();
                  },
                ),
              ],
            ),
            const SizedBox(height: 18),
            if (isLoading)
              const Padding(
                padding:
                    EdgeInsets.symmetric(
                  vertical: 60,
                ),
                child: Center(
                  child:
                      CircularProgressIndicator(),
                ),
              )
            else if (hasError)
              ErrorCard(
                message: errorMessage,
                onRetry: loadRiders,
              )
            else if (riders.isEmpty)
              const EmptyRidersCard()
            else
              ...riders.map(
                buildRiderCard,
              ),
            const SizedBox(height: 90),
          ],
        ),
      ),
    );
  }
}

class CreateRiderDialog
    extends StatefulWidget {
  const CreateRiderDialog({
    required this.onCreate,
    super.key,
  });

  final Future<void> Function(
    Map<String, dynamic> payload,
  ) onCreate;

  @override
  State<CreateRiderDialog> createState() =>
      _CreateRiderDialogState();
}

class _CreateRiderDialogState
    extends State<CreateRiderDialog> {
  final GlobalKey<FormState> formKey =
      GlobalKey<FormState>();

  final TextEditingController
      fullNameController =
      TextEditingController();

  final TextEditingController phoneController =
      TextEditingController();

  final TextEditingController emailController =
      TextEditingController();

  final TextEditingController
      passwordController =
      TextEditingController();

  final TextEditingController
      plateNumberController =
      TextEditingController();

  final TextEditingController stateController =
      TextEditingController();

  final TextEditingController lgaController =
      TextEditingController();

  final TextEditingController addressController =
      TextEditingController();

  final TextEditingController
      emergencyNameController =
      TextEditingController();

  final TextEditingController
      emergencyPhoneController =
      TextEditingController();

  String vehicleType = 'MOTORCYCLE';

  bool hidePassword = true;
  bool isSubmitting = false;

  @override
  void dispose() {
    fullNameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    passwordController.dispose();
    plateNumberController.dispose();
    stateController.dispose();
    lgaController.dispose();
    addressController.dispose();
    emergencyNameController.dispose();
    emergencyPhoneController.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!(formKey.currentState?.validate() ??
        false)) {
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      await widget.onCreate({
        'fullName':
            fullNameController.text.trim(),
        'phone':
            phoneController.text.trim(),
        'email':
            emailController.text.trim(),
        'password': passwordController.text,
        'vehicleType': vehicleType,
        'plateNumber':
            plateNumberController.text.trim(),
        'riderState':
            stateController.text.trim(),
        'riderLga':
            lgaController.text.trim(),
        'riderAddress':
            addressController.text.trim(),
        'riderEmergencyContactName':
            emergencyNameController.text.trim(),
        'riderEmergencyContactPhone':
            emergencyPhoneController.text.trim(),
      });

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop();
    } catch (_) {
      // The parent screen shows the error.
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }
  @override
  Widget build(
    BuildContext context,
  ) {
    return AlertDialog(
      title: const Text(
        'Create Delivery Rider',
      ),
      content: SizedBox(
        width: 560,
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller:
                      fullNameController,
                  textCapitalization:
                      TextCapitalization.words,
                  decoration:
                      const InputDecoration(
                    labelText: 'Full name *',
                    prefixIcon: Icon(
                      Icons.person_outline,
                    ),
                  ),
                  validator:
                      (String? value) {
                    if (value == null ||
                        value.trim().isEmpty) {
                      return 'Full name is required.';
                    }

                    return null;
                  },
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      phoneController,
                  keyboardType:
                      TextInputType.phone,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Phone number *',
                    prefixIcon: Icon(
                      Icons.phone_outlined,
                    ),
                  ),
                  validator:
                      (String? value) {
                    if (value == null ||
                        value.trim().isEmpty) {
                      return 'Phone number is required.';
                    }

                    return null;
                  },
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      emailController,
                  keyboardType:
                      TextInputType.emailAddress,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Email address',
                    prefixIcon: Icon(
                      Icons.email_outlined,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      passwordController,
                  obscureText: hidePassword,
                  decoration: InputDecoration(
                    labelText:
                        'Temporary password *',
                    prefixIcon: const Icon(
                      Icons.lock_outline,
                    ),
                    suffixIcon: IconButton(
                      onPressed: () {
                        setState(() {
                          hidePassword =
                              !hidePassword;
                        });
                      },
                      icon: Icon(
                        hidePassword
                            ? Icons
                                .visibility_off_outlined
                            : Icons
                                .visibility_outlined,
                      ),
                    ),
                  ),
                  validator:
                      (String? value) {
                    if (value == null ||
                        value.length < 6) {
                      return 'Password must contain at least 6 characters.';
                    }

                    return null;
                  },
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: vehicleType,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Vehicle type',
                    prefixIcon: Icon(
                      Icons
                          .two_wheeler_outlined,
                    ),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'MOTORCYCLE',
                      child: Text(
                        'Motorcycle',
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'TRICYCLE',
                      child: Text(
                        'Tricycle',
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'BICYCLE',
                      child: Text(
                        'Bicycle',
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'CAR',
                      child: Text('Car'),
                    ),
                    DropdownMenuItem(
                      value: 'VAN',
                      child: Text('Van'),
                    ),
                    DropdownMenuItem(
                      value: 'TRUCK',
                      child: Text('Truck'),
                    ),
                    DropdownMenuItem(
                      value: 'OTHER',
                      child: Text('Other'),
                    ),
                  ],
                  onChanged: (
                    String? value,
                  ) {
                    if (value != null) {
                      setState(() {
                        vehicleType = value;
                      });
                    }
                  },
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      plateNumberController,
                  textCapitalization:
                      TextCapitalization.characters,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Plate number',
                    prefixIcon: Icon(
                      Icons
                          .confirmation_number_outlined,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller:
                            stateController,
                        textCapitalization:
                            TextCapitalization.words,
                        decoration:
                            const InputDecoration(
                          labelText: 'State',
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextFormField(
                        controller:
                            lgaController,
                        textCapitalization:
                            TextCapitalization.words,
                        decoration:
                            const InputDecoration(
                          labelText: 'LGA',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      addressController,
                  textCapitalization:
                      TextCapitalization.sentences,
                  maxLines: 2,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Residential address',
                    prefixIcon: Icon(
                      Icons
                          .location_on_outlined,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      emergencyNameController,
                  textCapitalization:
                      TextCapitalization.words,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Emergency contact name',
                    prefixIcon: Icon(
                      Icons
                          .contact_emergency_outlined,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller:
                      emergencyPhoneController,
                  keyboardType:
                      TextInputType.phone,
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Emergency contact phone',
                    prefixIcon: Icon(
                      Icons
                          .phone_in_talk_outlined,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: isSubmitting
              ? null
              : () {
                  Navigator.of(context).pop();
                },
          child: const Text(
            'Cancel',
          ),
        ),
        ElevatedButton.icon(
          onPressed:
              isSubmitting ? null : submit,
          icon: isSubmitting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child:
                      CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Icon(
                  Icons.person_add_alt_1,
                ),
          label: Text(
            isSubmitting
                ? 'Creating...'
                : 'Create Rider',
          ),
        ),
      ],
    );
  }
}

class RiderDetailsSheet
    extends StatelessWidget {
  const RiderDetailsSheet({
    required this.rider,
    required this.onStatusChanged,
    required this.onVerificationChanged,
    super.key,
  });

  final Map<String, dynamic> rider;

  final Future<void> Function(
    Map<String, dynamic> rider,
    String status,
  ) onStatusChanged;

  final Future<void> Function(
    Map<String, dynamic> rider,
    String verificationStatus, {
    String note,
  }) onVerificationChanged;

  String text(
    dynamic value, {
    String fallback = 'Not available',
  }) {
    final String result =
        value?.toString().trim() ?? '';

    return result.isEmpty ? fallback : result;
  }

  String upper(
    dynamic value, {
    String fallback = '',
  }) {
    return text(
      value,
      fallback: fallback,
    ).toUpperCase();
  }

  Future<bool> confirmAction(
    BuildContext context, {
    required String title,
    required String message,
  }) async {
    return await showDialog<bool>(
          context: context,
          builder: (
            BuildContext dialogContext,
          ) {
            return AlertDialog(
              title: Text(title),
              content: Text(message),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.of(
                      dialogContext,
                    ).pop(false);
                  },
                  child:
                      const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () {
                    Navigator.of(
                      dialogContext,
                    ).pop(true);
                  },
                  child: const Text(
                    'Continue',
                  ),
                ),
              ],
            );
          },
        ) ??
        false;
  }

  Widget infoTile(
    IconData icon,
    String title,
    String value,
  ) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor:
            const Color(0xFFE8F5EC),
        child: Icon(
          icon,
          color:
              const Color(0xFF159447),
        ),
      ),
      title: Text(
        title,
        style: const TextStyle(
          color: Colors.black54,
          fontSize: 12,
        ),
      ),
      subtitle: Text(
        value,
        style: const TextStyle(
          color: Colors.black87,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final String fullName = text(
      rider['fullName'],
      fallback: 'Delivery Rider',
    );

    final String status = upper(
      rider['status'],
      fallback: 'ACTIVE',
    );

    final String verification = upper(
      rider['riderVerificationStatus'],
      fallback: 'PENDING',
    );

    return Container(
      height:
          MediaQuery.sizeOf(context).height *
              0.90,
      decoration: const BoxDecoration(
        color: Color(0xFFF8FAFC),
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(24),
        ),
      ),
      child: Column(
        children: [
          Container(
            margin: const EdgeInsets.only(
              top: 10,
            ),
            width: 46,
            height: 5,
            decoration: BoxDecoration(
              color: Colors.grey.shade300,
              borderRadius:
                  BorderRadius.circular(10),
            ),
          ),
          Expanded(
            child: ListView(
              padding:
                  const EdgeInsets.all(20),
              children: [
                Row(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration:
                          const BoxDecoration(
                        color:
                            Color(0xFFE8F5EC),
                        shape:
                            BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons
                            .delivery_dining_rounded,
                        color:
                            Color(0xFF159447),
                        size: 38,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment:
                            CrossAxisAlignment
                                .start,
                        children: [
                          Text(
                            fullName,
                            style:
                                const TextStyle(
                              fontSize: 21,
                              fontWeight:
                                  FontWeight.bold,
                            ),
                          ),
                          const SizedBox(
                            height: 4,
                          ),
                          Text(
                            text(
                              rider['riderId'],
                              fallback:
                                  'No Rider ID',
                            ),
                            style:
                                const TextStyle(
                              color:
                                  Colors.black54,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () {
                        Navigator.of(context)
                            .pop();
                      },
                      icon: const Icon(
                        Icons.close,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    StatusChip(
                      text: status,
                    ),
                    VerificationChip(
                      status: verification,
                    ),
                    AvailabilityChip(
                      status: upper(
                        rider[
                            'availabilityStatus'],
                        fallback: 'OFFLINE',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Card(
                  elevation: 0,
                  color: Colors.white,
                  child: Padding(
                    padding:
                        const EdgeInsets.all(
                      14,
                    ),
                    child: Column(
                      children: [
                        infoTile(
                          Icons.phone_outlined,
                          'Phone number',
                          text(rider['phone']),
                        ),
                        infoTile(
                          Icons.email_outlined,
                          'Email address',
                          text(rider['email']),
                        ),
                        infoTile(
                          Icons
                              .two_wheeler_outlined,
                          'Vehicle type',
                          upper(
                            rider[
                                'vehicleType'],
                            fallback:
                                'Not set',
                          ).replaceAll(
                            '_',
                            ' ',
                          ),
                        ),
                        infoTile(
                          Icons
                              .confirmation_number_outlined,
                          'Plate number',
                          text(
                            rider[
                                'plateNumber'],
                          ),
                        ),
                        infoTile(
                          Icons
                              .location_on_outlined,
                          'State and LGA',
                          '${text(
                            rider[
                                    'riderState'] ??
                                rider['state'],
                          )}, ${text(
                            rider[
                                    'riderLga'] ??
                                rider['lga'],
                          )}',
                        ),
                        infoTile(
                          Icons.home_outlined,
                          'Address',
                          text(
                            rider[
                                'riderAddress'],
                          ),
                        ),
                        infoTile(
                          Icons
                              .contact_emergency_outlined,
                          'Emergency contact',
                          '${text(
                            rider[
                                'riderEmergencyContactName'],
                          )} — ${text(
                            rider[
                                'riderEmergencyContactPhone'],
                          )}',
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Rider Performance',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                Card(
                  elevation: 0,
                  color: Colors.white,
                  child: Padding(
                    padding:
                        const EdgeInsets.all(
                      16,
                    ),
                    child: Wrap(
                      spacing: 24,
                      runSpacing: 18,
                      children: [
                        PerformanceValue(
                          title: 'Assigned',
                          value: text(
                            rider[
                                'totalAssignedDeliveries'],
                            fallback: '0',
                          ),
                        ),
                        PerformanceValue(
                          title: 'Accepted',
                          value: text(
                            rider[
                                'totalAcceptedDeliveries'],
                            fallback: '0',
                          ),
                        ),
                        PerformanceValue(
                          title: 'Completed',
                          value: text(
                            rider[
                                'totalCompletedDeliveries'],
                            fallback: '0',
                          ),
                        ),
                        PerformanceValue(
                          title: 'Rejected',
                          value: text(
                            rider[
                                'totalRejectedDeliveries'],
                            fallback: '0',
                          ),
                        ),
                        PerformanceValue(
                          title: 'Rating',
                          value:
                              '${text(
                            rider[
                                'riderRating'],
                            fallback: '0',
                          )}/5',
                        ),
                        PerformanceValue(
                          title:
                              'Total Earnings',
                          value:
                              '₦${text(
                            rider[
                                'totalRiderEarnings'],
                            fallback: '0',
                          )}',
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Verification Actions',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child:
                          ElevatedButton.icon(
                        onPressed:
                            verification ==
                                    'VERIFIED'
                                ? null
                                : () async {
                                    final bool
                                        confirmed =
                                        await confirmAction(
                                      context,
                                      title:
                                          'Verify Rider',
                                      message:
                                          'Confirm that this rider has passed all required checks.',
                                    );

                                    if (!confirmed) {
                                      return;
                                    }

                                    await onVerificationChanged(
                                      rider,
                                      'VERIFIED',
                                      note:
                                          'Verified by Head Office.',
                                    );

                                    if (context
                                        .mounted) {
                                      Navigator.of(
                                        context,
                                      ).pop();
                                    }
                                  },
                        icon: const Icon(
                          Icons
                              .verified_rounded,
                        ),
                        label: const Text(
                          'Verify',
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child:
                          OutlinedButton.icon(
                        onPressed:
                            verification ==
                                    'REJECTED'
                                ? null
                                : () async {
                                    final bool
                                        confirmed =
                                        await confirmAction(
                                      context,
                                      title:
                                          'Reject Rider',
                                      message:
                                          'This rider will not be allowed to receive delivery jobs.',
                                    );

                                    if (!confirmed) {
                                      return;
                                    }

                                    await onVerificationChanged(
                                      rider,
                                      'REJECTED',
                                      note:
                                          'Rejected by Head Office.',
                                    );

                                    if (context
                                        .mounted) {
                                      Navigator.of(
                                        context,
                                      ).pop();
                                    }
                                  },
                        icon: const Icon(
                          Icons
                              .cancel_outlined,
                        ),
                        label: const Text(
                          'Reject',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                const Text(
                  'Account Status',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                if (status == 'ACTIVE')
                  OutlinedButton.icon(
                    onPressed: () async {
                      final bool confirmed =
                          await confirmAction(
                        context,
                        title:
                            'Suspend Rider',
                        message:
                            'The rider will be logged out and will not receive delivery jobs.',
                      );

                      if (!confirmed) {
                        return;
                      }

                      await onStatusChanged(
                        rider,
                        'SUSPENDED',
                      );

                      if (context.mounted) {
                        Navigator.of(context)
                            .pop();
                      }
                    },
                    icon: const Icon(
                      Icons.block_rounded,
                    ),
                    label: const Text(
                      'Suspend Rider Account',
                    ),
                  )
                else
                  ElevatedButton.icon(
                    onPressed: () async {
                      final bool confirmed =
                          await confirmAction(
                        context,
                        title:
                            'Activate Rider',
                        message:
                            'The rider account will become active again.',
                      );

                      if (!confirmed) {
                        return;
                      }

                      await onStatusChanged(
                        rider,
                        'ACTIVE',
                      );

                      if (context.mounted) {
                        Navigator.of(context)
                            .pop();
                      }
                    },
                    icon: const Icon(
                      Icons
                          .check_circle_outline,
                    ),
                    label: const Text(
                      'Activate Rider Account',
                    ),
                  ),
                const SizedBox(height: 30),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class PerformanceValue
    extends StatelessWidget {
  const PerformanceValue({
    required this.title,
    required this.value,
    super.key,
  });

  final String title;
  final String value;

  @override
  Widget build(
    BuildContext context,
  ) {
    return SizedBox(
      width: 120,
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            title,
            style: const TextStyle(
              color: Colors.black54,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class MiniInfoChip
    extends StatelessWidget {
  const MiniInfoChip({
    required this.icon,
    required this.text,
    super.key,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: Colors.black54,
          ),
          const SizedBox(width: 5),
          Text(
            text,
            style: const TextStyle(
              fontSize: 11,
              color: Colors.black54,
            ),
          ),
        ],
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({
    required this.text,
    super.key,
  });

  final String text;

  @override
  Widget build(
    BuildContext context,
  ) {
    final String status =
        text.toUpperCase();

    final bool isActive =
        status == 'ACTIVE';

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: isActive
            ? Colors.green.withValues(
                alpha: 0.12,
              )
            : Colors.red.withValues(
                alpha: 0.12,
              ),
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: isActive
              ? Colors.green.shade800
              : Colors.red.shade800,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class VerificationChip
    extends StatelessWidget {
  const VerificationChip({
    required this.status,
    super.key,
  });

  final String status;

  @override
  Widget build(
    BuildContext context,
  ) {
    final String value =
        status.toUpperCase();

    Color color = Colors.orange;

    if (value == 'VERIFIED') {
      color = Colors.green;
    } else if (value == 'REJECTED' ||
        value == 'SUSPENDED') {
      color = Colors.red;
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(
          alpha: 0.12,
        ),
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Text(
        value.replaceAll('_', ' '),
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class AvailabilityChip
    extends StatelessWidget {
  const AvailabilityChip({
    required this.status,
    super.key,
  });

  final String status;

  @override
  Widget build(
    BuildContext context,
  ) {
    final String value =
        status.toUpperCase();

    Color color = Colors.grey;

    if (value == 'ONLINE') {
      color = Colors.green;
    } else if (value == 'BUSY') {
      color = Colors.orange;
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(
          alpha: 0.12,
        ),
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Text(
        value,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class ErrorCard extends StatelessWidget {
  const ErrorCard({
    required this.message,
    required this.onRetry,
    super.key,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.red.withValues(
          alpha: 0.06,
        ),
        borderRadius:
            BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.error_outline,
            size: 44,
            color: Colors.red,
          ),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(
              Icons.refresh,
            ),
            label:
                const Text('Try Again'),
          ),
        ],
      ),
    );
  }
}

class EmptyRidersCard
    extends StatelessWidget {
  const EmptyRidersCard({
    super.key,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(16),
        border: Border.all(
          color:
              const Color(0xFFE2E8F0),
        ),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.delivery_dining_outlined,
            size: 60,
            color: Color(0xFF159447),
          ),
          SizedBox(height: 14),
          Text(
            'No Delivery Riders',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          SizedBox(height: 8),
          Text(
            'Use the Add Rider button to create the first ServicePay delivery rider account.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.black54,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}