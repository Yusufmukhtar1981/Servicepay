import 'package:flutter/material.dart';

class FlightBookingScreen extends StatefulWidget {
  const FlightBookingScreen({super.key});

  @override
  State<FlightBookingScreen> createState() =>
      _FlightBookingScreenState();
}

class _FlightBookingScreenState extends State<FlightBookingScreen> {
  final formKey = GlobalKey<FormState>();

  final List<String> airports = const [
    'Abuja (ABV)',
    'Lagos (LOS)',
    'Kano (KAN)',
    'Port Harcourt (PHC)',
    'Enugu (ENU)',
    'Kaduna (KAD)',
    'Owerri (QOW)',
    'Asaba (ABB)',
    'Ilorin (ILR)',
    'Maiduguri (MIU)',
    'Yola (YOL)',
    'Sokoto (SKO)',
  ];

  final List<String> cabinClasses = const [
    'Economy',
    'Premium Economy',
    'Business',
    'First Class',
  ];

  bool isRoundTrip = false;
  bool isSearching = false;

  String? departureAirport;
  String? arrivalAirport;
  String selectedCabinClass = 'Economy';

  DateTime departureDate =
      DateTime.now().add(const Duration(days: 1));

  DateTime? returnDate;

  int adults = 1;
  int children = 0;
  int infants = 0;

  int get totalPassengers => adults + children + infants;

  String formatDate(DateTime date) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    return '${date.day} ${months[date.month - 1]} ${date.year}';
  }

  Future<void> selectDepartureDate() async {
    final selectedDate = await showDatePicker(
      context: context,
      initialDate: departureDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(
        const Duration(days: 365),
      ),
      helpText: 'Select departure date',
    );

    if (selectedDate == null) return;

    setState(() {
      departureDate = selectedDate;

      if (returnDate != null &&
          returnDate!.isBefore(departureDate)) {
        returnDate = null;
      }
    });
  }

  Future<void> selectReturnDate() async {
    final initialReturnDate =
        returnDate ??
        departureDate.add(const Duration(days: 1));

    final selectedDate = await showDatePicker(
      context: context,
      initialDate: initialReturnDate,
      firstDate: departureDate,
      lastDate: DateTime.now().add(
        const Duration(days: 365),
      ),
      helpText: 'Select return date',
    );

    if (selectedDate == null) return;

    setState(() {
      returnDate = selectedDate;
    });
  }

  void swapAirports() {
    setState(() {
      final currentDeparture = departureAirport;
      departureAirport = arrivalAirport;
      arrivalAirport = currentDeparture;
    });
  }

  void showPassengerSelector() {
    int temporaryAdults = adults;
    int temporaryChildren = children;
    int temporaryInfants = infants;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (bottomSheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  20,
                  4,
                  20,
                  MediaQuery.of(context).viewInsets.bottom + 24,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Passengers',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Choose the number of passengers.',
                      style: TextStyle(
                        color: Colors.grey.shade600,
                      ),
                    ),
                    const SizedBox(height: 20),
                    passengerCounter(
                      title: 'Adults',
                      subtitle: '12 years and above',
                      value: temporaryAdults,
                      minimum: 1,
                      onChanged: (value) {
                        setModalState(() {
                          temporaryAdults = value;
                        });
                      },
                    ),
                    const Divider(height: 28),
                    passengerCounter(
                      title: 'Children',
                      subtitle: '2 to 11 years',
                      value: temporaryChildren,
                      minimum: 0,
                      onChanged: (value) {
                        setModalState(() {
                          temporaryChildren = value;
                        });
                      },
                    ),
                    const Divider(height: 28),
                    passengerCounter(
                      title: 'Infants',
                      subtitle: 'Below 2 years',
                      value: temporaryInfants,
                      minimum: 0,
                      onChanged: (value) {
                        setModalState(() {
                          temporaryInfants = value;
                        });
                      },
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 54,
                      child: FilledButton(
                        onPressed: () {
                          setState(() {
                            adults = temporaryAdults;
                            children = temporaryChildren;
                            infants = temporaryInfants;
                          });

                          Navigator.pop(bottomSheetContext);
                        },
                        style: FilledButton.styleFrom(
                          backgroundColor:
                              const Color(0xFF2E8B3C),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: const Text(
                          'Confirm Passengers',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget passengerCounter({
    required String title,
    required String subtitle,
    required int value,
    required int minimum,
    required ValueChanged<int> onChanged,
  }) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                subtitle,
                style: TextStyle(
                  color: Colors.grey.shade600,
                ),
              ),
            ],
          ),
        ),
        counterButton(
          icon: Icons.remove,
          enabled: value > minimum,
          onPressed: () {
            if (value > minimum) {
              onChanged(value - 1);
            }
          },
        ),
        SizedBox(
          width: 45,
          child: Text(
            '$value',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        counterButton(
          icon: Icons.add,
          enabled: value < 9,
          onPressed: () {
            if (value < 9) {
              onChanged(value + 1);
            }
          },
        ),
      ],
    );
  }

  Widget counterButton({
    required IconData icon,
    required bool enabled,
    required VoidCallback onPressed,
  }) {
    return Material(
      color: enabled
          ? const Color(0xFFE8F5EA)
          : Colors.grey.shade100,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: enabled ? onPressed : null,
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 42,
          height: 42,
          child: Icon(
            icon,
            color: enabled
                ? const Color(0xFF2E8B3C)
                : Colors.grey.shade400,
          ),
        ),
      ),
    );
  }

  Future<void> searchFlights() async {
    FocusScope.of(context).unfocus();

    if (!formKey.currentState!.validate()) {
      return;
    }

    if (departureAirport == arrivalAirport) {
      showMessage(
        'Departure and destination airports cannot be the same.',
        isError: true,
      );
      return;
    }

    if (isRoundTrip && returnDate == null) {
      showMessage(
        'Please select a return date.',
        isError: true,
      );
      return;
    }

    setState(() {
      isSearching = true;
    });

    await Future<void>.delayed(
      const Duration(milliseconds: 900),
    );

    if (!mounted) return;

    setState(() {
      isSearching = false;
    });

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FlightResultsScreen(
          departureAirport: departureAirport!,
          arrivalAirport: arrivalAirport!,
          departureDate: departureDate,
          returnDate: isRoundTrip ? returnDate : null,
          cabinClass: selectedCabinClass,
          passengers: totalPassengers,
        ),
      ),
    );
  }

  void showMessage(
    String message, {
    bool isError = false,
  }) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError
            ? Colors.red.shade700
            : const Color(0xFF2E8B3C),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const primaryColor = Color(0xFF2E8B3C);

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F7),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: primaryColor,
        foregroundColor: Colors.white,
        title: const Text(
          'Flight Booking',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final contentWidth =
              constraints.maxWidth > 720 ? 680.0 : double.infinity;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(18),
            child: Align(
              alignment: Alignment.topCenter,
              child: SizedBox(
                width: contentWidth,
                child: Form(
                  key: formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      flightHeader(),
                      const SizedBox(height: 18),
                      tripTypeSelector(),
                      const SizedBox(height: 18),
                      airportSection(),
                      const SizedBox(height: 16),
                      dateSection(),
                      const SizedBox(height: 16),
                      passengerAndClassSection(),
                      const SizedBox(height: 22),
                      searchButton(),
                      const SizedBox(height: 18),
                      bookingBenefits(),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget flightHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF237A32),
            Color(0xFF48A84F),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF2E8B3C).withValues(
              alpha: 0.22,
            ),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: const Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Book your next trip',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 23,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 7),
                Text(
                  'Search and compare available flights easily.',
                  style: TextStyle(
                    color: Color(0xFFE9F7EA),
                    fontSize: 14,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: 14),
          CircleAvatar(
            radius: 35,
            backgroundColor: Color(0x33FFFFFF),
            child: Icon(
              Icons.flight_takeoff_rounded,
              color: Colors.white,
              size: 36,
            ),
          ),
        ],
      ),
    );
  }

  Widget tripTypeSelector() {
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.grey.shade200,
        ),
      ),
      child: Row(
        children: [
          expandedTripButton(
            label: 'One Way',
            selected: !isRoundTrip,
            onTap: () {
              setState(() {
                isRoundTrip = false;
              });
            },
          ),
          expandedTripButton(
            label: 'Round Trip',
            selected: isRoundTrip,
            onTap: () {
              setState(() {
                isRoundTrip = true;
              });
            },
          ),
        ],
      ),
    );
  }

  Widget expandedTripButton({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF2E8B3C)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              vertical: 13,
            ),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: selected
                    ? Colors.white
                    : Colors.grey.shade700,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget airportSection() {
    return sectionCard(
      title: 'Route',
      icon: Icons.route_rounded,
      child: Stack(
        alignment: Alignment.centerRight,
        children: [
          Column(
            children: [
              airportDropdown(
                label: 'From',
                icon: Icons.flight_takeoff_rounded,
                value: departureAirport,
                validatorMessage:
                    'Please select departure airport.',
                onChanged: (value) {
                  setState(() {
                    departureAirport = value;
                  });
                },
              ),
              const SizedBox(height: 14),
              airportDropdown(
                label: 'To',
                icon: Icons.flight_land_rounded,
                value: arrivalAirport,
                validatorMessage:
                    'Please select destination airport.',
                onChanged: (value) {
                  setState(() {
                    arrivalAirport = value;
                  });
                },
              ),
            ],
          ),
          Positioned(
            right: 14,
            child: Material(
              color: const Color(0xFF2E8B3C),
              shape: const CircleBorder(),
              elevation: 3,
              child: InkWell(
                onTap: swapAirports,
                customBorder: const CircleBorder(),
                child: const SizedBox(
                  width: 46,
                  height: 46,
                  child: Icon(
                    Icons.swap_vert_rounded,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget airportDropdown({
    required String label,
    required IconData icon,
    required String? value,
    required String validatorMessage,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      value: value,
      isExpanded: true,
      decoration: inputDecoration(
        label: label,
        icon: icon,
      ),
      items: airports.map((airport) {
        return DropdownMenuItem<String>(
          value: airport,
          child: Text(
            airport,
            overflow: TextOverflow.ellipsis,
          ),
        );
      }).toList(),
      onChanged: onChanged,
      validator: (selectedValue) {
        if (selectedValue == null ||
            selectedValue.isEmpty) {
          return validatorMessage;
        }

        return null;
      },
    );
  }

  Widget dateSection() {
    return sectionCard(
      title: 'Travel Date',
      icon: Icons.calendar_month_rounded,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: dateTile(
              label: 'Departure',
              value: formatDate(departureDate),
              icon: Icons.event_available_rounded,
              onTap: selectDepartureDate,
            ),
          ),
          if (isRoundTrip) ...[
            const SizedBox(width: 12),
            Expanded(
              child: dateTile(
                label: 'Return',
                value: returnDate == null
                    ? 'Select date'
                    : formatDate(returnDate!),
                icon: Icons.event_repeat_rounded,
                onTap: selectReturnDate,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget dateTile({
    required String label,
    required String value,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAF8),
          borderRadius: BorderRadius.circular(15),
          border: Border.all(
            color: Colors.grey.shade200,
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color: const Color(0xFF2E8B3C),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: Colors.grey.shade600,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    value,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget passengerAndClassSection() {
    return sectionCard(
      title: 'Travel Details',
      icon: Icons.person_outline_rounded,
      child: Column(
        children: [
          InkWell(
            onTap: showPassengerSelector,
            borderRadius: BorderRadius.circular(15),
            child: Container(
              padding: const EdgeInsets.all(15),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAF8),
                borderRadius: BorderRadius.circular(15),
                border: Border.all(
                  color: Colors.grey.shade200,
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.groups_2_outlined,
                    color: Color(0xFF2E8B3C),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '$totalPassengers Passenger'
                      '${totalPassengers > 1 ? 's' : ''}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const Icon(
                    Icons.keyboard_arrow_down_rounded,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: selectedCabinClass,
            isExpanded: true,
            decoration: inputDecoration(
              label: 'Cabin Class',
              icon: Icons.airline_seat_recline_extra_rounded,
            ),
            items: cabinClasses.map((cabinClass) {
              return DropdownMenuItem<String>(
                value: cabinClass,
                child: Text(cabinClass),
              );
            }).toList(),
            onChanged: (value) {
              if (value == null) return;

              setState(() {
                selectedCabinClass = value;
              });
            },
          ),
        ],
      ),
    );
  }

  Widget sectionCard({
    required String title,
    required IconData icon,
    required Widget child,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(21),
        border: Border.all(
          color: Colors.grey.shade200,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.035),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                icon,
                size: 21,
                color: const Color(0xFF2E8B3C),
              ),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 15),
          child,
        ],
      ),
    );
  }

  InputDecoration inputDecoration({
    required String label,
    required IconData icon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(
        icon,
        color: const Color(0xFF2E8B3C),
      ),
      filled: true,
      fillColor: const Color(0xFFF8FAF8),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(15),
        borderSide: const BorderSide(
          color: Color(0xFF2E8B3C),
          width: 1.6,
        ),
      ),
    );
  }

  Widget searchButton() {
    return SizedBox(
      width: double.infinity,
      height: 58,
      child: FilledButton.icon(
        onPressed: isSearching ? null : searchFlights,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFF2E8B3C),
          disabledBackgroundColor:
              const Color(0xFF2E8B3C).withValues(alpha: 0.6),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(17),
          ),
        ),
        icon: isSearching
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.4,
                  color: Colors.white,
                ),
              )
            : const Icon(Icons.search_rounded),
        label: Text(
          isSearching ? 'Searching...' : 'Search Flights',
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }

  Widget bookingBenefits() {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF8E6),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFFFE29A),
        ),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.verified_user_outlined,
            color: Color(0xFFE89B00),
          ),
          SizedBox(width: 12),
          Expanded(
            child: Text(
              'Secure booking, transparent prices and easy payment through Servicepay.',
              style: TextStyle(
                color: Color(0xFF69511B),
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class FlightResultsScreen extends StatelessWidget {
  const FlightResultsScreen({
    super.key,
    required this.departureAirport,
    required this.arrivalAirport,
    required this.departureDate,
    required this.returnDate,
    required this.cabinClass,
    required this.passengers,
  });

  final String departureAirport;
  final String arrivalAirport;
  final DateTime departureDate;
  final DateTime? returnDate;
  final String cabinClass;
  final int passengers;

  String formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F7),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2E8B3C),
        foregroundColor: Colors.white,
        title: const Text(
          'Available Flights',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Container(
            constraints: const BoxConstraints(
              maxWidth: 620,
            ),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: Colors.grey.shade200,
              ),
            ),
            child: Column(
              children: [
                const CircleAvatar(
                  radius: 38,
                  backgroundColor: Color(0xFFE8F5EA),
                  child: Icon(
                    Icons.flight_rounded,
                    size: 38,
                    color: Color(0xFF2E8B3C),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Flight Search Ready',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  '$departureAirport → $arrivalAirport',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 15),
                resultRow(
                  'Departure',
                  formatDate(departureDate),
                ),
                if (returnDate != null)
                  resultRow(
                    'Return',
                    formatDate(returnDate!),
                  ),
                resultRow(
                  'Passengers',
                  '$passengers',
                ),
                resultRow(
                  'Cabin Class',
                  cabinClass,
                ),
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.all(15),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF8E6),
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: const Text(
                    'Real airline results will appear here after we connect the flight booking API.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Color(0xFF69511B),
                      height: 1.45,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget resultRow(String title, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        vertical: 7,
      ),
      child: Row(
        children: [
          Text(
            title,
            style: TextStyle(
              color: Colors.grey.shade600,
            ),
          ),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}