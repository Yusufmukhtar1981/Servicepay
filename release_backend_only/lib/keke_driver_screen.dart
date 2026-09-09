import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class KekeDriverScreen extends StatefulWidget {
  const KekeDriverScreen({
    super.key,
  });

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

  /*
   * =====================================================
   * NORMAL STATE
   * =====================================================
   */

  bool isLoading = true;
  bool isUpdatingStatus = false;
  bool isUpdatingLocation = false;
  bool isRideActionLoading = false;

  String availabilityStatus =
      'OFFLINE';

  String verificationStatus = '';
  String vehicleType = '';
  String plateNumber = '';

  Map<String, dynamic>? currentRide;

  Timer? locationTimer;
  Timer? ridePollingTimer;

  final TextEditingController otpController =
      TextEditingController();

  /*
   * =====================================================
   * INCOMING RIDE ALERT
   * =====================================================
   */

  final AudioPlayer _alertPlayer =
      AudioPlayer();

  Timer? _alertTimer;
  Timer? _offerCountdownTimer;

  bool _alertIsRunning = false;
  bool _audioPrimed = false;

  String? _alertRideId;

  int _offerSecondsRemaining = 0;

  Uint8List? _cachedAlertTone;

  @override
  void initState() {
    super.initState();

    _initializeDriver();
  }

  @override
  void dispose() {
    locationTimer?.cancel();
    ridePollingTimer?.cancel();

    _stopIncomingRideAlert();

    _offerCountdownTimer?.cancel();

    otpController.dispose();

    _alertPlayer.dispose();

    super.dispose();
  }

  /*
   * =====================================================
   * INITIALIZE
   * =====================================================
   */

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

  /*
   * =====================================================
   * AUTH TOKEN
   * =====================================================
   */

  Future<String?> _getAuthToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    const List<String> tokenKeys =
        <String>[
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

      String token =
          value.trim();

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
   * CREATE ALERT TONE
   * =====================================================
   *
   * Generates a small WAV sound in memory.
   * No MP3/audio asset is needed.
   */

  Uint8List _buildAlertTone() {
    if (_cachedAlertTone != null) {
      return _cachedAlertTone!;
    }

    const int sampleRate = 22050;

    /*
     * Two short tones:
     *
     * beep - pause - beep
     */
    const double firstToneSeconds = 0.28;
    const double pauseSeconds = 0.12;
    const double secondToneSeconds = 0.36;

    final int firstSamples =
        (sampleRate *
                firstToneSeconds)
            .round();

    final int pauseSamples =
        (sampleRate *
                pauseSeconds)
            .round();

    final int secondSamples =
        (sampleRate *
                secondToneSeconds)
            .round();

    final int totalSamples =
        firstSamples +
        pauseSamples +
        secondSamples;

    final int dataLength =
        totalSamples * 2;

    final ByteData wav =
        ByteData(
      44 + dataLength,
    );

    void writeString(
      int offset,
      String value,
    ) {
      for (int i = 0;
          i < value.length;
          i++) {
        wav.setUint8(
          offset + i,
          value.codeUnitAt(i),
        );
      }
    }

    writeString(
      0,
      'RIFF',
    );

    wav.setUint32(
      4,
      36 + dataLength,
      Endian.little,
    );

    writeString(
      8,
      'WAVE',
    );

    writeString(
      12,
      'fmt ',
    );

    wav.setUint32(
      16,
      16,
      Endian.little,
    );

    wav.setUint16(
      20,
      1,
      Endian.little,
    );

    wav.setUint16(
      22,
      1,
      Endian.little,
    );

    wav.setUint32(
      24,
      sampleRate,
      Endian.little,
    );

    wav.setUint32(
      28,
      sampleRate * 2,
      Endian.little,
    );

    wav.setUint16(
      32,
      2,
      Endian.little,
    );

    wav.setUint16(
      34,
      16,
      Endian.little,
    );

    writeString(
      36,
      'data',
    );

    wav.setUint32(
      40,
      dataLength,
      Endian.little,
    );

    int sampleIndex = 0;

    int writeOffset = 44;

    for (int i = 0;
        i < totalSamples;
        i++) {
      double sample = 0;

      if (i < firstSamples) {
        final double t =
            sampleIndex /
                sampleRate;

        sample =
            math.sin(
                  2 *
                      math.pi *
                      880 *
                      t,
                ) *
                0.55;

        sampleIndex++;
      } else if (i <
          firstSamples +
              pauseSamples) {
        sample = 0;
        sampleIndex = 0;
      } else {
        final double t =
            sampleIndex /
                sampleRate;

        /*
         * Slightly lower second tone.
         */
        sample =
            math.sin(
                  2 *
                      math.pi *
                      720 *
                      t,
                ) *
                0.60;

        sampleIndex++;
      }

      final int pcm =
          (sample * 32767)
              .round()
              .clamp(
                -32768,
                32767,
              );

      wav.setInt16(
        writeOffset,
        pcm,
        Endian.little,
      );

      writeOffset += 2;
    }

    _cachedAlertTone =
        wav.buffer.asUint8List();

    return _cachedAlertTone!;
  }

  /*
   * =====================================================
   * PRIME AUDIO
   * =====================================================
   *
   * Chrome may block audio that starts without
   * a user gesture.
   *
   * GO ONLINE is a user gesture, so we use it
   * to unlock audio playback.
   */

  Future<void> _primeAlertAudio() async {
    if (_audioPrimed) {
      return;
    }

    try {
      await _alertPlayer.play(
        BytesSource(
          _buildAlertTone(),
        ),
        volume: 0.01,
      );

      await Future<void>.delayed(
        const Duration(
          milliseconds: 100,
        ),
      );

      await _alertPlayer.stop();

      _audioPrimed = true;
    } catch (_) {
      /*
       * We will try again when a ride arrives.
       */
    }
  }

  /*
   * =====================================================
   * PLAY ALERT ONCE
   * =====================================================
   */

  Future<void> _playIncomingRideAlertOnce() async {
    try {
      await _alertPlayer.stop();

      await _alertPlayer.play(
        BytesSource(
          _buildAlertTone(),
        ),
        volume: 1.0,
      );

      /*
       * Vibration / haptic alert.
       * On unsupported platforms this is harmless.
       */
      await HapticFeedback.vibrate();
    } catch (_) {}
  }

  /*
   * =====================================================
   * START INCOMING RIDE ALERT
   * =====================================================
   */

  void _startIncomingRideAlert(
    Map<String, dynamic> ride,
  ) {
    final String rideId =
        ride['_id']?.toString() ??
            ride['id']?.toString() ??
            '';

    if (rideId.isEmpty) {
      return;
    }

    /*
     * Don't restart the same alert every
     * time polling runs.
     */
    if (_alertIsRunning &&
        _alertRideId == rideId) {
      return;
    }

    _stopIncomingRideAlert();

    _alertRideId = rideId;

    _alertIsRunning = true;

    _playIncomingRideAlertOnce();

    /*
     * Repeat sound every 3 seconds.
     */
    _alertTimer =
        Timer.periodic(
      const Duration(
        seconds: 3,
      ),
      (_) {
        if (!_alertIsRunning) {
          return;
        }

        _playIncomingRideAlertOnce();
      },
    );

    _startOfferCountdown(
      ride,
    );
  }

  /*
   * =====================================================
   * STOP INCOMING RIDE ALERT
   * =====================================================
   */

  void _stopIncomingRideAlert() {
    _alertTimer?.cancel();

    _alertTimer = null;

    _offerCountdownTimer
        ?.cancel();

    _offerCountdownTimer =
        null;

    _alertIsRunning = false;

    _alertRideId = null;

    _offerSecondsRemaining = 0;

    try {
      _alertPlayer.stop();
    } catch (_) {}
  }

  /*
   * =====================================================
   * OFFER COUNTDOWN
   * =====================================================
   */

  void _startOfferCountdown(
    Map<String, dynamic> ride,
  ) {
    _offerCountdownTimer
        ?.cancel();

    final String expiryText =
        ride['currentOfferExpiresAt']
                ?.toString() ??
            '';

    final DateTime? expiry =
        DateTime.tryParse(
      expiryText,
    );

    if (expiry == null) {
      /*
       * Fallback to 60 seconds.
       */
      _offerSecondsRemaining =
          60;
    } else {
      _offerSecondsRemaining =
          expiry
              .difference(
                DateTime.now().toUtc(),
              )
              .inSeconds;

      if (_offerSecondsRemaining <
          0) {
        _offerSecondsRemaining =
            0;
      }
    }

    if (mounted) {
      setState(() {});
    }

    _offerCountdownTimer =
        Timer.periodic(
      const Duration(
        seconds: 1,
      ),
      (
        Timer timer,
      ) {
        if (_offerSecondsRemaining <=
            1) {
          timer.cancel();

          if (mounted) {
            setState(() {
              _offerSecondsRemaining =
                  0;
            });
          }

          _stopIncomingRideAlert();

          return;
        }

        if (mounted) {
          setState(() {
            _offerSecondsRemaining--;
          });
        }
      },
    );
  }

  /*
   * =====================================================
   * DRIVER STATUS
   * =====================================================
   */

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
        headers:
            <String, String>{
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
          decoded
              is Map<String, dynamic> &&
          decoded['rider'] is Map) {
        final Map<String, dynamic>
            rider =
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

  /*
   * =====================================================
   * LOAD CURRENT RIDE
   * =====================================================
   */

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
        headers:
            <String, String>{
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

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          decoded
              is! Map<String, dynamic>) {
        return;
      }

      final dynamic ride =
          decoded['ride'];

      Map<String, dynamic>? nextRide;

      if (ride is Map) {
        nextRide =
            Map<String, dynamic>.from(
          ride,
        );
      }

      final String nextStatus =
          nextRide?['status']
                  ?.toString() ??
              '';

      /*
       * Ring only while ride is waiting
       * for driver acceptance.
       */
      if (nextRide != null &&
          nextStatus ==
              'DRIVER_ASSIGNED') {
        _startIncomingRideAlert(
          nextRide,
        );
      } else {
        _stopIncomingRideAlert();
      }

      if (mounted) {
        setState(() {
          currentRide =
              nextRide;
        });
      }
    } catch (_) {}
  }

  /*
   * =====================================================
   * POLLING
   * =====================================================
   */

  void _startRidePolling() {
    ridePollingTimer?.cancel();

    /*
     * Poll slightly faster for incoming rides.
     */
    ridePollingTimer =
        Timer.periodic(
      const Duration(
        seconds: 3,
      ),
      (_) async {
        await _loadCurrentRide();
      },
    );
  }

  /*
   * =====================================================
   * LIVE LOCATION
   * =====================================================
   */

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
        headers:
            <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
        },
        body:
            jsonEncode(
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
      // Silent location refresh.
    } finally {
      isUpdatingLocation = false;
    }
  }

  /*
   * =====================================================
   * ONLINE / OFFLINE
   * =====================================================
   */

  Future<void> _setAvailability(
    String status,
  ) async {
    if (isUpdatingStatus) {
      return;
    }

    try {
      if (mounted) {
        setState(() {
          isUpdatingStatus =
              true;
        });
      }

      /*
       * User interaction unlocks audio
       * for Chrome/browser.
       */
      if (status == 'ONLINE') {
        await _primeAlertAudio();
      }

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
        headers:
            <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
        },
        body:
            jsonEncode(
          <String, dynamic>{
            'status':
                status,
          },
        ),
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

          _stopIncomingRideAlert();
        }

        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  'Status updated.'
              : 'Status updated.',
        );

        return;
      }

      _showMessage(
        decoded is Map
            ? decoded['message']
                    ?.toString() ??
                'Unable to update status.'
            : 'Unable to update status.',
      );
    } catch (_) {
      _showMessage(
        'Unable to update driver status.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isUpdatingStatus =
              false;
        });
      }
    }
  }
  /*
   * =====================================================
   * ACCEPT RIDE
   * =====================================================
   */

  Future<void> _acceptRide() async {
    final String? rideId =
        _rideId();

    if (rideId == null) {
      return;
    }

    /*
     * Stop alert immediately when rider taps Accept.
     */
    _stopIncomingRideAlert();

    await _postRideAction(
      '$baseUrl/keke-rides/$rideId/accept',
      successMessage:
          'Ride accepted.',
    );
  }

  /*
   * =====================================================
   * MARK ARRIVED
   * =====================================================
   */

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

  /*
   * =====================================================
   * START RIDE
   * =====================================================
   */

  Future<void> _startRide() async {
    final String? rideId =
        _rideId();

    if (rideId == null) {
      return;
    }

    final String otp =
        otpController.text.trim();

    if (!RegExp(
      r'^\d{4}$',
    ).hasMatch(
      otp,
    )) {
      _showMessage(
        'Enter the 4-digit Ride OTP.',
      );

      return;
    }

    await _postRideAction(
      '$baseUrl/keke-rides/$rideId/start',
      body:
          <String, dynamic>{
        'otp':
            otp,
      },
      successMessage:
          'Ride started.',
    );

    otpController.clear();
  }

  /*
   * =====================================================
   * COMPLETE RIDE
   * =====================================================
   */

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

  /*
   * =====================================================
   * GENERIC RIDE ACTION
   * =====================================================
   */

  Future<void> _postRideAction(
    String url, {
    Map<String, dynamic>? body,
    required String successMessage,
  }) async {
    if (isRideActionLoading) {
      return;
    }

    try {
      if (mounted) {
        setState(() {
          isRideActionLoading =
              true;
        });
      }

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
          url,
        ),
        headers:
            <String, String>{
          'Authorization':
              'Bearer $token',
          'Content-Type':
              'application/json',
          'Accept':
              'application/json',
        },
        body:
            jsonEncode(
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
          jsonDecode(
        response.body,
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        /*
         * Any successful ride action should
         * stop incoming alert.
         */
        _stopIncomingRideAlert();

        _showMessage(
          decoded is Map
              ? decoded['message']
                      ?.toString() ??
                  successMessage
              : successMessage,
        );

        await _loadDriverStatus();

        await _loadCurrentRide();

        return;
      }

      _showMessage(
        decoded is Map
            ? decoded['message']
                    ?.toString() ??
                'Unable to complete action.'
            : 'Unable to complete action.',
      );

      /*
       * If accept failed because offer expired,
       * stop ringing.
       */
      if (decoded is Map) {
        final String message =
            decoded['message']
                    ?.toString()
                    .toLowerCase() ??
                '';

        if (message.contains(
          'expired',
        )) {
          _stopIncomingRideAlert();

          await _loadCurrentRide();
        }
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

  /*
   * =====================================================
   * RIDE ID
   * =====================================================
   */

  String? _rideId() {
    final Map<String, dynamic>? ride =
        currentRide;

    if (ride == null) {
      return null;
    }

    final String id =
        ride['_id']?.toString() ??
            ride['id']?.toString() ??
            '';

    if (id.trim().isEmpty) {
      return null;
    }

    return id.trim();
  }

  /*
   * =====================================================
   * MESSAGE
   * =====================================================
   */

  void _showMessage(
    String message,
  ) {
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
              SnackBarBehavior
                  .floating,
        ),
      );
  }

  /*
   * =====================================================
   * STATUS LABEL
   * =====================================================
   */

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
      appBar:
          AppBar(
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

  /*
   * =====================================================
   * DRIVER STATUS CARD
   * =====================================================
   */

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

          if (vehicleType.isNotEmpty)
            Text(
              'Vehicle: $vehicleType',
            ),

          if (plateNumber.isNotEmpty)
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
                  FilledButton
                      .styleFrom(
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
                              ? Icons
                                  .power_settings_new
                              : Icons
                                  .play_circle_fill_rounded,
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

  /*
   * =====================================================
   * WAITING CARD
   * =====================================================
   */

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
            Icons.radar_rounded,
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

          if (availabilityStatus ==
              'ONLINE') ...<Widget>[
            const SizedBox(
              height:
                  14,
            ),
            Container(
              padding:
                  const EdgeInsets.symmetric(
                horizontal:
                    12,
                vertical:
                    9,
              ),
              decoration:
                  BoxDecoration(
                color:
                    const Color(
                  0xFFEAF7F0,
                ),
                borderRadius:
                    BorderRadius.circular(
                  14,
                ),
              ),
              child:
                  const Row(
                mainAxisSize:
                    MainAxisSize.min,
                children:
                    <Widget>[
                  Icon(
                    Icons.volume_up_rounded,
                    size:
                        19,
                    color:
                        primaryGreen,
                  ),
                  SizedBox(
                    width:
                        7,
                  ),
                  Text(
                    'Ride alert sound is ready',
                    style:
                        TextStyle(
                      color:
                          primaryGreen,
                      fontWeight:
                          FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /*
   * =====================================================
   * RIDE CARD
   * =====================================================
   */

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

    final bool incomingRide =
        status ==
            'DRIVER_ASSIGNED';

    return AnimatedContainer(
      duration:
          const Duration(
        milliseconds:
            250,
      ),
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
              incomingRide
                  ? Colors.orange
                  : const Color(
                      0xFFE4E7EC,
                    ),
          width:
              incomingRide
                  ? 2
                  : 1,
        ),
        boxShadow:
            incomingRide
                ? const <BoxShadow>[
                    BoxShadow(
                      color:
                          Color(
                        0x33F59E0B,
                      ),
                      blurRadius:
                          18,
                      offset:
                          Offset(
                        0,
                        8,
                      ),
                    ),
                  ]
                : const <BoxShadow>[],
      ),
      child:
          Column(
        crossAxisAlignment:
            CrossAxisAlignment
                .stretch,
        children:
            <Widget>[
          if (incomingRide)
            Container(
              margin:
                  const EdgeInsets.only(
                bottom:
                    14,
              ),
              padding:
                  const EdgeInsets.symmetric(
                horizontal:
                    12,
                vertical:
                    10,
              ),
              decoration:
                  BoxDecoration(
                color:
                    const Color(
                  0xFFFFF7DF,
                ),
                borderRadius:
                    BorderRadius.circular(
                  14,
                ),
              ),
              child:
                  Row(
                children:
                    <Widget>[
                  const Icon(
                    Icons
                        .notifications_active_rounded,
                    color:
                        Colors.orange,
                  ),

                  const SizedBox(
                    width:
                        9,
                  ),

                  Expanded(
                    child:
                        Text(
                      _offerSecondsRemaining >
                              0
                          ? 'New Ride — $_offerSecondsRemaining seconds remaining'
                          : 'New Ride Request',
                      style:
                          const TextStyle(
                        color:
                            Color(
                          0xFF92400E,
                        ),
                        fontWeight:
                            FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
            ),

          Text(
            _statusLabel(
              status,
            ),
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
                  _offerSecondsRemaining >
                          0
                      ? 'Accept Ride ($_offerSecondsRemaining)'
                      : 'Accept Ride',
              icon:
                  Icons
                      .check_circle_rounded,
              onPressed:
                  _acceptRide,
            ),

          if (status ==
              'DRIVER_COMING')
            _actionButton(
              label:
                  'I Have Arrived',
              icon:
                  Icons
                      .location_on_rounded,
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
                  Icons
                      .play_arrow_rounded,
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

  /*
   * =====================================================
   * ADDRESS
   * =====================================================
   */

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

  /*
   * =====================================================
   * ACTION BUTTON
   * =====================================================
   */

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
            FilledButton
                .styleFrom(
          backgroundColor:
              primaryGreen,
        ),
        icon:
            Icon(
          icon,
        ),
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

/*
 * =====================================================
 * INFO ROW
 * =====================================================
 */

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