import 'package:flutter/material.dart';

/// Shared visual language for the customer-facing ServicePay experience.
///
/// Screens can keep their existing business logic and opt into the same
/// spacing, contrast, focus states, and touch-friendly controls by using the
/// app theme rather than defining local versions of every control.
abstract final class ServicePayColors {
  // Customer "Premium Green" system (approved Device Companion palette).
  /// Bright emerald accent (#00DB91). Pair with [onAccent] text, never white.
  static const accent = Color(0xFF00DB91);
  static const onAccent = Color(0xFF002A21);

  /// Filled green surface (#087F68) that safely carries white text.
  static const brand = Color(0xFF087F68);
  static const brandDeep = Color(0xFF06604F);

  /// Quiet tinted surface used for chips, icon wells and highlights.
  static const brandSoft = Color(0xFF0C5444);
  static const canvas = Color(0xFF003D30);
  static const surface = Color(0xFF064A3B);
  static const surfaceRaised = Color(0xFF08503F);
  static const ink = Color(0xFFFFFFFF);
  static const muted = Color(0xFFE8FFF2);
  static const border = Color(0xFF00DB91);

  /// Secondary card surface (#087F68) from the approved palette.
  static const card = Color(0xFF087F68);
  static const disabled = Color(0xFF8DB3A5);
  static const disabledSurface = Color(0xFF194E42);
  static const success = Color(0xFF5BE3A9);
  static const danger = Color(0xFFFFADA1);
  static const warning = Color(0xFFFFC56B);
  static const info = Color(0xFF9CCBFF);
}

/// Original light palette, retained verbatim for staff destinations.
abstract final class _LegacyLightColors {
  static const brand = Color(0xFF087A45);
  static const brandDeep = Color(0xFF075F38);
  static const brandSoft = Color(0xFFE8F5EC);
  static const canvas = Color(0xFFF5F9F6);
  static const ink = Color(0xFF15352A);
  static const muted = Color(0xFF4B6257);
  static const border = Color(0xFFB9CEC1);
  static const disabled = Color(0xFF718078);
  static const disabledSurface = Color(0xFFE7EDE9);
  static const danger = Color(0xFFB42318);
}

abstract final class ServicePayTheme {
  /// Original light ThemeData, unchanged, used by staff destinations.
  static ThemeData light() {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: _LegacyLightColors.brand,
      brightness: Brightness.light,
    ).copyWith(
      primary: _LegacyLightColors.brand,
      onPrimary: Colors.white,
      secondary: _LegacyLightColors.brandDeep,
      onSecondary: Colors.white,
      surface: Colors.white,
      onSurface: _LegacyLightColors.ink,
      surfaceContainerHighest: _LegacyLightColors.brandSoft,
      onSurfaceVariant: _LegacyLightColors.muted,
      error: _LegacyLightColors.danger,
      onError: Colors.white,
    );

    final OutlineInputBorder inputBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: _LegacyLightColors.border),
    );
    final OutlineInputBorder focusedBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: _LegacyLightColors.brand, width: 1.6),
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: _LegacyLightColors.canvas,
      visualDensity: VisualDensity.standard,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: const AppBarTheme(
        backgroundColor: _LegacyLightColors.brand,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 19,
          fontWeight: FontWeight.w800,
        ),
        iconTheme: IconThemeData(color: Colors.white, size: 23),
      ),
      textTheme: const TextTheme(
        headlineSmall: TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 24,
          fontWeight: FontWeight.w800,
          height: 1.15,
        ),
        titleLarge: TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
        titleMedium: TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
        bodyLarge: TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 16,
          height: 1.4,
        ),
        bodyMedium: TextStyle(
          color: _LegacyLightColors.muted,
          fontSize: 14,
          height: 1.4,
        ),
        labelLarge: TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 14,
          fontWeight: FontWeight.w700,
        ),
        labelMedium: TextStyle(
          color: _LegacyLightColors.muted,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 1,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: Color(0xFFDCE9E0)),
        ),
        shadowColor: const Color(0x160B3924),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        border: inputBorder,
        enabledBorder: inputBorder,
        focusedBorder: focusedBorder,
        errorBorder: inputBorder.copyWith(
          borderSide: const BorderSide(color: _LegacyLightColors.danger),
        ),
        focusedErrorBorder: focusedBorder.copyWith(
          borderSide:
              const BorderSide(color: _LegacyLightColors.danger, width: 1.6),
        ),
        labelStyle: const TextStyle(color: _LegacyLightColors.muted),
        floatingLabelStyle: const TextStyle(color: _LegacyLightColors.brand),
        hintStyle: const TextStyle(color: _LegacyLightColors.muted),
        prefixIconColor: _LegacyLightColors.muted,
        suffixIconColor: _LegacyLightColors.muted,
        errorStyle: const TextStyle(
          color: _LegacyLightColors.danger,
          fontWeight: FontWeight.w600,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          foregroundColor: Colors.white,
          backgroundColor: _LegacyLightColors.brand,
          disabledForegroundColor: _LegacyLightColors.disabled,
          disabledBackgroundColor: _LegacyLightColors.disabledSurface,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          foregroundColor: Colors.white,
          backgroundColor: _LegacyLightColors.brand,
          disabledForegroundColor: _LegacyLightColors.disabled,
          disabledBackgroundColor: _LegacyLightColors.disabledSurface,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          side: const BorderSide(color: _LegacyLightColors.brand),
          foregroundColor: _LegacyLightColors.brandDeep,
          disabledForegroundColor: _LegacyLightColors.disabled,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 44),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          foregroundColor: _LegacyLightColors.brandDeep,
          disabledForegroundColor: _LegacyLightColors.disabled,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: Colors.white,
        selectedColor: _LegacyLightColors.brand,
        side: const BorderSide(color: _LegacyLightColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        labelStyle: const TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
        secondaryLabelStyle: const TextStyle(color: Colors.white),
        disabledColor: _LegacyLightColors.disabledSurface,
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 8),
      ),
      dividerTheme: const DividerThemeData(
        color: _LegacyLightColors.border,
        thickness: 1,
        space: 1,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: _LegacyLightColors.brand,
        linearTrackColor: _LegacyLightColors.brandSoft,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: _LegacyLightColors.ink,
        contentTextStyle: const TextStyle(color: Colors.white),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        titleTextStyle: const TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
        contentTextStyle: TextStyle(
          color: _LegacyLightColors.ink,
          fontSize: 15,
          height: 1.45,
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: Colors.white,
        modalBackgroundColor: Colors.white,
        showDragHandle: true,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        indicatorColor: _LegacyLightColors.brandSoft,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(
            color: _LegacyLightColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
        iconTheme: const WidgetStatePropertyAll(
          IconThemeData(color: _LegacyLightColors.muted),
        ),
      ),
      iconTheme: const IconThemeData(color: _LegacyLightColors.muted),
      disabledColor: _LegacyLightColors.disabled,
    );
  }

  static ThemeData customer() {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: ServicePayColors.accent,
      brightness: Brightness.dark,
    ).copyWith(
      primary: ServicePayColors.accent,
      onPrimary: ServicePayColors.onAccent,
      primaryContainer: ServicePayColors.brand,
      onPrimaryContainer: Colors.white,
      secondary: ServicePayColors.brand,
      onSecondary: Colors.white,
      surface: ServicePayColors.surface,
      onSurface: ServicePayColors.ink,
      surfaceContainerLowest: ServicePayColors.canvas,
      surfaceContainerLow: ServicePayColors.surface,
      surfaceContainer: ServicePayColors.surface,
      surfaceContainerHigh: ServicePayColors.surfaceRaised,
      surfaceContainerHighest: ServicePayColors.brandSoft,
      onSurfaceVariant: ServicePayColors.muted,
      outline: ServicePayColors.border,
      outlineVariant: ServicePayColors.brandSoft,
      error: ServicePayColors.danger,
      onError: Color(0xFF3A0A05),
      inverseSurface: ServicePayColors.ink,
      onInverseSurface: ServicePayColors.canvas,
    );

    final OutlineInputBorder inputBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: ServicePayColors.border),
    );
    final OutlineInputBorder focusedBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: ServicePayColors.accent, width: 1.6),
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: ServicePayColors.canvas,
      visualDensity: VisualDensity.standard,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: const AppBarTheme(
        backgroundColor: ServicePayColors.canvas,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 19,
          fontWeight: FontWeight.w700,
        ),
        iconTheme: IconThemeData(color: Colors.white, size: 23),
      ),
      textTheme: const TextTheme(
        headlineSmall: TextStyle(
          color: ServicePayColors.ink,
          fontSize: 24,
          fontWeight: FontWeight.w700,
          height: 1.15,
        ),
        titleLarge: TextStyle(
          color: ServicePayColors.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
        titleMedium: TextStyle(
          color: ServicePayColors.ink,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
        bodyLarge: TextStyle(
          color: ServicePayColors.ink,
          fontSize: 16,
          height: 1.4,
        ),
        bodyMedium: TextStyle(
          color: ServicePayColors.muted,
          fontSize: 14,
          height: 1.4,
        ),
        bodySmall: TextStyle(
          color: ServicePayColors.muted,
          fontSize: 14,
          height: 1.4,
        ),
        labelLarge: TextStyle(
          color: ServicePayColors.ink,
          fontSize: 14,
          fontWeight: FontWeight.w700,
        ),
        labelMedium: TextStyle(
          color: ServicePayColors.muted,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
        labelSmall: TextStyle(
          color: ServicePayColors.muted,
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
      ),
      cardTheme: CardThemeData(
        color: ServicePayColors.card,
        surfaceTintColor: Colors.transparent,
        elevation: 1,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: ServicePayColors.border),
        ),
        shadowColor: const Color(0x40001A14),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ServicePayColors.surfaceRaised,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        border: inputBorder,
        enabledBorder: inputBorder,
        focusedBorder: focusedBorder,
        errorBorder: inputBorder.copyWith(
          borderSide: const BorderSide(color: ServicePayColors.danger),
        ),
        focusedErrorBorder: focusedBorder.copyWith(
          borderSide:
              const BorderSide(color: ServicePayColors.danger, width: 1.6),
        ),
        labelStyle: const TextStyle(color: ServicePayColors.muted),
        floatingLabelStyle: const TextStyle(color: ServicePayColors.accent),
        hintStyle: const TextStyle(color: ServicePayColors.muted),
        prefixIconColor: ServicePayColors.muted,
        suffixIconColor: ServicePayColors.muted,
        errorStyle: const TextStyle(
          color: ServicePayColors.danger,
          fontWeight: FontWeight.w600,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          foregroundColor: ServicePayColors.onAccent,
          backgroundColor: ServicePayColors.accent,
          disabledForegroundColor: ServicePayColors.disabled,
          disabledBackgroundColor: ServicePayColors.disabledSurface,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          foregroundColor: ServicePayColors.onAccent,
          backgroundColor: ServicePayColors.accent,
          disabledForegroundColor: ServicePayColors.disabled,
          disabledBackgroundColor: ServicePayColors.disabledSurface,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          side: const BorderSide(color: ServicePayColors.accent),
          foregroundColor: ServicePayColors.accent,
          disabledForegroundColor: ServicePayColors.disabled,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 44),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          foregroundColor: ServicePayColors.accent,
          disabledForegroundColor: ServicePayColors.disabled,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: ServicePayColors.surface,
        selectedColor: ServicePayColors.accent,
        checkmarkColor: ServicePayColors.onAccent,
        side: const BorderSide(color: ServicePayColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        labelStyle: const TextStyle(
          color: ServicePayColors.ink,
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
        secondaryLabelStyle: const TextStyle(color: ServicePayColors.onAccent),
        disabledColor: ServicePayColors.disabledSurface,
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 8),
      ),
      dividerTheme: const DividerThemeData(
        color: ServicePayColors.border,
        thickness: 1,
        space: 1,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: ServicePayColors.accent,
        linearTrackColor: ServicePayColors.brandSoft,
        circularTrackColor: Colors.transparent,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: ServicePayColors.ink,
        actionTextColor: ServicePayColors.brand,
        contentTextStyle: const TextStyle(
          color: ServicePayColors.canvas,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: ServicePayColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        titleTextStyle: const TextStyle(
          color: ServicePayColors.ink,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
        contentTextStyle: TextStyle(
          color: ServicePayColors.ink,
          fontSize: 15,
          height: 1.45,
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: ServicePayColors.surface,
        modalBackgroundColor: ServicePayColors.surface,
        surfaceTintColor: Colors.transparent,
        dragHandleColor: ServicePayColors.muted,
        showDragHandle: true,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: ServicePayColors.canvas,
        surfaceTintColor: Colors.transparent,
        indicatorColor: ServicePayColors.brandSoft,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(
            color: ServicePayColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
        iconTheme: const WidgetStatePropertyAll(
          IconThemeData(color: ServicePayColors.muted),
        ),
      ),
      iconTheme: const IconThemeData(color: ServicePayColors.muted),
      disabledColor: ServicePayColors.disabled,
      canvasColor: ServicePayColors.surface,
      dividerColor: ServicePayColors.border,
      listTileTheme: const ListTileThemeData(
        iconColor: ServicePayColors.accent,
        textColor: ServicePayColors.ink,
      ),
      popupMenuTheme: const PopupMenuThemeData(
        color: ServicePayColors.surfaceRaised,
        surfaceTintColor: Colors.transparent,
        textStyle: TextStyle(color: ServicePayColors.ink),
      ),
      dropdownMenuTheme: const DropdownMenuThemeData(
        menuStyle: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(ServicePayColors.surfaceRaised),
        ),
      ),
      datePickerTheme: const DatePickerThemeData(
        backgroundColor: ServicePayColors.surface,
        surfaceTintColor: Colors.transparent,
      ),
      tabBarTheme: const TabBarThemeData(
        labelColor: ServicePayColors.accent,
        unselectedLabelColor: ServicePayColors.muted,
        indicatorColor: ServicePayColors.accent,
        dividerColor: ServicePayColors.brandSoft,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? ServicePayColors.onAccent
                : ServicePayColors.muted),
        trackColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? ServicePayColors.accent
                : ServicePayColors.brandSoft),
        trackOutlineColor:
            const WidgetStatePropertyAll(ServicePayColors.border),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? ServicePayColors.accent
                : Colors.transparent),
        checkColor: const WidgetStatePropertyAll(ServicePayColors.onAccent),
        side: const BorderSide(color: ServicePayColors.muted, width: 1.6),
      ),
      radioTheme: const RadioThemeData(
        fillColor: WidgetStatePropertyAll(ServicePayColors.accent),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: ServicePayColors.accent,
        foregroundColor: ServicePayColors.onAccent,
      ),
      badgeTheme: const BadgeThemeData(
        backgroundColor: ServicePayColors.accent,
        textColor: ServicePayColors.onAccent,
      ),
    );
  }
}

/// Which presentation the app shell should use. This is purely visual and is
/// driven by the role that existing routing has already resolved.
enum ServicePayThemeAudience { customer, staff }

abstract final class ServicePayThemeSelection {
  static final ValueNotifier<ServicePayThemeAudience> audience =
      ValueNotifier<ServicePayThemeAudience>(ServicePayThemeAudience.customer);
  static int _selectionRevision = 0;

  static ServicePayThemeAudience audienceForRole(String role) {
    final String normalized =
        role.trim().toUpperCase().replaceAll(RegExp(r'[\s-]+'), '_');
    return normalized == 'CUSTOMER'
        ? ServicePayThemeAudience.customer
        : ServicePayThemeAudience.staff;
  }

  static ThemeData themeFor(ServicePayThemeAudience value) =>
      value == ServicePayThemeAudience.customer
          ? ServicePayTheme.customer()
          : ServicePayTheme.light();

  /// Schedules the change after the current frame so callers may invoke it
  /// from build/route-construction code without rebuilding during build.
  static void select(ServicePayThemeAudience value) {
    final int revision = ++_selectionRevision;
    if (audience.value == value) return;
    final WidgetsBinding binding;
    try {
      binding = WidgetsBinding.instance;
    } catch (_) {
      // No widget binding (pure Dart callers): nothing is building yet.
      audience.value = value;
      return;
    }
    binding.addPostFrameCallback((_) {
      if (revision == _selectionRevision) audience.value = value;
    });
    binding.ensureVisualUpdate();
  }

  static void selectForRole(String role) => select(audienceForRole(role));
}
