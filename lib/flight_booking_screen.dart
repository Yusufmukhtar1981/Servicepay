import 'package:flutter/material.dart';

class FlightBookingScreen extends StatefulWidget {
  const FlightBookingScreen({super.key});

  @override
  State<FlightBookingScreen> createState() =>
      _FlightBookingScreenState();
}

class _FlightBookingScreenState
    extends State<FlightBookingScreen> {
  final fromController = TextEditingController();
  final toController = TextEditingController();

  bool isRoundTrip = false;
  DateTime? departureDate;
  DateTime? returnDate;

  int passengers = 1;
  String cabinClass = 'Economy';

  final List<String> cabinClasses = [
    'Economy',
    'Premium Economy',
    'Business',
    'First Class',
  ];

  @override
  void dispose() {
    fromController.dispose();
    toController.dispose();
    super.dispose();
  }

  Future<void> selectDepartureDate() async {
    final selectedDate = await showDatePicker(
      context: context,
      initialDate:
          departureDate ??
          DateTime.now().add(
            const Duration(days: 1),
          ),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(
        const Duration(days: 730),
      ),
    );

    if (selectedDate == null || !mounted) return;

    setState(() {
      departureDate = selectedDate;

      if (returnDate != null &&
          returnDate!.isBefore(selectedDate)) {
        returnDate = null;
      }
    });
  }

  Future<void> selectReturnDate() async {
    final minimumDate =
        departureDate ??
        DateTime.now().add(
          const Duration(days: 1),
        );

    final selectedDate = await showDatePicker(
      context: context,
      initialDate:
          returnDate ??
          minimumDate.add(
            const Duration(days: 1),
          ),
      firstDate: minimumDate,
      lastDate: DateTime.now().add(
        const Duration(days: 730),
      ),
    );

    if (selectedDate == null || !mounted) return;

    setState(() {
      returnDate = selectedDate;
    });
  }

  String formatDate(DateTime? date) {
    if (date == null) {
      return 'Select date';
    }

    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');

    return '$day/$month/${date.year}';
  }

  void swapLocations() {
    final currentFrom = fromController.text;
    fromController.text = toController.text;
    toController.text = currentFrom;
  }

  void increasePassengers() {
    if (passengers >= 9) return;

    setState(() {
      passengers++;
    });
  }

  void decreasePassengers() {
    if (passengers <= 1) return;

    setState(() {
      passengers--;
    });
  }

  void searchFlights() {
    final from = fromController.text.trim();
    final to = toController.text.trim();

    if (from.isEmpty || to.isEmpty) {
      showMessage(
        'Please enter your departure and destination.',
        isError: true,
      );
      return;
    }

    if (from.toLowerCase() == to.toLowerCase()) {
      showMessage(
        'Departure and destination cannot be the same.',
        isError: true,
      );
      return;
    }

    if (departureDate == null) {
      showMessage(
        'Please select your departure date.',
        isError: true,
      );
      return;
    }

    if (isRoundTrip && returnDate == null) {
      showMessage(
        'Please select your return date.',
        isError: true,
      );
      return;
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return FlightSearchSummary(
          tripType:
              isRoundTrip ? 'Round Trip' : 'One Way',
          from: from,
          to: to,
          departureDate: formatDate(
            departureDate,
          ),
          returnDate:
              isRoundTrip
                  ? formatDate(returnDate)
                  : null,
          passengers: passengers,
          cabinClass: cabinClass,
        );
      },
    );
  }

  void showMessage(
    String message, {
    required bool isError,
  }) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor:
            isError ? Colors.red : Colors.green,
      ),
    );
  }

  Widget buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 10,
      ),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget buildLocationField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
  }) {
    return TextFormField(
      controller: controller,
      textCapitalization: TextCapitalization.words,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(
          icon,
          color: Colors.green,
        ),
        filled: true,
        fillColor: const Color(0xFFF7F9FB),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFE5E7EB),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Colors.green,
            width: 1.5,
          ),
        ),
      ),
    );
  }

  Widget buildDateCard({
    required String label,
    required String date,
    required VoidCallback onTap,
    required IconData icon,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        decoration: BoxDecoration(
          color: const Color(0xFFF7F9FB),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: const Color(0xFFE5E7EB),
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color: Colors.green,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: Colors.grey,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    date,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.keyboard_arrow_down,
              color: Colors.grey,
            ),
          ],
        ),
      ),
    );
  }

  Widget buildPassengerSelector() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F9FB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.people_outline,
            color: Colors.green,
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              'Passengers',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          IconButton(
            onPressed: decreasePassengers,
            icon: const Icon(
              Icons.remove_circle_outline,
            ),
          ),
          Container(
            width: 38,
            alignment: Alignment.center,
            child: Text(
              passengers.toString(),
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          IconButton(
            onPressed: increasePassengers,
            icon: const Icon(
              Icons.add_circle_outline,
              color: Colors.green,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildCabinClassSelector() {
    return DropdownButtonFormField<String>(
      initialValue: cabinClass,
      decoration: InputDecoration(
        labelText: 'Cabin Class',
        prefixIcon: const Icon(
          Icons.airline_seat_recline_extra,
          color: Colors.green,
        ),
        filled: true,
        fillColor: const Color(0xFFF7F9FB),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFE5E7EB),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Colors.green,
            width: 1.5,
          ),
        ),
      ),
      items:
          cabinClasses.map((value) {
            return DropdownMenuItem(
              value: value,
              child: Text(value),
            );
          }).toList(),
      onChanged: (value) {
        if (value == null) return;

        setState(() {
          cabinClass = value;
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Flight Booking',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Colors.green,
                    Color(0xFF0B8F44),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Book your next flight',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 23,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        SizedBox(height: 8),
                        Text(
                          'Search local and international flights through Servicepay.',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 14,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(width: 12),
                  Icon(
                    Icons.flight_takeoff,
                    color: Colors.white,
                    size: 58,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),

            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  buildSectionTitle('Trip Type'),

                  Row(
                    children: [
                      Expanded(
                        child: ChoiceChip(
                          label: const SizedBox(
                            width: double.infinity,
                            child: Text(
                              'One Way',
                              textAlign: TextAlign.center,
                            ),
                          ),
                          selected: !isRoundTrip,
                          selectedColor:
                              Colors.green.withValues(
                                alpha: 0.15,
                              ),
                          labelStyle: TextStyle(
                            color:
                                !isRoundTrip
                                    ? Colors.green
                                    : Colors.black87,
                            fontWeight: FontWeight.w600,
                          ),
                          onSelected: (_) {
                            setState(() {
                              isRoundTrip = false;
                              returnDate = null;
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ChoiceChip(
                          label: const SizedBox(
                            width: double.infinity,
                            child: Text(
                              'Round Trip',
                              textAlign: TextAlign.center,
                            ),
                          ),
                          selected: isRoundTrip,
                          selectedColor:
                              Colors.green.withValues(
                                alpha: 0.15,
                              ),
                          labelStyle: TextStyle(
                            color:
                                isRoundTrip
                                    ? Colors.green
                                    : Colors.black87,
                            fontWeight: FontWeight.w600,
                          ),
                          onSelected: (_) {
                            setState(() {
                              isRoundTrip = true;
                            });
                          },
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 22),
                  buildSectionTitle('Route'),

                  buildLocationField(
                    controller: fromController,
                    label: 'From',
                    hint: 'City or airport',
                    icon: Icons.flight_takeoff,
                  ),

                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: 8,
                    ),
                    child: Align(
                      alignment: Alignment.center,
                      child: IconButton.filled(
                        onPressed: swapLocations,
                        style: IconButton.styleFrom(
                          backgroundColor:
                              Colors.green.withValues(
                                alpha: 0.12,
                              ),
                          foregroundColor: Colors.green,
                        ),
                        icon: const Icon(
                          Icons.swap_vert,
                        ),
                      ),
                    ),
                  ),

                  buildLocationField(
                    controller: toController,
                    label: 'To',
                    hint: 'City or airport',
                    icon: Icons.flight_land,
                  ),

                  const SizedBox(height: 22),
                  buildSectionTitle('Travel Date'),

                  buildDateCard(
                    label: 'Departure Date',
                    date: formatDate(departureDate),
                    onTap: selectDepartureDate,
                    icon: Icons.calendar_month_outlined,
                  ),

                  if (isRoundTrip) ...[
                    const SizedBox(height: 12),
                    buildDateCard(
                      label: 'Return Date',
                      date: formatDate(returnDate),
                      onTap: selectReturnDate,
                      icon:
                          Icons.event_repeat_outlined,
                    ),
                  ],

                  const SizedBox(height: 22),
                  buildSectionTitle('Travellers'),

                  buildPassengerSelector(),

                  const SizedBox(height: 14),

                  buildCabinClassSelector(),

                  const SizedBox(height: 24),

                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton.icon(
                      onPressed: searchFlights,
                      icon: const Icon(
                        Icons.search,
                      ),
                      label: const Text(
                        'Search Flights',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(14),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 18),

            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.orange.withValues(
                  alpha: 0.1,
                ),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Row(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline,
                    color: Colors.orange,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Live flight search, payment and ticket issuance will be connected in the next stage.',
                      style: TextStyle(
                        color: Colors.black87,
                        height: 1.4,
                      ),
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
}

class FlightSearchSummary extends StatelessWidget {
  final String tripType;
  final String from;
  final String to;
  final String departureDate;
  final String? returnDate;
  final int passengers;
  final String cabinClass;

  const FlightSearchSummary({
    super.key,
    required this.tripType,
    required this.from,
    required this.to,
    required this.departureDate,
    required this.returnDate,
    required this.passengers,
    required this.cabinClass,
  });

  Widget buildSummaryRow({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 16,
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: Colors.green,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.grey,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          22,
          14,
          22,
          26,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(24),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 45,
              height: 5,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius:
                    BorderRadius.circular(10),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Flight Search Summary',
              style: TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 22),

            buildSummaryRow(
              icon: Icons.flight,
              label: 'Route',
              value: '$from → $to',
            ),
            buildSummaryRow(
              icon: Icons.route_outlined,
              label: 'Trip Type',
              value: tripType,
            ),
            buildSummaryRow(
              icon:
                  Icons.calendar_month_outlined,
              label: 'Departure',
              value: departureDate,
            ),

            if (returnDate != null)
              buildSummaryRow(
                icon: Icons.event_repeat_outlined,
                label: 'Return',
                value: returnDate!,
              ),

            buildSummaryRow(
              icon: Icons.people_outline,
              label: 'Passengers',
              value: passengers.toString(),
            ),
            buildSummaryRow(
              icon:
                  Icons.airline_seat_recline_extra,
              label: 'Cabin Class',
              value: cabinClass,
            ),

            const SizedBox(height: 4),

            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                  ),
                ),
                child: const Text(
                  'Done',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}