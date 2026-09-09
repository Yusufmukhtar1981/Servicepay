import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminDeliveryCoverageScreen extends StatefulWidget {
  const AdminDeliveryCoverageScreen({
    super.key,
  });

  @override
  State<AdminDeliveryCoverageScreen> createState() =>
      _AdminDeliveryCoverageScreenState();
}

class _AdminDeliveryCoverageScreenState
    extends State<AdminDeliveryCoverageScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryColor = Color(0xFF0F766E);

  final TextEditingController searchController = TextEditingController();

  List<Map<String, dynamic>> states = <Map<String, dynamic>>[];

  bool isLoading = true;
  bool isRefreshing = false;
  bool isUpdating = false;

  String selectedFilter = 'ALL';
  String errorMessage = '';

  int totalStates = 0;
  int liveStates = 0;
  int notLiveStates = 0;

  final Set<String> selectedStateCodes = <String>{};

  final List<String> filters = const [
    'ALL',
    'LIVE',
    'NOT_LIVE',
  ];

  @override
  void initState() {
    super.initState();
    loadCoverage();
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
      return Map<String, dynamic>.from(
        value,
      );
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
          (Map item) => Map<String, dynamic>.from(
            item,
          ),
        )
        .toList();
  }

  String text(
    dynamic value, {
    String fallback = '',
  }) {
    final String result = value?.toString().trim() ?? '';

    return result.isEmpty ? fallback : result;
  }

  int integer(
    dynamic value,
  ) {
    return int.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded = jsonDecode(body);

    return mapFromDynamic(decoded);
  }

  Future<String> getToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token = preferences.getString(key)?.trim() ?? '';

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
          content: Text(
            message,
          ),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(
            seconds: 4,
          ),
          backgroundColor: isError ? Colors.red.shade700 : primaryColor,
        ),
      );
  }

  Future<void> loadCoverage({
    bool refresh = false,
  }) async {
    if (mounted) {
      setState(() {
        if (refresh) {
          isRefreshing = true;
        } else {
          isLoading = true;
        }

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

      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/delivery/coverage/admin',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(
          seconds: 40,
        ),
      );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to load Delivery Coverage.',
          ),
        );
      }

      final Map<String, dynamic> data = mapFromDynamic(
        root['data'],
      );

      final List<Map<String, dynamic>> loadedStates = listFromDynamic(
        data['states'] ?? root['states'],
      );

      loadedStates.sort(
        (
          Map<String, dynamic> first,
          Map<String, dynamic> second,
        ) {
          return text(
            first['stateName'],
          ).compareTo(
            text(
              second['stateName'],
            ),
          );
        },
      );

      final Map<String, dynamic> loadedSummary = mapFromDynamic(
        data['summary'] ?? root['summary'],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        states = loadedStates;

        totalStates = integer(
          loadedSummary['totalStates'],
        );

        liveStates = integer(
          loadedSummary['liveStates'],
        );

        notLiveStates = integer(
          loadedSummary['notLiveStates'],
        );

        if (totalStates == 0) {
          totalStates = states.length;

          liveStates = states
              .where(
                (
                  Map<String, dynamic> state,
                ) =>
                    state['isLive'] == true,
              )
              .length;

          notLiveStates = totalStates - liveStates;
        }

        selectedStateCodes.removeWhere(
          (
            String code,
          ) =>
              !states.any(
            (
              Map<String, dynamic> state,
            ) =>
                text(
                  state['stateCode'],
                ) ==
                code,
          ),
        );

        isLoading = false;
        isRefreshing = false;
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;

        errorMessage = 'The server took too long to respond.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;

        errorMessage = 'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;

        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
  }

  List<Map<String, dynamic>> get filteredStates {
    final String query = searchController.text.trim().toLowerCase();

    return states.where(
      (
        Map<String, dynamic> state,
      ) {
        final String stateName = text(
          state['stateName'],
        ).toLowerCase();

        final String stateCode = text(
          state['stateCode'],
        ).toLowerCase();

        final bool isLive = state['isLive'] == true;

        final bool matchesSearch = query.isEmpty ||
            stateName.contains(
              query,
            ) ||
            stateCode.contains(
              query,
            );

        bool matchesFilter = true;

        if (selectedFilter == 'LIVE') {
          matchesFilter = isLive;
        }

        if (selectedFilter == 'NOT_LIVE') {
          matchesFilter = !isLive;
        }

        return matchesSearch && matchesFilter;
      },
    ).toList();
  }

  Future<Map<String, dynamic>?> openStateSettingsDialog(
    Map<String, dynamic> state,
  ) async {
    final TextEditingController messageController = TextEditingController(
      text: text(
        state['unavailableMessage'],
      ),
    );

    final TextEditingController noteController = TextEditingController(
      text: text(
        state['adminNote'],
      ),
    );

    DateTime? selectedDate = DateTime.tryParse(
      text(
        state['expectedLaunchDate'],
      ),
    );

    bool isLive = state['isLive'] == true;

    final Map<String, dynamic>? result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext dialogContext,
            void Function(
              void Function(),
            ) setDialogState,
          ) {
            return AlertDialog(
              title: Text(
                text(
                  state['stateName'],
                  fallback: 'State',
                ),
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        isLive ? 'Delivery is LIVE' : 'Delivery is NOT LIVE',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      subtitle: Text(
                        isLive
                            ? 'Customers can create deliveries in this state.'
                            : 'Customers cannot create deliveries in this state.',
                      ),
                      value: isLive,
                      activeColor: primaryColor,
                      onChanged: (
                        bool value,
                      ) {
                        setDialogState(
                          () {
                            isLive = value;
                          },
                        );
                      },
                    ),
                    const SizedBox(
                      height: 12,
                    ),
                    TextField(
                      controller: messageController,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        labelText: 'Unavailable message',
                        hintText: 'Message shown when the state is not live',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(
                      height: 14,
                    ),
                    InkWell(
                      onTap: () async {
                        final DateTime now = DateTime.now();

                        final DateTime? selected = await showDatePicker(
                          context: dialogContext,
                          initialDate: selectedDate ?? now,
                          firstDate: DateTime(
                            now.year,
                            now.month,
                            now.day,
                          ),
                          lastDate: DateTime(
                            now.year + 5,
                          ),
                        );

                        if (selected != null) {
                          setDialogState(
                            () {
                              selectedDate = selected;
                            },
                          );
                        }
                      },
                      borderRadius: BorderRadius.circular(
                        12,
                      ),
                      child: InputDecorator(
                        decoration: const InputDecoration(
                          labelText: 'Expected launch date',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(
                            Icons.calendar_month_outlined,
                          ),
                        ),
                        child: Text(
                          selectedDate == null
                              ? 'Not provided'
                              : '${selectedDate!.day.toString().padLeft(2, '0')}/'
                                  '${selectedDate!.month.toString().padLeft(2, '0')}/'
                                  '${selectedDate!.year}',
                        ),
                      ),
                    ),
                    if (selectedDate != null)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () {
                            setDialogState(
                              () {
                                selectedDate = null;
                              },
                            );
                          },
                          child: const Text(
                            'Remove date',
                          ),
                        ),
                      ),
                    const SizedBox(
                      height: 8,
                    ),
                    TextField(
                      controller: noteController,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Admin note',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                      <String, dynamic>{
                        'isLive': isLive,
                        'unavailableMessage': messageController.text.trim(),
                        'expectedLaunchDate': selectedDate?.toIso8601String(),
                        'adminNote': noteController.text.trim(),
                      },
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryColor,
                  ),
                  child: const Text(
                    'Save Changes',
                  ),
                ),
              ],
            );
          },
        );
      },
    );

    messageController.dispose();
    noteController.dispose();

    return result;
  }

  Future<void> updateOneState(
    Map<String, dynamic> state,
  ) async {
    if (isUpdating) {
      return;
    }

    final Map<String, dynamic>? settings = await openStateSettingsDialog(
      state,
    );

    if (settings == null) {
      return;
    }

    final String stateCode = text(
      state['stateCode'],
    );

    if (stateCode.isEmpty) {
      showMessage(
        'Invalid state code.',
      );

      return;
    }

    setState(() {
      isUpdating = true;
    });

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/delivery/coverage/admin/$stateCode',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(
              settings,
            ),
          )
          .timeout(
            const Duration(
              seconds: 40,
            ),
          );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to update Delivery Coverage.',
          ),
        );
      }

      showMessage(
        text(
          root['message'],
          fallback: 'Delivery Coverage updated successfully.',
        ),
        isError: false,
      );

      await loadCoverage(
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
    } finally {
      if (mounted) {
        setState(() {
          isUpdating = false;
        });
      }
    }
  }

  Future<void> bulkUpdate({
    required bool makeLive,
  }) async {
    if (isUpdating || selectedStateCodes.isEmpty) {
      return;
    }

    final bool confirmed = await showDialog<bool>(
          context: context,
          builder: (
            BuildContext dialogContext,
          ) {
            return AlertDialog(
              title: Text(
                makeLive ? 'Activate States' : 'Deactivate States',
              ),
              content: Text(
                makeLive
                    ? 'Make Delivery LIVE in ${selectedStateCodes.length} selected state(s)?'
                    : 'Make Delivery NOT LIVE in ${selectedStateCodes.length} selected state(s)?',
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                      false,
                    );
                  },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                      true,
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: makeLive ? primaryColor : Colors.red,
                  ),
                  child: const Text(
                    'Confirm',
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

    setState(() {
      isUpdating = true;
    });

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/delivery/coverage/admin/bulk/update',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'stateCodes': selectedStateCodes.toList(),
              'isLive': makeLive,
            }),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to update selected states.',
          ),
        );
      }

      showMessage(
        text(
          root['message'],
          fallback: 'Selected states updated successfully.',
        ),
        isError: false,
      );

      selectedStateCodes.clear();

      await loadCoverage(
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
    } finally {
      if (mounted) {
        setState(() {
          isUpdating = false;
        });
      }
    }
  }

  Widget summaryCard({
    required String title,
    required int value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      width: 150,
      padding: const EdgeInsets.all(
        15,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(
          17,
        ),
        border: Border.all(
          color: const Color(
            0xFFE2E8F0,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: color,
          ),
          const SizedBox(
            height: 10,
          ),
          Text(
            title,
            style: const TextStyle(
              color: Colors.black54,
              fontSize: 12,
            ),
          ),
          const SizedBox(
            height: 4,
          ),
          Text(
            value.toString(),
            style: const TextStyle(
              fontSize: 23,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildStateCard(
    Map<String, dynamic> state,
  ) {
    final String stateCode = text(
      state['stateCode'],
    );

    final String stateName = text(
      state['stateName'],
      fallback: stateCode,
    );

    final bool isLive = state['isLive'] == true;

    final bool selected = selectedStateCodes.contains(
      stateCode,
    );

    final String expectedDate = text(
      state['expectedLaunchDate'],
    );

    return Card(
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(
          17,
        ),
        side: BorderSide(
          color: selected
              ? primaryColor
              : const Color(
                  0xFFE2E8F0,
                ),
          width: selected ? 2 : 1,
        ),
      ),
      child: InkWell(
        onTap: isUpdating
            ? null
            : () {
                updateOneState(
                  state,
                );
              },
        borderRadius: BorderRadius.circular(
          17,
        ),
        child: Padding(
          padding: const EdgeInsets.all(
            14,
          ),
          child: Row(
            children: [
              Checkbox(
                value: selected,
                activeColor: primaryColor,
                onChanged: isUpdating
                    ? null
                    : (
                        bool? value,
                      ) {
                        setState(() {
                          if (value == true) {
                            selectedStateCodes.add(
                              stateCode,
                            );
                          } else {
                            selectedStateCodes.remove(
                              stateCode,
                            );
                          }
                        });
                      },
              ),
              Container(
                width: 47,
                height: 47,
                decoration: BoxDecoration(
                  color: isLive
                      ? Colors.green.withValues(
                          alpha: 0.10,
                        )
                      : Colors.orange.withValues(
                          alpha: 0.10,
                        ),
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                ),
                child: Icon(
                  isLive
                      ? Icons.local_shipping_rounded
                      : Icons.location_off_outlined,
                  color: isLive ? Colors.green : Colors.orange,
                ),
              ),
              const SizedBox(
                width: 12,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      stateName,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(
                      height: 4,
                    ),
                    Text(
                      stateCode.replaceAll(
                        '_',
                        ' ',
                      ),
                      style: const TextStyle(
                        color: Colors.black54,
                        fontSize: 11,
                      ),
                    ),
                    if (!isLive && expectedDate.isNotEmpty) ...[
                      const SizedBox(
                        height: 4,
                      ),
                      Text(
                        'Expected launch: ${formatDate(expectedDate)}',
                        style: const TextStyle(
                          color: Colors.black54,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: isLive
                      ? Colors.green.withValues(
                          alpha: 0.12,
                        )
                      : Colors.orange.withValues(
                          alpha: 0.12,
                        ),
                  borderRadius: BorderRadius.circular(
                    20,
                  ),
                ),
                child: Text(
                  isLive ? 'LIVE' : 'NOT LIVE',
                  style: TextStyle(
                    color:
                        isLive ? Colors.green.shade800 : Colors.orange.shade800,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(
                width: 6,
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: Colors.grey,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String formatDate(
    String value,
  ) {
    final DateTime? parsed = DateTime.tryParse(
      value,
    );

    if (parsed == null) {
      return value;
    }

    final DateTime local = parsed.toLocal();

    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/'
        '${local.year}';
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final List<Map<String, dynamic>> visibleStates = filteredStates;

    return Scaffold(
      backgroundColor: const Color(
        0xFFF5F7FA,
      ),
      body: SafeArea(
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : RefreshIndicator(
                onRefresh: () {
                  return loadCoverage(
                    refresh: true,
                  );
                },
                child: ListView(
                  padding: const EdgeInsets.all(
                    16,
                  ),
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Delivery Coverage',
                            style: TextStyle(
                              fontSize: 23,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Refresh',
                          onPressed: isRefreshing
                              ? null
                              : () {
                                  loadCoverage(
                                    refresh: true,
                                  );
                                },
                          icon: isRefreshing
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(
                                  Icons.refresh_rounded,
                                ),
                        ),
                      ],
                    ),
                    const SizedBox(
                      height: 6,
                    ),
                    const Text(
                      'Activate ServicePay Delivery only in states where operations are ready.',
                      style: TextStyle(
                        color: Colors.black54,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(
                      height: 16,
                    ),
                    SizedBox(
                      height: 125,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          summaryCard(
                            title: 'Total Locations',
                            value: totalStates,
                            icon: Icons.map_outlined,
                            color: primaryColor,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          summaryCard(
                            title: 'Live States',
                            value: liveStates,
                            icon: Icons.check_circle_outline,
                            color: Colors.green,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          summaryCard(
                            title: 'Not Live',
                            value: notLiveStates,
                            icon: Icons.location_off_outlined,
                            color: Colors.orange,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(
                      height: 18,
                    ),
                    TextField(
                      controller: searchController,
                      onChanged: (_) {
                        setState(
                          () {},
                        );
                      },
                      decoration: InputDecoration(
                        hintText: 'Search state or FCT Abuja',
                        prefixIcon: const Icon(
                          Icons.search_rounded,
                        ),
                        suffixIcon: searchController.text.isEmpty
                            ? null
                            : IconButton(
                                onPressed: () {
                                  searchController.clear();

                                  setState(
                                    () {},
                                  );
                                },
                                icon: const Icon(
                                  Icons.close_rounded,
                                ),
                              ),
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            15,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(
                      height: 13,
                    ),
                    SizedBox(
                      height: 42,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: filters.map(
                          (
                            String filter,
                          ) {
                            final bool selected = selectedFilter == filter;

                            return Padding(
                              padding: const EdgeInsets.only(
                                right: 8,
                              ),
                              child: ChoiceChip(
                                selected: selected,
                                label: Text(
                                  filter.replaceAll(
                                    '_',
                                    ' ',
                                  ),
                                ),
                                selectedColor: primaryColor,
                                labelStyle: TextStyle(
                                  color:
                                      selected ? Colors.white : Colors.black54,
                                  fontWeight: FontWeight.w700,
                                ),
                                onSelected: (_) {
                                  setState(
                                    () {
                                      selectedFilter = filter;
                                    },
                                  );
                                },
                              ),
                            );
                          },
                        ).toList(),
                      ),
                    ),
                    if (selectedStateCodes.isNotEmpty) ...[
                      const SizedBox(
                        height: 14,
                      ),
                      Container(
                        padding: const EdgeInsets.all(
                          13,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(
                            14,
                          ),
                          border: Border.all(
                            color: const Color(
                              0xFFE2E8F0,
                            ),
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${selectedStateCodes.length} state(s) selected',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            TextButton(
                              onPressed: isUpdating
                                  ? null
                                  : () {
                                      setState(
                                        () {
                                          selectedStateCodes.clear();
                                        },
                                      );
                                    },
                              child: const Text(
                                'Clear',
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(
                        height: 10,
                      ),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: isUpdating
                                  ? null
                                  : () {
                                      bulkUpdate(
                                        makeLive: false,
                                      );
                                    },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.red,
                                side: const BorderSide(
                                  color: Colors.red,
                                ),
                              ),
                              icon: const Icon(
                                Icons.location_off_outlined,
                              ),
                              label: const Text(
                                'Deactivate',
                              ),
                            ),
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: isUpdating
                                  ? null
                                  : () {
                                      bulkUpdate(
                                        makeLive: true,
                                      );
                                    },
                              style: FilledButton.styleFrom(
                                backgroundColor: primaryColor,
                              ),
                              icon: const Icon(
                                Icons.check_circle_outline,
                              ),
                              label: const Text(
                                'Activate',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(
                      height: 16,
                    ),
                    if (errorMessage.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.all(
                          17,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.red.withValues(
                            alpha: 0.08,
                          ),
                          borderRadius: BorderRadius.circular(
                            14,
                          ),
                        ),
                        child: Column(
                          children: [
                            Text(
                              errorMessage,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.red,
                              ),
                            ),
                            const SizedBox(
                              height: 10,
                            ),
                            FilledButton(
                              onPressed: loadCoverage,
                              child: const Text(
                                'Try Again',
                              ),
                            ),
                          ],
                        ),
                      )
                    else if (visibleStates.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(
                          30,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(
                            18,
                          ),
                        ),
                        child: const Column(
                          children: [
                            Icon(
                              Icons.search_off_rounded,
                              size: 48,
                              color: Colors.grey,
                            ),
                            SizedBox(
                              height: 9,
                            ),
                            Text(
                              'No Delivery Coverage state found.',
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    else
                      ...visibleStates.map(
                        buildStateCard,
                      ),
                    const SizedBox(
                      height: 40,
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
