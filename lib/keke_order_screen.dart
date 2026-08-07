import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

class KekeOrderScreen extends StatefulWidget {
  const KekeOrderScreen({super.key});

  @override
  State<KekeOrderScreen> createState() => _KekeOrderScreenState();
}

class _KekeOrderScreenState extends State<KekeOrderScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF0F766E);

  final MapController _mapController =
      MapController();

  final TextEditingController
      _pickupAddressController =
      TextEditingController();

  final TextEditingController
      _destinationAddressController =
      TextEditingController();

  bool _isLoadingLocation = true;
  bool _isRequestingRide = false;
  bool _isTrackingRide = false;

  String _statusMessage =
      'Getting your current location...';

  LatLng? _pickupLocation;
  LatLng? _destinationLocation;
  LatLng? _driverLocation;

  Map<String, dynamic>? _activeRide;

  Timer? _ridePollingTimer;

  @override
  void initState() {
    super.initState();

    _initializeScreen();
  }

  @override
  void dispose() {
    _ridePollingTimer?.cancel();

    _pickupAddressController.dispose();
    _destinationAddressController.dispose();

    super.dispose();
  }

  Future<void> _initializeScreen() async {
    await _loadCurrentLocation();

    await _loadActiveRide();
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

      if (value != null &&
          value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Future<void> _loadCurrentLocation() async {
    try {
      setState(() {
        _isLoadingLocation = true;
        _statusMessage =
            'Getting your current location...';
      });

      final bool enabled =
          await Geolocator
              .isLocationServiceEnabled();

      if (!enabled) {
        setState(() {
          _isLoadingLocation = false;
          _statusMessage =
              'Please turn on location service.';
        });

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
        setState(() {
          _isLoadingLocation = false;
          _statusMessage =
              'Location permission is required to order Keke.';
        });

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

      final LatLng current =
          LatLng(
        position.latitude,
        position.longitude,
      );

      setState(() {
        _pickupLocation = current;

        _isLoadingLocation = false;

        _statusMessage =
            'Current location ready.';
      });

      WidgetsBinding.instance
          .addPostFrameCallback((_) {
        try {
          _mapController.move(
            current,
            16,
          );
        } catch (_) {}
      });
    } catch (error) {
      setState(() {
        _isLoadingLocation = false;
        _statusMessage =
            'Unable to get current location.';
      });
    }
  }

  Future<void> _loadActiveRide() async {
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
          '$baseUrl/keke-rides/active',
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
          seconds: 30,
        ),
      );

      final dynamic decoded =
          jsonDecode(
        response.body,
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map<String, dynamic>) {
        final dynamic ride =
            decoded['ride'];

        if (ride is Map) {
          final Map<String, dynamic>
              normalizedRide =
              Map<String, dynamic>.from(
            ride,
          );

          setState(() {
            _activeRide =
                normalizedRide;

            _isTrackingRide = true;
          });

          _extractRideLocations(
            normalizedRide,
          );

          _startRidePolling();
        }
      }
    } catch (_) {}
  }

  void _extractRideLocations(
    Map<String, dynamic> ride,
  ) {
    try {
      final dynamic pickup =
          ride['pickup'];

      if (pickup is Map) {
        final dynamic location =
            pickup['location'];

        if (location is Map) {
          final dynamic coordinates =
              location['coordinates'];

          if (coordinates is List &&
              coordinates.length >= 2) {
            _pickupLocation =
                LatLng(
              (coordinates[1] as num)
                  .toDouble(),
              (coordinates[0] as num)
                  .toDouble(),
            );
          }
        }
      }

      final dynamic destination =
          ride['destination'];

      if (destination is Map) {
        final dynamic location =
            destination['location'];

        if (location is Map) {
          final dynamic coordinates =
              location['coordinates'];

          if (coordinates is List &&
              coordinates.length >= 2) {
            _destinationLocation =
                LatLng(
              (coordinates[1] as num)
                  .toDouble(),
              (coordinates[0] as num)
                  .toDouble(),
            );
          }
        }
      }

      setState(() {});
    } catch (_) {}
  }

  void _startRidePolling() {
    _ridePollingTimer?.cancel();

    _ridePollingTimer =
        Timer.periodic(
      const Duration(
        seconds: 5,
      ),
      (_) {
        _refreshRideAndDriver();
      },
    );
  }

  Future<void>
      _refreshRideAndDriver() async {
    final Map<String, dynamic>?
        ride =
        _activeRide;

    if (ride == null) {
      return;
    }

    final String? rideId =
        ride['_id']?.toString() ??
        ride['id']?.toString();

    if (rideId == null ||
        rideId.isEmpty) {
      return;
    }

    await _loadRideDetails(
      rideId,
    );

    await _loadDriverLocation(
      rideId,
    );
  }

  Future<void> _loadRideDetails(
    String rideId,
  ) async {
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
          '$baseUrl/keke-rides/$rideId',
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
          jsonDecode(
        response.body,
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map<String, dynamic> &&
          decoded['ride'] is Map) {
        final Map<String, dynamic>
            updatedRide =
            Map<String, dynamic>.from(
          decoded['ride'] as Map,
        );

        final String status =
            updatedRide['status']
                    ?.toString() ??
                '';

        if (mounted) {
          setState(() {
            _activeRide =
                updatedRide;
          });
        }

        if (<String>[
          'RIDE_COMPLETED',
          'CANCELLED',
          'NO_DRIVER_FOUND',
        ].contains(status)) {
          _ridePollingTimer
              ?.cancel();

          if (mounted) {
            setState(() {
              _isTrackingRide =
                  false;
            });
          }
        }
      }
    } catch (_) {}
  }

  Future<void> _loadDriverLocation(
    String rideId,
  ) async {
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
          '$baseUrl/keke-rides/$rideId/driver-location',
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
          jsonDecode(
        response.body,
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map<String, dynamic>) {
        final dynamic location =
            decoded['location'];

        if (location is Map) {
          final double? latitude =
              _toDouble(
            location['latitude'],
          );

          final double? longitude =
              _toDouble(
            location['longitude'],
          );

          if (latitude != null &&
              longitude != null) {
            if (mounted) {
              setState(() {
                _driverLocation =
                    LatLng(
                  latitude,
                  longitude,
                );
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  double? _toDouble(
    dynamic value,
  ) {
    if (value == null) {
      return null;
    }

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
      value.toString(),
    );
  }

  Future<void> _selectDestination(
    LatLng point,
  ) async {
    setState(() {
      _destinationLocation =
          point;

      if (_destinationAddressController
          .text
          .trim()
          .isEmpty) {
        _destinationAddressController
                .text =
            'Selected destination';
      }

      _statusMessage =
          'Destination selected.';
    });
  }

  Future<void> _useCurrentLocation()
      async {
    await _loadCurrentLocation();
  }

  Future<void> _requestKeke() async {
    if (_isRequestingRide) {
      return;
    }

    final LatLng? pickup =
        _pickupLocation;

    final LatLng? destination =
        _destinationLocation;

    if (pickup == null) {
      _showMessage(
        'Please allow ServicePay to access your current location.',
      );

      return;
    }

    if (destination == null) {
      _showMessage(
        'Tap the map to select your destination.',
      );

      return;
    }

    final String pickupAddress =
        _pickupAddressController.text
                .trim()
                .isEmpty
            ? 'Current Location'
            : _pickupAddressController
                .text
                .trim();

    final String destinationAddress =
        _destinationAddressController
            .text
            .trim();

    if (destinationAddress.isEmpty) {
      _showMessage(
        'Please enter destination name or address.',
      );

      return;
    }

    try {
      setState(() {
        _isRequestingRide = true;
        _statusMessage =
            'Searching for nearest Keke driver...';
      });

      final String? token =
          await _getAuthToken();

      if (token == null) {
        _showMessage(
          'Please login again.',
        );

        setState(() {
          _isRequestingRide =
              false;
        });

        return;
      }

      final http.Response response =
          await http
              .post(
        Uri.parse(
          '$baseUrl/keke-rides',
        ),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
          'Accept':
              'application/json',
        },
        body: jsonEncode(
          <String, dynamic>{
            'pickupAddress':
                pickupAddress,
            'pickupLatitude':
                pickup.latitude,
            'pickupLongitude':
                pickup.longitude,
            'destinationAddress':
                destinationAddress,
            'destinationLatitude':
                destination.latitude,
            'destinationLongitude':
                destination.longitude,
            'paymentMethod':
                'WALLET',
          },
        ),
      )
              .timeout(
        const Duration(
          seconds: 45,
        ),
      );

      final dynamic decoded =
          jsonDecode(
        response.body,
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map<String, dynamic>) {
        final dynamic ride =
            decoded['ride'];

        if (ride is Map) {
          final Map<String, dynamic>
              normalizedRide =
              Map<String, dynamic>.from(
            ride,
          );

          setState(() {
            _activeRide =
                normalizedRide;

            _isTrackingRide =
                normalizedRide[
                        'status'] !=
                    'NO_DRIVER_FOUND';

            _statusMessage =
                decoded['message']
                        ?.toString() ??
                    'Keke request created.';
          });

          _startRidePolling();

          _showMessage(
            decoded['message']
                    ?.toString() ??
                'Keke request created.',
          );
        }
      } else {
        final String message =
            decoded is Map
                ? decoded['message']
                        ?.toString() ??
                    'Unable to request Keke.'
                : 'Unable to request Keke.';

        _showMessage(
          message,
        );

        setState(() {
          _statusMessage =
              message;
        });
      }
    } catch (error) {
      _showMessage(
        'Unable to request Keke. Please try again.',
      );

      setState(() {
        _statusMessage =
            'Unable to request Keke.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isRequestingRide =
              false;
        });
      }
    }
  }

  Future<void> _cancelRide() async {
    final Map<String, dynamic>?
        ride =
        _activeRide;

    if (ride == null) {
      return;
    }

    final String? rideId =
        ride['_id']?.toString() ??
        ride['id']?.toString();

    if (rideId == null) {
      return;
    }

    try {
      final String? token =
          await _getAuthToken();

      if (token == null) {
        return;
      }

      final http.Response response =
          await http
              .post(
        Uri.parse(
          '$baseUrl/keke-rides/$rideId/cancel',
        ),
        headers: <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
        },
        body: jsonEncode(
          <String, dynamic>{
            'reason':
                'Cancelled by customer',
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

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        _ridePollingTimer
            ?.cancel();

        setState(() {
          _activeRide = null;
          _driverLocation =
              null;
          _isTrackingRide =
              false;
          _statusMessage =
              'Ride cancelled.';
        });

        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  'Ride cancelled.'
              : 'Ride cancelled.',
        );
      } else {
        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  'Unable to cancel ride.'
              : 'Unable to cancel ride.',
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to cancel ride.',
      );
    }
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

  List<Marker> _buildMarkers() {
    final List<Marker> markers =
        <Marker>[];

    if (_pickupLocation != null) {
      markers.add(
        Marker(
          point:
              _pickupLocation!,
          width: 52,
          height: 52,
          child:
              const _MapPin(
            icon:
                Icons.person_pin_circle,
            color:
                primaryGreen,
          ),
        ),
      );
    }

    if (_destinationLocation !=
        null) {
      markers.add(
        Marker(
          point:
              _destinationLocation!,
          width: 52,
          height: 52,
          child:
              const _MapPin(
            icon:
                Icons.location_on,
            color:
                Colors.red,
          ),
        ),
      );
    }

    if (_driverLocation != null) {
      markers.add(
        Marker(
          point:
              _driverLocation!,
          width: 56,
          height: 56,
          child:
              const _MapPin(
            icon:
                Icons.electric_rickshaw,
            color:
                Colors.orange,
          ),
        ),
      );
    }

    return markers;
  }

  String _rideStatusLabel(
    String status,
  ) {
    switch (status) {
      case 'SEARCHING_DRIVER':
        return 'Searching for driver';

      case 'DRIVER_ASSIGNED':
        return 'Driver found';

      case 'DRIVER_COMING':
        return 'Driver is coming';

      case 'DRIVER_ARRIVED':
        return 'Driver has arrived';

      case 'RIDE_STARTED':
        return 'Ride in progress';

      case 'RIDE_COMPLETED':
        return 'Ride completed';

      case 'CANCELLED':
        return 'Ride cancelled';

      case 'NO_DRIVER_FOUND':
        return 'No nearby driver';

      default:
        return status;
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final LatLng initialCenter =
        _pickupLocation ??
            const LatLng(
              9.0820,
              8.6753,
            );

    return Scaffold(
      appBar: AppBar(
        title:
            const Text(
          'ServicePay Keke',
        ),
        backgroundColor:
            primaryGreen,
        foregroundColor:
            Colors.white,
      ),
      body: Column(
        children: <Widget>[
          Expanded(
            flex: 6,
            child: Stack(
              children: <Widget>[
                FlutterMap(
                  mapController:
                      _mapController,
                  options:
                      MapOptions(
                    initialCenter:
                        initialCenter,
                    initialZoom:
                        15,
                    onTap:
                        (
                      TapPosition _,
                      LatLng point,
                    ) {
                      if (_activeRide ==
                          null) {
                        _selectDestination(
                          point,
                        );
                      }
                    },
                  ),
                  children: <Widget>[
                    TileLayer(
                      urlTemplate:
                          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName:
                          'ng.servicepay.app',
                    ),
                    MarkerLayer(
                      markers:
                          _buildMarkers(),
                    ),
                  ],
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child:
                      FloatingActionButton.small(
                    heroTag:
                        'current_location',
                    backgroundColor:
                        Colors.white,
                    foregroundColor:
                        primaryGreen,
                    onPressed:
                        _useCurrentLocation,
                    child:
                        const Icon(
                      Icons.my_location,
                    ),
                  ),
                ),
                if (_isLoadingLocation)
                  const Positioned.fill(
                    child:
                        ColoredBox(
                      color:
                          Color(
                        0x55FFFFFF,
                      ),
                      child:
                          Center(
                        child:
                            CircularProgressIndicator(),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            flex: 5,
            child:
                _activeRide == null
                    ? _buildOrderPanel()
                    : _buildActiveRidePanel(),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderPanel() {
    return SingleChildScrollView(
      padding:
          const EdgeInsets.all(
        16,
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment
                .stretch,
        children: <Widget>[
          Text(
            _statusMessage,
            style:
                const TextStyle(
              fontWeight:
                  FontWeight.w600,
            ),
          ),
          const SizedBox(
            height: 14,
          ),
          TextField(
            controller:
                _pickupAddressController,
            decoration:
                const InputDecoration(
              labelText:
                  'Pickup',
              hintText:
                  'Current Location',
              prefixIcon:
                  Icon(
                Icons.trip_origin,
              ),
              border:
                  OutlineInputBorder(),
            ),
          ),
          const SizedBox(
            height: 12,
          ),
          TextField(
            controller:
                _destinationAddressController,
            decoration:
                const InputDecoration(
              labelText:
                  'Destination',
              hintText:
                  'Enter destination then tap map',
              prefixIcon:
                  Icon(
                Icons.location_on,
              ),
              border:
                  OutlineInputBorder(),
            ),
          ),
          const SizedBox(
            height: 10,
          ),
          Text(
            _destinationLocation ==
                    null
                ? 'Tap your destination on the map.'
                : 'Destination selected on map.',
            style:
                TextStyle(
              color:
                  _destinationLocation ==
                          null
                      ? Colors.grey
                      : primaryGreen,
            ),
          ),
          const SizedBox(
            height: 18,
          ),
          SizedBox(
            height: 52,
            child:
                ElevatedButton.icon(
              onPressed:
                  _isRequestingRide
                      ? null
                      : _requestKeke,
              style:
                  ElevatedButton
                      .styleFrom(
                backgroundColor:
                    primaryGreen,
                foregroundColor:
                    Colors.white,
              ),
              icon:
                  _isRequestingRide
                      ? const SizedBox(
                          width: 20,
                          height: 20,
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
                              .electric_rickshaw,
                        ),
              label:
                  Text(
                _isRequestingRide
                    ? 'Searching...'
                    : 'Request Keke',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActiveRidePanel() {
    final Map<String, dynamic> ride =
        _activeRide!;

    final String status =
        ride['status']
                ?.toString() ??
            '';

    final dynamic driver =
        ride['driverId'] ??
            ride['driver'];

    String driverName =
        'Waiting for driver';

    String plateNumber =
        '';

    String phone =
        '';

    if (driver is Map) {
      driverName =
          driver['fullName']
                  ?.toString() ??
              driverName;

      plateNumber =
          driver['plateNumber']
                  ?.toString() ??
              '';

      phone =
          driver['phone']
                  ?.toString() ??
              '';
    } else {
      final dynamic snapshot =
          ride['driverSnapshot'];

      if (snapshot is Map) {
        driverName =
            snapshot['fullName']
                    ?.toString() ??
                driverName;

        plateNumber =
            snapshot['plateNumber']
                    ?.toString() ??
                '';

        phone =
            snapshot['phone']
                    ?.toString() ??
                '';
      }
    }

    final dynamic totalFareValue =
        ride['totalFare'];

    final String totalFare =
        totalFareValue == null
            ? '-'
            : totalFareValue
                .toString();

    return SingleChildScrollView(
      padding:
          const EdgeInsets.all(
        16,
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment
                .stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(
                Icons
                    .electric_rickshaw,
                color:
                    primaryGreen,
                size: 30,
              ),
              const SizedBox(
                width: 10,
              ),
              Expanded(
                child:
                    Column(
                  crossAxisAlignment:
                      CrossAxisAlignment
                          .start,
                  children: <Widget>[
                    Text(
                      _rideStatusLabel(
                        status,
                      ),
                      style:
                          const TextStyle(
                        fontWeight:
                            FontWeight.bold,
                        fontSize:
                            18,
                      ),
                    ),
                    const SizedBox(
                      height: 2,
                    ),
                    Text(
                      ride['rideReference']
                              ?.toString() ??
                          ride['reference']
                              ?.toString() ??
                          '',
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 16,
          ),
          Card(
            child: Padding(
              padding:
                  const EdgeInsets.all(
                14,
              ),
              child: Column(
                children: <Widget>[
                  _InfoRow(
                    icon:
                        Icons.person,
                    label:
                        'Driver',
                    value:
                        driverName,
                  ),
                  if (plateNumber
                      .isNotEmpty)
                    _InfoRow(
                      icon:
                          Icons
                              .confirmation_number,
                      label:
                          'Plate',
                      value:
                          plateNumber,
                    ),
                  if (phone
                      .isNotEmpty)
                    _InfoRow(
                      icon:
                          Icons.phone,
                      label:
                          'Phone',
                      value:
                          phone,
                    ),
                  _InfoRow(
                    icon:
                        Icons
                            .payments_outlined,
                    label:
                        'Estimated Fare',
                    value:
                        '₦$totalFare',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(
            height: 10,
          ),
          if (_driverLocation !=
              null)
            const Text(
              'Driver location is updating live on the map.',
              style:
                  TextStyle(
                color:
                    primaryGreen,
                fontWeight:
                    FontWeight.w600,
              ),
            ),
          if (status ==
              'DRIVER_ARRIVED')
            const Padding(
              padding:
                  EdgeInsets.only(
                top: 12,
              ),
              child:
                  Text(
                'Your driver has arrived. Give the Ride OTP to the driver before the journey starts.',
                style:
                    TextStyle(
                  fontWeight:
                      FontWeight.w600,
                ),
              ),
            ),
          const SizedBox(
            height: 16,
          ),
          if (!<String>[
            'RIDE_STARTED',
            'RIDE_COMPLETED',
            'CANCELLED',
          ].contains(status))
            OutlinedButton.icon(
              onPressed:
                  _cancelRide,
              icon:
                  const Icon(
                Icons.close,
              ),
              label:
                  const Text(
                'Cancel Ride',
              ),
            ),
          if (status ==
                  'RIDE_COMPLETED' ||
              status ==
                  'CANCELLED' ||
              status ==
                  'NO_DRIVER_FOUND')
            ElevatedButton(
              onPressed: () {
                _ridePollingTimer
                    ?.cancel();

                setState(() {
                  _activeRide =
                      null;
                  _driverLocation =
                      null;
                  _isTrackingRide =
                      false;
                });
              },
              style:
                  ElevatedButton
                      .styleFrom(
                backgroundColor:
                    primaryGreen,
                foregroundColor:
                    Colors.white,
              ),
              child:
                  const Text(
                'Order Another Keke',
              ),
            ),
        ],
      ),
    );
  }
}

class _MapPin extends StatelessWidget {
  final IconData icon;
  final Color color;

  const _MapPin({
    required this.icon,
    required this.color,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      decoration:
          BoxDecoration(
        color:
            Colors.white,
        shape:
            BoxShape.circle,
        boxShadow:
            const <BoxShadow>[
          BoxShadow(
            blurRadius: 8,
            color:
                Colors.black26,
          ),
        ],
      ),
      child:
          Icon(
        icon,
        color:
            color,
        size:
            34,
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
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
        vertical: 7,
      ),
      child: Row(
        children: <Widget>[
          Icon(
            icon,
            size: 20,
            color:
                _KekeOrderScreenState
                    .primaryGreen,
          ),
          const SizedBox(
            width: 10,
          ),
          SizedBox(
            width: 110,
            child:
                Text(
              label,
              style:
                  const TextStyle(
                color:
                    Colors.grey,
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
                    FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}