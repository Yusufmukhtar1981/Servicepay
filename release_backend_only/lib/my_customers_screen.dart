import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'create_customer_screen.dart';

class MyCustomersScreen extends StatefulWidget {
  const MyCustomersScreen({super.key});

  @override
  State<MyCustomersScreen> createState() => _MyCustomersScreenState();
}

class _MyCustomersScreenState extends State<MyCustomersScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final TextEditingController searchController = TextEditingController();

  bool isLoading = true;
  String errorMessage = '';
  List<Map<String, dynamic>> customers = [];

  @override
  void initState() {
    super.initState();
    loadCustomers();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    const keys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final key in keys) {
      final value = prefs.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Future<void> loadCustomers() async {
    setState(() {
      isLoading = true;
      errorMessage = '';
    });

    try {
      final token = await getToken();

      if (token == null) {
        throw Exception(
          'Please sign in again.',
        );
      }

      final String search = searchController.text.trim();

      final Uri uri = Uri.parse(
        '$baseUrl/management/customers',
      ).replace(
        queryParameters: search.isEmpty ? null : {'search': search},
      );

      final response = await http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 40),
      );

      final dynamic decoded = jsonDecode(response.body);

      final Map<String, dynamic> result = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : {};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          result['success'] == true) {
        final dynamic raw = result['customers'];

        final List<Map<String, dynamic>> loaded = raw is List
            ? raw
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(item),
                )
                .toList()
            : [];

        if (!mounted) {
          return;
        }

        setState(() {
          customers = loaded;
          isLoading = false;
        });

        return;
      }

      throw Exception(
        result['message']?.toString() ?? 'Unable to load customers.',
      );
    } on TimeoutException {
      setState(() {
        isLoading = false;
        errorMessage = 'The server took too long to respond.';
      });
    } catch (error) {
      setState(() {
        isLoading = false;
        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
  }

  Future<void> openCreateCustomer() async {
    final bool? created = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => const CreateCustomerScreen(),
      ),
    );

    if (created == true) {
      await loadCustomers();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FB),
      appBar: AppBar(
        title: const Text('My Customers'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF101828),
        actions: [
          IconButton(
            onPressed: loadCustomers,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: openCreateCustomer,
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        icon: const Icon(
          Icons.person_add_rounded,
        ),
        label: const Text(
          'Create Customer',
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: searchController,
                onSubmitted: (_) => loadCustomers(),
                decoration: InputDecoration(
                  hintText: 'Search name, phone or email',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    onPressed: loadCustomers,
                    icon: const Icon(
                      Icons.arrow_forward,
                    ),
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      16,
                    ),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            Expanded(
              child: Builder(
                builder: (context) {
                  if (isLoading) {
                    return const Center(
                      child: CircularProgressIndicator(),
                    );
                  }

                  if (errorMessage.isNotEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(
                          24,
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              errorMessage,
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(
                              height: 14,
                            ),
                            FilledButton(
                              onPressed: loadCustomers,
                              child: const Text(
                                'Try Again',
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }

                  if (customers.isEmpty) {
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.groups_outlined,
                            size: 65,
                            color: primaryGreen,
                          ),
                          const SizedBox(
                            height: 12,
                          ),
                          const Text(
                            'No customers yet',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(
                            height: 8,
                          ),
                          const Text(
                            'Create your first customer.',
                          ),
                          const SizedBox(
                            height: 18,
                          ),
                          FilledButton.icon(
                            onPressed: openCreateCustomer,
                            icon: const Icon(
                              Icons.person_add,
                            ),
                            label: const Text(
                              'Create Customer',
                            ),
                          ),
                        ],
                      ),
                    );
                  }

                  return RefreshIndicator(
                    onRefresh: loadCustomers,
                    child: ListView.separated(
                      padding: const EdgeInsets.fromLTRB(
                        16,
                        0,
                        16,
                        100,
                      ),
                      itemCount: customers.length,
                      separatorBuilder: (_, __) => const SizedBox(
                        height: 10,
                      ),
                      itemBuilder: (context, index) {
                        final customer = customers[index];

                        final String name =
                            customer['fullName']?.toString() ?? 'Customer';

                        final String phone =
                            customer['phone']?.toString() ?? '';

                        final String email =
                            customer['email']?.toString() ?? '';

                        final String status =
                            customer['status']?.toString() ?? 'ACTIVE';

                        return Container(
                          padding: const EdgeInsets.all(
                            15,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: const Color(
                                0xFFE4E7EC,
                              ),
                            ),
                          ),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 24,
                                backgroundColor: const Color(
                                  0xFFEAF7F0,
                                ),
                                child: Text(
                                  name.isEmpty ? 'C' : name[0].toUpperCase(),
                                  style: const TextStyle(
                                    color: primaryGreen,
                                    fontWeight: FontWeight.bold,
                                  ),
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
                                      name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15,
                                      ),
                                    ),
                                    const SizedBox(
                                      height: 4,
                                    ),
                                    Text(phone),
                                    if (email.isNotEmpty)
                                      Text(
                                        email,
                                        style: const TextStyle(
                                          color: Colors.grey,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 9,
                                  vertical: 5,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(
                                    0xFFEAF7F0,
                                  ),
                                  borderRadius: BorderRadius.circular(
                                    20,
                                  ),
                                ),
                                child: Text(
                                  status,
                                  style: const TextStyle(
                                    color: primaryGreen,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
