import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class KekeDriverScreen extends StatefulWidget {
  const KekeDriverScreen({super.key});

  @override
  State<KekeDriverScreen> createState() =>
      _KekeDriverScreenState();
}

class _KekeDriverScreenState
    extends State<KekeDriverScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF08783E);

  bool isLoading = true;
  bool isUpdatingStatus = false;
  bool isUpdatingLocation = false;
  bool isRideActionLoading = false;

  String availabilityStatus = 'OFFLINE';
  String verificationStatus = '';
  String vehicleType = '';
  String plateNumber = '';

  Map<String, dynamic>? currentRide;

  Timer? locationTimer;
  Timer? ridePollingTimer;

  final TextEditingController otpController =
      TextEditingController();

  @override
  void initState() {
    super.initState();

    _initializeDriver();
  }

  @override
  void dispose() {
    locationTimer?.cancel();
    ridePollingTimer?.cancel();

    otpController.dispose();

    super.dispose();
  }

  Future<void> _initializeDriver() async {
    await _loadDriverStatus();
    await _loadCurrentRide();

    _startRidePolling();

    if (availabilityStatus == 'ONLINE' ||
        availabilityStatus == 'BUSY') {
      _startLocationUpdates();
    }

    if (mounted) {
      setState(() {
        isLoading = false;
      });
    }
  }

  Future<String?> _getAuthToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    const List<String> tokenKeys = <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? value =
          prefs.getString(key);

      if (value == null ||
          value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token
          .toLowerCase()
          .startsWith('bearer ')) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return null;
  }

  Future<void> _loadDriverStatus() async {
    try {
      final String? token =
          await _getAuthToken();

      if (token == null) {
        return;
      }

      final http.Response response =
          await http
              .get(
        Uri.parse(
          '$baseUrl/riders/status',
        ),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Accept':
              'application/json',
        },
      )
              .timeout(
        const Duration(
          seconds: 20,
        ),
      );

      final dynamic decoded =
          jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map<String, dynamic> &&
          decoded['rider'] is Map) {
        final Map<String, dynamic> rider =
            Map<String, dynamic>.from(
          decoded['rider'] as Map,
        );

        if (mounted) {
          setState(() {
            availabilityStatus =
                rider['availabilityStatus']
                        ?.toString() ??
                    'OFFLINE';

            verificationStatus =
                rider['verificationStatus']
                        ?.toString() ??
                    '';

            vehicleType =
                rider['vehicleType']
                        ?.toString() ??
                    '';

            plateNumber =
                rider['plateNumber']
                        ?.toString() ??
                    '';
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _loadCurrentRide() async {
    try {
      final String? token =
          await _getAuthToken();

      if (token == null) {
        return;
      }

      final http.Response response =
          await http
              .get(
        Uri.parse(
          '$baseUrl/keke-rides/driver/current',
        ),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Accept':
              'application/json',
        },
      )
              .timeout(
        const Duration(
          seconds: 20,
        ),
      );

      final dynamic decoded =
          jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map<String, dynamic>) {
        final dynamic ride =
            decoded['ride'];

        if (mounted) {
          setState(() {
            if (ride is Map) {
              currentRide =
                  Map<String, dynamic>.from(
                ride,
              );
            } else {
              currentRide = null;
            }
          });
        }
      }
    } catch (_) {}
  }

  void _startRidePolling() {
    ridePollingTimer?.cancel();

    ridePollingTimer =
        Timer.periodic(
      const Duration(
        seconds: 5,
      ),
      (_) async {
        await _loadCurrentRide();
      },
    );
  }

  void _startLocationUpdates() {
    locationTimer?.cancel();

    locationTimer =
        Timer.periodic(
      const Duration(
        seconds: 5,
      ),
      (_) async {
        await _sendCurrentLocation();
      },
    );

    _sendCurrentLocation();
  }

  void _stopLocationUpdates() {
    locationTimer?.cancel();
    locationTimer = null;
  }

  Future<void> _sendCurrentLocation() async {
    if (isUpdatingLocation) {
      return;
    }

    try {
      isUpdatingLocation = true;

      final bool enabled =
          await Geolocator
              .isLocationServiceEnabled();

      if (!enabled) {
        return;
      }

      LocationPermission permission =
          await Geolocator
              .checkPermission();

      if (permission ==
          LocationPermission.denied) {
        permission =
            await Geolocator
                .requestPermission();
      }

      if (permission ==
              LocationPermission.denied ||
          permission ==
              LocationPermission
                  .deniedForever) {
        return;
      }

      final Position position =
          await Geolocator
              .getCurrentPosition(
        locationSettings:
            const LocationSettings(
          accuracy:
              LocationAccuracy.high,
        ),
      );

      final String? token =
          await _getAuthToken();

      if (token == null) {
        return;
      }

      await http
          .post(
        Uri.parse(
          '$baseUrl/riders/location',
        ),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
        },
        body: jsonEncode(
          <String, dynamic>{
            'latitude':
                position.latitude,
            'longitude':
                position.longitude,
            'accuracy':
                position.accuracy,
            'heading':
                position.heading,
            'speed':
                position.speed,
          },
        ),
      )
          .timeout(
        const Duration(
          seconds: 20,
        ),
      );
    } catch (_) {
      // Keep silent during background location refresh.
    } finally {
      isUpdatingLocation = false;
    }
  }

  Future<void> _setAvailability(
    String status,
  ) async {
    if (isUpdatingStatus) {
      return;
    }

    try {
      setState(() {
        isUpdatingStatus = true;
      });

      final String? token =
          await _getAuthToken();

      if (token == null) {
        _showMessage(
          'Please login again.',
        );

        return;
      }

      final http.Response response =
          await http
              .post(
        Uri.parse(
          '$baseUrl/riders/availability',
        ),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
        },
        body: jsonEncode(
          <String, dynamic>{
            'status': status,
          },
        ),
      )
              .timeout(
        const Duration(
          seconds: 20,
        ),
      );

      final dynamic decoded =
          jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        if (mounted) {
          setState(() {
            availabilityStatus =
                status;
          });
        }

        if (status == 'ONLINE') {
          _startLocationUpdates();
        } else {
          _stopLocationUpdates();
        }

        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  'Status updated.'
              : 'Status updated.',
        );
      } else {
        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  'Unable to update status.'
              : 'Unable to update status.',
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to update driver status.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isUpdatingStatus = false;
        });
      }
    }
  }

  Future<void> _acceptRide() async {
    final String? rideId =
        _rideId();

    if (rideId == null) {
      return;
    }

    await _postRideAction(
      '$baseUrl/keke-rides/$rideId/accept',
      successMessage:
          'Ride accepted.',
    );
  }

  Future<void> _markArrived() async {
    final String? rideId =
        _rideId();

    if (rideId == null) {
      return;
    }

    await _postRideAction(
      '$baseUrl/keke-rides/$rideId/arrived',
      successMessage:
          'Arrival confirmed.',
    );
  }

  Future<void> _startRide() async {
    final String? rideId =
        _rideId();

    if (rideId == null) {
      return;
    }

    final String otp =
        otpController.text.trim();

    if (!RegExp(r'^\d{4}$')
        .hasMatch(otp)) {
      _showMessage(
        'Enter the 4-digit Ride OTP.',
      );

      return;
    }

    await _postRideAction(
      '$baseUrl/keke-rides/$rideId/start',
      body: <String, dynamic>{
        'otp': otp,
      },
      successMessage:
          'Ride started.',
    );

    otpController.clear();
  }

  Future<void> _completeRide() async {
    final String? rideId =
        _rideId();

    if (rideId == null) {
      return;
    }

    await _postRideAction(
      '$baseUrl/keke-rides/$rideId/complete',
      successMessage:
          'Ride completed successfully.',
    );
  }

  Future<void> _postRideAction(
    String url, {
    Map<String, dynamic>? body,
    required String successMessage,
  }) async {
    if (isRideActionLoading) {
      return;
    }

    try {
      setState(() {
        isRideActionLoading =
            true;
      });

      final String? token =
          await _getAuthToken();

      if (token == null) {
        _showMessage(
          'Please login again.',
        );

        return;
      }

      final http.Response response =
          await http
              .post(
        Uri.parse(url),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
        },
        body: jsonEncode(
          body ??
              <String, dynamic>{},
        ),
      )
              .timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded =
          jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  successMessage
              : successMessage,
        );

        await _loadDriverStatus();
        await _loadCurrentRide();
      } else {
        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  'Unable to complete action.'
              : 'Unable to complete action.',
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to complete ride action.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isRideActionLoading =
              false;
        });
      }
    }
  }

  String? _rideId() {
    final Map<String, dynamic>?
        ride =
        currentRide;

    if (ride == null) {
      return null;
    }

    return ride['_id']
            ?.toString() ??
        ride['id']
            ?.toString();
  }

  void _showMessage(
    String message,
  ) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
        .showSnackBar(
      SnackBar(
        content:
            Text(message),
      ),
    );
  }

  String _statusLabel(
    String status,
  ) {
    switch (status) {
      case 'DRIVER_ASSIGNED':
        return 'New Ride Request';

      case 'DRIVER_COMING':
        return 'Going to Pickup';

      case 'DRIVER_ARRIVED':
        return 'At Pickup';

      case 'RIDE_STARTED':
        return 'Ride in Progress';

      case 'RIDE_COMPLETED':
        return 'Ride Completed';

      default:
        return status;
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF7F9FB,
      ),
      appBar: AppBar(
        title:
            const Text(
          'ServicePay Keke Driver',
        ),
        backgroundColor:
            primaryGreen,
        foregroundColor:
            Colors.white,
      ),
      body:
          isLoading
              ? const Center(
                  child:
                      CircularProgressIndicator(),
                )
              : RefreshIndicator(
                  color:
                      primaryGreen,
                  onRefresh:
                      () async {
                    await _loadDriverStatus();
                    await _loadCurrentRide();
                  },
                  child:
                      ListView(
                    physics:
                        const AlwaysScrollableScrollPhysics(),
                    padding:
                        const EdgeInsets.all(
                      16,
                    ),
                    children:
                        <Widget>[
                      _buildDriverStatusCard(),
                      const SizedBox(
                        height:
                            16,
                      ),
                      if (currentRide ==
                          null)
                        _buildWaitingCard()
                      else
                        _buildRideCard(),
                    ],
                  ),
                ),
    );
  }

  Widget _buildDriverStatusCard() {
    final bool isOnline =
        availabilityStatus ==
            'ONLINE';

    final bool isBusy =
        availabilityStatus ==
            'BUSY';

    return Container(
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
          22,
        ),
        border:
            Border.all(
          color:
              const Color(
            0xFFE4E7EC,
          ),
        ),
      ),
      child:
          Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children:
            <Widget>[
          Row(
            children:
                <Widget>[
              Container(
                width:
                    52,
                height:
                    52,
                decoration:
                    BoxDecoration(
                  color:
                      isOnline ||
                              isBusy
                          ? const Color(
                              0xFFEAF7F0,
                            )
                          : const Color(
                              0xFFF2F4F7,
                            ),
                  shape:
                      BoxShape.circle,
                ),
                child:
                    Icon(
                  Icons
                      .electric_rickshaw_rounded,
                  color:
                      isOnline ||
                              isBusy
                          ? primaryGreen
                          : Colors.grey,
                  size:
                      29,
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
                      CrossAxisAlignment.start,
                  children:
                      <Widget>[
                    Text(
                      availabilityStatus,
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
                      verificationStatus.isEmpty
                          ? 'Driver account'
                          : 'Verification: $verificationStatus',
                      style:
                          const TextStyle(
                        color:
                            Color(
                          0xFF667085,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(
            height:
                14,
          ),
          if (vehicleType
              .isNotEmpty)
            Text(
              'Vehicle: $vehicleType',
            ),
          if (plateNumber
              .isNotEmpty)
            Text(
              'Plate: $plateNumber',
            ),
          const SizedBox(
            height:
                16,
          ),
          SizedBox(
            width:
                double.infinity,
            height:
                50,
            child:
                FilledButton.icon(
              onPressed:
                  isUpdatingStatus ||
                          isBusy
                      ? null
                      : () {
                          _setAvailability(
                            isOnline
                                ? 'OFFLINE'
                                : 'ONLINE',
                          );
                        },
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    isOnline
                        ? Colors.red
                        : primaryGreen,
              ),
              icon:
                  isUpdatingStatus
                      ? const SizedBox(
                          width:
                              18,
                          height:
                              18,
                          child:
                              CircularProgressIndicator(
                            strokeWidth:
                                2,
                            color:
                                Colors.white,
                          ),
                        )
                      : Icon(
                          isOnline
                              ? Icons.power_settings_new
                              : Icons.play_circle_fill_rounded,
                        ),
              label:
                  Text(
                isBusy
                    ? 'BUSY ON RIDE'
                    : isOnline
                        ? 'GO OFFLINE'
                        : 'GO ONLINE',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWaitingCard() {
    return Container(
      padding:
          const EdgeInsets.all(
        28,
      ),
      decoration:
          BoxDecoration(
        color:
            Colors.white,
        borderRadius:
            BorderRadius.circular(
          22,
        ),
        border:
            Border.all(
          color:
              const Color(
            0xFFE4E7EC,
          ),
        ),
      ),
      child:
          Column(
        children:
            <Widget>[
          const Icon(
            Icons
                .radar_rounded,
            size:
                58,
            color:
                primaryGreen,
          ),
          const SizedBox(
            height:
                14,
          ),
          const Text(
            'Waiting for Ride',
            style:
                TextStyle(
              fontSize:
                  20,
              fontWeight:
                  FontWeight.w900,
            ),
          ),
          const SizedBox(
            height:
                8,
          ),
          Text(
            availabilityStatus ==
                    'ONLINE'
                ? 'ServicePay is searching for nearby customers who need a Keke.'
                : 'Go online to receive nearby Keke ride requests.',
            textAlign:
                TextAlign.center,
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
        ],
      ),
    );
  }

  Widget _buildRideCard() {
    final Map<String, dynamic> ride =
        currentRide!;

    final String status =
        ride['status']
                ?.toString() ??
            '';

    final String pickupAddress =
        _readAddress(
      ride['pickup'],
    );

    final String destinationAddress =
        _readAddress(
      ride['destination'],
    );

    final String customerName =
        ride['customerName']
                ?.toString() ??
            'Customer';

    final String customerPhone =
        ride['customerPhone']
                ?.toString() ??
            '';

    final String fare =
        ride['totalFare']
                ?.toString() ??
            '-';

    return Container(
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
          22,
        ),
        border:
            Border.all(
          color:
              const Color(
            0xFFE4E7EC,
          ),
        ),
      ),
      child:
          Column(
        crossAxisAlignment:
            CrossAxisAlignment.stretch,
        children:
            <Widget>[
          Text(
            _statusLabel(status),
            style:
                const TextStyle(
              fontSize:
                  21,
              color:
                  primaryGreen,
              fontWeight:
                  FontWeight.w900,
            ),
          ),
          const SizedBox(
            height:
                16,
          ),
          _RideInfoRow(
            icon:
                Icons.person_rounded,
            label:
                'Customer',
            value:
                customerName,
          ),
          if (customerPhone
              .isNotEmpty)
            _RideInfoRow(
              icon:
                  Icons.phone_rounded,
              label:
                  'Phone',
              value:
                  customerPhone,
            ),
          _RideInfoRow(
            icon:
                Icons.trip_origin_rounded,
            label:
                'Pickup',
            value:
                pickupAddress,
          ),
          _RideInfoRow(
            icon:
                Icons.location_on_rounded,
            label:
                'Destination',
            value:
                destinationAddress,
          ),
          _RideInfoRow(
            icon:
                Icons.payments_rounded,
            label:
                'Fare',
            value:
                '₦$fare',
          ),
          const SizedBox(
            height:
                18,
          ),
          if (status ==
              'DRIVER_ASSIGNED')
            _actionButton(
              label:
                  'Accept Ride',
              icon:
                  Icons.check_circle_rounded,
              onPressed:
                  _acceptRide,
            ),
          if (status ==
              'DRIVER_COMING')
            _actionButton(
              label:
                  'I Have Arrived',
              icon:
                  Icons.location_on_rounded,
              onPressed:
                  _markArrived,
            ),
          if (status ==
              'DRIVER_ARRIVED') ...<Widget>[
            TextField(
              controller:
                  otpController,
              keyboardType:
                  TextInputType.number,
              maxLength:
                  4,
              obscureText:
                  true,
              decoration:
                  const InputDecoration(
                labelText:
                    'Ride OTP',
                hintText:
                    'Enter customer OTP',
                prefixIcon:
                    Icon(
                  Icons.lock_rounded,
                ),
                border:
                    OutlineInputBorder(),
                counterText:
                    '',
              ),
            ),
            const SizedBox(
              height:
                  12,
            ),
            _actionButton(
              label:
                  'Start Ride',
              icon:
                  Icons.play_arrow_rounded,
              onPressed:
                  _startRide,
            ),
          ],
          if (status ==
              'RIDE_STARTED')
            _actionButton(
              label:
                  'Complete Ride',
              icon:
                  Icons.flag_rounded,
              onPressed:
                  _completeRide,
            ),
          if (isRideActionLoading)
            const Padding(
              padding:
                  EdgeInsets.only(
                top:
                    14,
              ),
              child:
                  Center(
                child:
                    CircularProgressIndicator(),
              ),
            ),
        ],
      ),
    );
  }

  String _readAddress(
    dynamic value,
  ) {
    if (value is Map) {
      return value['address']
              ?.toString() ??
          '-';
    }

    return '-';
  }

  Widget _actionButton({
    required String label,
    required IconData icon,
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      height:
          52,
      child:
          FilledButton.icon(
        onPressed:
            isRideActionLoading
                ? null
                : onPressed,
        style:
            FilledButton.styleFrom(
          backgroundColor:
              primaryGreen,
        ),
        icon:
            Icon(icon),
        label:
            Text(
          label,
          style:
              const TextStyle(
            fontWeight:
                FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

class _RideInfoRow
    extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _RideInfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Padding(
      padding:
          const EdgeInsets.symmetric(
        vertical:
            8,
      ),
      child:
          Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children:
            <Widget>[
          Icon(
            icon,
            size:
                20,
            color:
                _KekeDriverScreenState
                    .primaryGreen,
          ),
          const SizedBox(
            width:
                10,
          ),
          SizedBox(
            width:
                92,
            child:
                Text(
              label,
              style:
                  const TextStyle(
                color:
                    Color(
                  0xFF667085,
                ),
              ),
            ),
          ),
          Expanded(
            child:
                Text(
              value,
              textAlign:
                  TextAlign.right,
              style:
                  const TextStyle(
                fontWeight:
                    FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}