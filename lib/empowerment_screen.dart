import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class EmpowermentScreen extends StatefulWidget {
  const EmpowermentScreen({super.key});

  @override
  State<EmpowermentScreen> createState() => _EmpowermentScreenState();
}

class _EmpowermentScreenState extends State<EmpowermentScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  String errorMessage = '';

  List<dynamic> programs = [];
  List<dynamic> applications = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Map<String, String>> _headers() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token') ?? '';

    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  List<dynamic> _extractList(dynamic body, List<String> keys) {
    if (body is List) return body;

    if (body is Map) {
      for (final key in keys) {
        final value = body[key];
        if (value is List) return value;
      }

      final data = body['data'];
      if (data is List) return data;

      if (data is Map) {
        for (final key in keys) {
          final value = data[key];
          if (value is List) return value;
        }
      }
    }

    return [];
  }

  String _message(dynamic body, String fallback) {
    if (body is Map && body['message'] != null) {
      return body['message'].toString();
    }
    return fallback;
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final headers = await _headers();

      final results = await Future.wait([
        http
            .get(
              Uri.parse('$baseUrl/empowerment/available-programs'),
              headers: headers,
            )
            .timeout(const Duration(seconds: 45)),
        http
            .get(
              Uri.parse('$baseUrl/empowerment/my-applications'),
              headers: headers,
            )
            .timeout(const Duration(seconds: 45)),
      ]);

      dynamic programBody;
      dynamic applicationBody;

      try {
        programBody = jsonDecode(results[0].body);
      } catch (_) {
        programBody = null;
      }

      try {
        applicationBody = jsonDecode(results[1].body);
      } catch (_) {
        applicationBody = null;
      }

      if (results[0].statusCode < 200 || results[0].statusCode >= 300) {
        throw Exception(
          _message(
            programBody,
            'Unable to load empowerment programs.',
          ),
        );
      }

      if (mounted) {
        setState(() {
          programs = _extractList(
            programBody,
            ['programs', 'availablePrograms', 'items'],
          );

          if (results[1].statusCode >= 200 && results[1].statusCode < 300) {
            applications = _extractList(
              applicationBody,
              ['applications', 'myApplications', 'items'],
            );
          }

          isLoading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  String _idOf(dynamic item) {
    if (item is! Map) return '';

    return (item['_id'] ?? item['id'] ?? item['programId'] ?? '').toString();
  }

  String _nameOf(dynamic item) {
    if (item is! Map) return 'Empowerment Program';

    return (item['name'] ??
            item['title'] ??
            item['programName'] ??
            'Empowerment Program')
        .toString();
  }

  String _descriptionOf(dynamic item) {
    if (item is! Map) return '';

    return (item['description'] ?? item['summary'] ?? item['purpose'] ?? '')
        .toString();
  }

  String _statusOf(dynamic item) {
    if (item is! Map) return '';

    return (item['applicationStatus'] ?? item['status'] ?? '')
        .toString()
        .toUpperCase();
  }

  bool _alreadyApplied(String programId) {
    if (programId.isEmpty) return false;

    for (final application in applications) {
      if (application is! Map) continue;

      final rawProgram = application['program'] ?? application['programId'];

      String applicationProgramId = '';

      if (rawProgram is Map) {
        applicationProgramId =
            (rawProgram['_id'] ?? rawProgram['id'] ?? '').toString();
      } else if (rawProgram != null) {
        applicationProgramId = rawProgram.toString();
      }

      if (applicationProgramId == programId) {
        return true;
      }
    }

    return false;
  }

  Future<void> _apply(dynamic program) async {
    final programId = _idOf(program);

    if (programId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Program ID is unavailable.'),
        ),
      );
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Apply for Empowerment'),
          content: Text(
            'Do you want to apply for "${_nameOf(program)}"?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Apply'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    try {
      final response = await http
          .post(
            Uri.parse(
              '$baseUrl/empowerment/programs/$programId/apply',
            ),
            headers: await _headers(),
            body: jsonEncode({}),
          )
          .timeout(const Duration(seconds: 45));

      dynamic body;

      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = null;
      }

      if (!mounted) return;

      if (response.statusCode >= 200 && response.statusCode < 300) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _message(
                body,
                'Empowerment application submitted successfully.',
              ),
            ),
          ),
        );

        await _load();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _message(
                body,
                'Unable to submit empowerment application.',
              ),
            ),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst('Exception: ', ''),
          ),
        ),
      );
    }
  }

  Widget _statusChip(String status) {
    if (status.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF7F0),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        status.replaceAll('_', ' '),
        style: const TextStyle(
          color: Color(0xFF08783E),
          fontWeight: FontWeight.w700,
          fontSize: 11,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('ServicePay Empowerment'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : errorMessage.isNotEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.cloud_off_rounded,
                          size: 54,
                          color: Colors.grey,
                        ),
                        const SizedBox(height: 14),
                        const Text(
                          'Unable to load Empowerment',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          errorMessage,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 18),
                        FilledButton.icon(
                          onPressed: _load,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Try Again'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(18),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [
                              Color(0xFF08783E),
                              Color(0xFF12A150),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(22),
                        ),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.volunteer_activism_rounded,
                              color: Colors.white,
                              size: 34,
                            ),
                            SizedBox(height: 12),
                            Text(
                              'ServicePay Empowerment',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 6),
                            Text(
                              'Discover verified empowerment opportunities and submit your application securely.',
                              style: TextStyle(
                                color: Colors.white,
                                height: 1.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'Available Programs',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          Text(
                            '${programs.length}',
                            style: const TextStyle(
                              color: Color(0xFF08783E),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (programs.isEmpty)
                        Container(
                          padding: const EdgeInsets.all(26),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: const Column(
                            children: [
                              Icon(
                                Icons.campaign_outlined,
                                size: 42,
                                color: Colors.grey,
                              ),
                              SizedBox(height: 10),
                              Text(
                                'No empowerment programs are available yet.',
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        )
                      else
                        ...programs.map((program) {
                          final programId = _idOf(program);
                          final applied = _alreadyApplied(programId);

                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _nameOf(program),
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                if (_descriptionOf(program).isNotEmpty) ...[
                                  const SizedBox(height: 6),
                                  Text(
                                    _descriptionOf(program),
                                    style: const TextStyle(
                                      color: Color(0xFF667085),
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 14),
                                SizedBox(
                                  width: double.infinity,
                                  child: FilledButton(
                                    onPressed:
                                        applied ? null : () => _apply(program),
                                    child: Text(
                                      applied ? 'Already Applied' : 'Apply Now',
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          );
                        }),
                      const SizedBox(height: 24),
                      const Text(
                        'My Applications',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 12),
                      if (applications.isEmpty)
                        Container(
                          padding: const EdgeInsets.all(22),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: const Text(
                            'You have not submitted any empowerment application yet.',
                            textAlign: TextAlign.center,
                          ),
                        )
                      else
                        ...applications.map((application) {
                          String name = 'Empowerment Application';

                          if (application is Map) {
                            final rawProgram = application['program'];

                            if (rawProgram is Map) {
                              name = (rawProgram['name'] ??
                                      rawProgram['title'] ??
                                      name)
                                  .toString();
                            } else {
                              name = (application['programName'] ??
                                      application['name'] ??
                                      name)
                                  .toString();
                            }
                          }

                          final status = _statusOf(application);

                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: Row(
                              children: [
                                const CircleAvatar(
                                  backgroundColor: Color(0xFFEAF7F0),
                                  child: Icon(
                                    Icons.volunteer_activism_outlined,
                                    color: Color(0xFF08783E),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    name,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                                _statusChip(status),
                              ],
                            ),
                          );
                        }),
                      const SizedBox(height: 30),
                    ],
                  ),
                ),
    );
  }
}
