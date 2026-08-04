// lib/theme/app_theme.dart
//
// CrediSync Flutter Theme
//
// Implements the design tokens from design-system/tokens.ts as a Dart/Flutter
// ThemeData. All colour constants mirror the HEX values defined in the shared
// design-token source of truth.
//
// Usage:
//   MaterialApp(
//     theme: AppTheme.dark,
//     ...
//   )

import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// Primitive colour constants
// ---------------------------------------------------------------------------
abstract class _Primitives {
  // Navy / brand blues
  static const navy950 = Color(0xFF040D1A);
  static const navy900 = Color(0xFF071428);
  static const navy800 = Color(0xFF0D2247);
  static const navy700 = Color(0xFF0F3460);
  static const navy600 = Color(0xFF1A4F8A);
  static const navy500 = Color(0xFF2563EB);
  static const navy400 = Color(0xFF3B82F6);
  static const navy300 = Color(0xFF93C5FD);
  static const navy200 = Color(0xFFBFDBFE);
  static const navy100 = Color(0xFFDBEAFE);
  static const navy050 = Color(0xFFEFF6FF);

  // Neutrals / slate
  static const slate900 = Color(0xFF0F172A);
  static const slate800 = Color(0xFF1E293B);
  static const slate700 = Color(0xFF334155);
  static const slate600 = Color(0xFF475569);
  static const slate500 = Color(0xFF64748B);
  static const slate400 = Color(0xFF94A3B8);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate100 = Color(0xFFF1F5F9);
  static const slate050 = Color(0xFFF8FAFC);
  static const white    = Color(0xFFFFFFFF);

  // Status / semantic
  static const green700 = Color(0xFF15803D);
  static const green600 = Color(0xFF16A34A);
  static const green500 = Color(0xFF22C55E);
  static const green100 = Color(0xFFDCFCE7);

  static const amber700 = Color(0xFFB45309);
  static const amber600 = Color(0xFFD97706);
  static const amber500 = Color(0xFFF59E0B);
  static const amber100 = Color(0xFFFEF3C7);

  static const red700 = Color(0xFFB91C1C);
  static const red600 = Color(0xFFDC2626);
  static const red500 = Color(0xFFEF4444);
  static const red100 = Color(0xFFFEE2E2);

  static const teal600 = Color(0xFF0D9488);
  static const teal500 = Color(0xFF14B8A6);
  static const teal100 = Color(0xFFCCFBF1);
}

// ---------------------------------------------------------------------------
// Score band tokens (mirrors scoreBandTokens in tokens.ts)
// ---------------------------------------------------------------------------
enum CreditScoreBand { excellent, good, fair, poor, veryPoor }

class ScoreBandTheme {
  final Color background;
  final Color foreground;
  final Color icon;
  final String label;

  const ScoreBandTheme({
    required this.background,
    required this.foreground,
    required this.icon,
    required this.label,
  });

  static CreditScoreBand fromScore(int score) {
    if (score >= 767) return CreditScoreBand.excellent;
    if (score >= 681) return CreditScoreBand.good;
    if (score >= 614) return CreditScoreBand.fair;
    if (score >= 583) return CreditScoreBand.poor;
    return CreditScoreBand.veryPoor;
  }

  static const Map<CreditScoreBand, ScoreBandTheme> values = {
    CreditScoreBand.excellent: ScoreBandTheme(
      background: _Primitives.green100,
      foreground: _Primitives.green700,
      icon:       _Primitives.green500,
      label:      'Excellent',
    ),
    CreditScoreBand.good: ScoreBandTheme(
      background: _Primitives.green100,
      foreground: _Primitives.green600,
      icon:       _Primitives.green500,
      label:      'Good',
    ),
    CreditScoreBand.fair: ScoreBandTheme(
      background: _Primitives.amber100,
      foreground: _Primitives.amber700,
      icon:       _Primitives.amber500,
      label:      'Fair',
    ),
    CreditScoreBand.poor: ScoreBandTheme(
      background: _Primitives.amber100,
      foreground: _Primitives.amber600,
      icon:       _Primitives.amber500,
      label:      'Poor',
    ),
    CreditScoreBand.veryPoor: ScoreBandTheme(
      background: _Primitives.red100,
      foreground: _Primitives.red700,
      icon:       _Primitives.red500,
      label:      'Very Poor',
    ),
  };
}

// ---------------------------------------------------------------------------
// Account status tokens (mirrors accountStatusTokens in tokens.ts)
// ---------------------------------------------------------------------------
enum AccountStatus { current, arrears, defaulted, judgement, writtenOff }

class AccountStatusTheme {
  final Color background;
  final Color foreground;
  final String label;

  const AccountStatusTheme({
    required this.background,
    required this.foreground,
    required this.label,
  });

  static const Map<AccountStatus, AccountStatusTheme> values = {
    AccountStatus.current: AccountStatusTheme(
      background: _Primitives.green100,
      foreground: _Primitives.green700,
      label: 'Current',
    ),
    AccountStatus.arrears: AccountStatusTheme(
      background: _Primitives.amber100,
      foreground: _Primitives.amber700,
      label: 'In Arrears',
    ),
    AccountStatus.defaulted: AccountStatusTheme(
      background: _Primitives.red100,
      foreground: _Primitives.red700,
      label: 'Default',
    ),
    AccountStatus.judgement: AccountStatusTheme(
      background: _Primitives.red100,
      foreground: _Primitives.red700,
      label: 'Judgement',
    ),
    AccountStatus.writtenOff: AccountStatusTheme(
      background: _Primitives.slate100,
      foreground: _Primitives.slate600,
      label: 'Written Off',
    ),
  };
}

// ---------------------------------------------------------------------------
// Custom colour extension (accessible via Theme.of(context).extension)
// ---------------------------------------------------------------------------
class CrediSyncColors extends ThemeExtension<CrediSyncColors> {
  // Backgrounds
  final Color bgBase;
  final Color bgSurface;
  final Color bgCard;
  final Color bgMuted;

  // Text
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color textLink;

  // Brand
  final Color brandPrimary;
  final Color brandHover;

  // Borders
  final Color borderDefault;
  final Color borderSubtle;
  final Color borderFocus;

  // Alerts
  final Color alertSuccess;
  final Color alertWarning;
  final Color alertError;
  final Color alertInfo;

  const CrediSyncColors({
    required this.bgBase,
    required this.bgSurface,
    required this.bgCard,
    required this.bgMuted,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.textLink,
    required this.brandPrimary,
    required this.brandHover,
    required this.borderDefault,
    required this.borderSubtle,
    required this.borderFocus,
    required this.alertSuccess,
    required this.alertWarning,
    required this.alertError,
    required this.alertInfo,
  });

  static const dark = CrediSyncColors(
    bgBase:        _Primitives.navy900,
    bgSurface:     _Primitives.navy800,
    bgCard:        _Primitives.navy700,
    bgMuted:       _Primitives.slate800,
    textPrimary:   _Primitives.white,
    textSecondary: _Primitives.slate300,
    textMuted:     _Primitives.slate400,
    textLink:      _Primitives.navy400,
    brandPrimary:  _Primitives.navy500,
    brandHover:    _Primitives.navy600,
    borderDefault: _Primitives.navy600,
    borderSubtle:  _Primitives.slate700,
    borderFocus:   _Primitives.navy400,
    alertSuccess:  _Primitives.green500,
    alertWarning:  _Primitives.amber500,
    alertError:    _Primitives.red500,
    alertInfo:     _Primitives.navy400,
  );

  @override
  CrediSyncColors copyWith({
    Color? bgBase,
    Color? bgSurface,
    Color? bgCard,
    Color? bgMuted,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
    Color? textLink,
    Color? brandPrimary,
    Color? brandHover,
    Color? borderDefault,
    Color? borderSubtle,
    Color? borderFocus,
    Color? alertSuccess,
    Color? alertWarning,
    Color? alertError,
    Color? alertInfo,
  }) {
    return CrediSyncColors(
      bgBase:        bgBase        ?? this.bgBase,
      bgSurface:     bgSurface     ?? this.bgSurface,
      bgCard:        bgCard        ?? this.bgCard,
      bgMuted:       bgMuted       ?? this.bgMuted,
      textPrimary:   textPrimary   ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textMuted:     textMuted     ?? this.textMuted,
      textLink:      textLink      ?? this.textLink,
      brandPrimary:  brandPrimary  ?? this.brandPrimary,
      brandHover:    brandHover    ?? this.brandHover,
      borderDefault: borderDefault ?? this.borderDefault,
      borderSubtle:  borderSubtle  ?? this.borderSubtle,
      borderFocus:   borderFocus   ?? this.borderFocus,
      alertSuccess:  alertSuccess  ?? this.alertSuccess,
      alertWarning:  alertWarning  ?? this.alertWarning,
      alertError:    alertError    ?? this.alertError,
      alertInfo:     alertInfo     ?? this.alertInfo,
    );
  }

  @override
  CrediSyncColors lerp(CrediSyncColors? other, double t) {
    if (other == null) return this;
    return CrediSyncColors(
      bgBase:        Color.lerp(bgBase,        other.bgBase,        t)!,
      bgSurface:     Color.lerp(bgSurface,     other.bgSurface,     t)!,
      bgCard:        Color.lerp(bgCard,        other.bgCard,        t)!,
      bgMuted:       Color.lerp(bgMuted,       other.bgMuted,       t)!,
      textPrimary:   Color.lerp(textPrimary,   other.textPrimary,   t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textMuted:     Color.lerp(textMuted,     other.textMuted,     t)!,
      textLink:      Color.lerp(textLink,      other.textLink,      t)!,
      brandPrimary:  Color.lerp(brandPrimary,  other.brandPrimary,  t)!,
      brandHover:    Color.lerp(brandHover,    other.brandHover,    t)!,
      borderDefault: Color.lerp(borderDefault, other.borderDefault, t)!,
      borderSubtle:  Color.lerp(borderSubtle,  other.borderSubtle,  t)!,
      borderFocus:   Color.lerp(borderFocus,   other.borderFocus,   t)!,
      alertSuccess:  Color.lerp(alertSuccess,  other.alertSuccess,  t)!,
      alertWarning:  Color.lerp(alertWarning,  other.alertWarning,  t)!,
      alertError:    Color.lerp(alertError,    other.alertError,    t)!,
      alertInfo:     Color.lerp(alertInfo,     other.alertInfo,     t)!,
    );
  }
}

// ---------------------------------------------------------------------------
// Text theme
// ---------------------------------------------------------------------------
const _textTheme = TextTheme(
  // Hero score display
  displayLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 30,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.025 * 30,
    height: 1.25,
    color: _Primitives.white,
  ),
  // Section headings
  headlineMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.025 * 24,
    height: 1.25,
    color: _Primitives.white,
  ),
  // Card headings
  titleLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: FontWeight.w600,
    height: 1.25,
    color: _Primitives.white,
  ),
  // Sub-headings
  titleMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 18,
    fontWeight: FontWeight.w500,
    height: 1.5,
    color: _Primitives.white,
  ),
  // Body
  bodyLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: _Primitives.slate300,
  ),
  // Secondary body
  bodyMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: _Primitives.slate400,
  ),
  // Labels / badges
  labelSmall: TextStyle(
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.1 * 12,
    height: 1.5,
    color: _Primitives.slate400,
  ),
);

// ---------------------------------------------------------------------------
// AppTheme
// ---------------------------------------------------------------------------
abstract class AppTheme {
  static ThemeData get dark {
    const seedColor = _Primitives.navy500;

    return ThemeData(
      useMaterial3:    true,
      brightness:      Brightness.dark,
      colorSchemeSeed: seedColor,

      scaffoldBackgroundColor: _Primitives.navy900,

      // AppBar
      appBarTheme: const AppBarTheme(
        backgroundColor:  _Primitives.navy800,
        foregroundColor:  _Primitives.white,
        elevation:        0,
        centerTitle:      false,
        titleTextStyle: TextStyle(
          fontFamily:  'Inter',
          fontSize:    20,
          fontWeight:  FontWeight.w600,
          color:       _Primitives.white,
          letterSpacing: 0,
        ),
      ),

      // Cards
      cardTheme: const CardThemeData(
        color:        _Primitives.navy700,
        elevation:    0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
          side: BorderSide(color: _Primitives.navy600, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),

      // Elevated button (primary CTA)
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor:  _Primitives.navy500,
          foregroundColor:  _Primitives.white,
          elevation:        0,
          padding:          const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(12)),
          ),
          textStyle: const TextStyle(
            fontFamily:  'Inter',
            fontSize:    16,
            fontWeight:  FontWeight.w600,
          ),
        ),
      ),

      // Outlined button (secondary CTA)
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: _Primitives.navy400,
          side: const BorderSide(color: _Primitives.navy600, width: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(12)),
          ),
          textStyle: const TextStyle(
            fontFamily:  'Inter',
            fontSize:    16,
            fontWeight:  FontWeight.w500,
          ),
        ),
      ),

      // Input fields
      inputDecorationTheme: InputDecorationTheme(
        filled:           true,
        fillColor:        _Primitives.navy800,
        contentPadding:   const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _Primitives.navy600),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _Primitives.navy600),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _Primitives.navy400, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _Primitives.red500),
        ),
        hintStyle: const TextStyle(color: _Primitives.slate500),
        labelStyle: const TextStyle(color: _Primitives.slate400),
      ),

      // Divider
      dividerTheme: const DividerThemeData(
        color:     _Primitives.navy600,
        thickness: 1,
        space:     1,
      ),

      // Chip (used for score band badges)
      chipTheme: const ChipThemeData(
        backgroundColor:  _Primitives.navy800,
        labelStyle: TextStyle(
          fontFamily: 'Inter',
          fontSize:   12,
          fontWeight: FontWeight.w500,
          color:      _Primitives.slate300,
        ),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        shape: StadiumBorder(),
      ),

      // Bottom navigation
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor:     _Primitives.navy800,
        selectedItemColor:   _Primitives.navy400,
        unselectedItemColor: _Primitives.slate500,
        type:                BottomNavigationBarType.fixed,
        elevation:           0,
      ),

      // Text
      textTheme: _textTheme,
      fontFamily: 'Inter',

      // Custom extension
      extensions: const [CrediSyncColors.dark],
    );
  }
}
