// lib/theme/app_theme.dart
//
// CrediSync Flutter Theme — "Home Ground"
//
// Implements the design tokens from design-system/tokens.ts as a Dart/Flutter
// ThemeData. All colour constants mirror the HEX values defined in the shared
// design-token source of truth. Light, high-contrast, one confident teal
// accent — see DESIGN.md at the project root for the full system.
//
// Usage:
//   MaterialApp(
//     theme: AppTheme.light,
//     ...
//   )

import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// Primitive colour constants
// ---------------------------------------------------------------------------
abstract class _Primitives {
  // Ink — near-black text/ground primitive for the light "Home Ground" world
  static const ink800 = Color(0xFF12181F);

  // Teal — the single brand accent. Not blue (the retired identity) and not
  // green/amber/red (reserved for score-band and account-status semantics).
  static const teal800 = Color(0xFF075C53);
  static const teal700 = Color(0xFF0B7A70);
  static const teal600 = Color(0xFF0D9488);
  static const teal050 = Color(0xFFEFFCF9);

  // Neutrals / slate
  static const slate600 = Color(0xFF475569);
  static const slate400 = Color(0xFF94A3B8);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate100 = Color(0xFFF1F5F9);
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

  static const purple600 = Color(0xFF9333EA);
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

  /// Looks up theme colours directly from a raw bureau/DB band string
  /// ('excellent' | 'good' | 'fair' | 'poor' | 'very_poor'), the shape the
  /// API actually returns. Falls back to a neutral slate for null/unknown.
  static ScoreBandTheme fromBandString(String? band) {
    switch (band) {
      case 'excellent':
        return values[CreditScoreBand.excellent]!;
      case 'good':
        return values[CreditScoreBand.good]!;
      case 'fair':
        return values[CreditScoreBand.fair]!;
      case 'poor':
        return values[CreditScoreBand.poor]!;
      case 'very_poor':
        return values[CreditScoreBand.veryPoor]!;
      default:
        return const ScoreBandTheme(
          background: _Primitives.slate100,
          foreground: _Primitives.slate600,
          icon: _Primitives.slate400,
          label: 'Unknown',
        );
    }
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
enum AccountStatus {
  current,
  arrears,
  defaulted,
  judgement,
  writtenOff,
  unknown;

  /// Maps the API / database value (db/schema.sql account_status) to the enum.
  static AccountStatus fromApi(String value) {
    switch (value) {
      case 'current':
        return AccountStatus.current;
      case 'arrears':
        return AccountStatus.arrears;
      case 'default':
        return AccountStatus.defaulted;
      case 'judgement':
        return AccountStatus.judgement;
      case 'written_off':
        return AccountStatus.writtenOff;
      default:
        return AccountStatus.unknown;
    }
  }
}

class AccountStatusTheme {
  final Color background;
  final Color foreground;
  final String label;
  final Color? border;

  const AccountStatusTheme({
    required this.background,
    required this.foreground,
    required this.label,
    this.border,
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
    // Bureau sent a status we haven't mapped yet: neutral, outlined, never adverse.
    AccountStatus.unknown: AccountStatusTheme(
      background: _Primitives.white,
      foreground: _Primitives.slate600,
      label: 'Status unknown',
      border: _Primitives.slate300,
    ),
  };
}

// ---------------------------------------------------------------------------
// Dispute status tokens — used by disputes_screen.dart
// ---------------------------------------------------------------------------
class DisputeStatusTheme {
  final Color background;
  final Color foreground;

  const DisputeStatusTheme({required this.background, required this.foreground});

  static DisputeStatusTheme forStatus(String status) {
    switch (status) {
      case 'resolved_upheld':
        return const DisputeStatusTheme(background: _Primitives.green100, foreground: _Primitives.green700);
      case 'resolved_rejected':
        return const DisputeStatusTheme(background: _Primitives.red100, foreground: _Primitives.red700);
      case 'submitted':
      case 'under_review':
        return const DisputeStatusTheme(background: _Primitives.amber100, foreground: _Primitives.amber700);
      case 'escalated_ncr':
        return DisputeStatusTheme(background: _Primitives.purple600.withValues(alpha: 0.12), foreground: _Primitives.purple600);
      default:
        return const DisputeStatusTheme(background: _Primitives.slate100, foreground: _Primitives.slate600);
    }
  }
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

  static const light = CrediSyncColors(
    bgBase:        Color(0xFFF5F7F8),
    bgSurface:     _Primitives.white,
    bgCard:        _Primitives.white,
    bgMuted:       Color(0xFFEEF1F3),
    textPrimary:   _Primitives.ink800,
    textSecondary: Color(0xFF3F4A57),
    textMuted:     Color(0xFF6B7684),
    textLink:      _Primitives.teal700,
    brandPrimary:  _Primitives.teal700,
    brandHover:    _Primitives.teal800,
    borderDefault: Color(0xFFE2E6EA),
    borderSubtle:  Color(0xFFEDF0F3),
    borderFocus:   _Primitives.teal700,
    alertSuccess:  _Primitives.green600,
    alertWarning:  _Primitives.amber600,
    alertError:    _Primitives.red600,
    alertInfo:     _Primitives.teal600,
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
    color: _Primitives.ink800,
  ),
  // Section headings
  headlineMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.025 * 24,
    height: 1.25,
    color: _Primitives.ink800,
  ),
  // Card headings
  titleLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: FontWeight.w600,
    height: 1.25,
    color: _Primitives.ink800,
  ),
  // Sub-headings
  titleMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 18,
    fontWeight: FontWeight.w500,
    height: 1.5,
    color: _Primitives.ink800,
  ),
  // Body
  bodyLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: Color(0xFF3F4A57),
  ),
  // Secondary body
  bodyMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: Color(0xFF6B7684),
  ),
  // Labels / badges
  labelSmall: TextStyle(
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.1 * 12,
    height: 1.5,
    color: Color(0xFF6B7684),
  ),
);

// ---------------------------------------------------------------------------
// AppTheme
// ---------------------------------------------------------------------------
abstract class AppTheme {
  static ThemeData get light {
    const seedColor = _Primitives.teal700;

    return ThemeData(
      useMaterial3:    true,
      brightness:      Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: seedColor,
        brightness: Brightness.light,
      ).copyWith(
        primary: _Primitives.teal700,
        onPrimary: _Primitives.white,
        surface: _Primitives.white,
        error: _Primitives.red600,
      ),

      scaffoldBackgroundColor: const Color(0xFFF5F7F8),

      // AppBar
      appBarTheme: const AppBarTheme(
        backgroundColor:  Colors.transparent,
        foregroundColor:  _Primitives.ink800,
        elevation:        0,
        centerTitle:      false,
        titleTextStyle: TextStyle(
          fontFamily:  'Inter',
          fontSize:    20,
          fontWeight:  FontWeight.w600,
          color:       _Primitives.ink800,
          letterSpacing: 0,
        ),
      ),

      // Cards
      cardTheme: const CardThemeData(
        color:        _Primitives.white,
        elevation:    0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
          side: BorderSide(color: Color(0xFFE2E6EA)),
        ),
        margin: EdgeInsets.zero,
      ),

      // Elevated button (primary CTA)
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor:  _Primitives.teal700,
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
          foregroundColor: _Primitives.teal700,
          side: const BorderSide(color: Color(0xFFE2E6EA), width: 1.5),
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
        fillColor:        _Primitives.white,
        contentPadding:   const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        labelStyle: const TextStyle(color: Color(0xFF3F4A57)),
        hintStyle: const TextStyle(color: Color(0xFF6B7684)),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2E6EA)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2E6EA)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _Primitives.teal700, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _Primitives.red500),
        ),
      ),

      // Divider
      dividerTheme: const DividerThemeData(
        color:     Color(0xFFE2E6EA),
        thickness: 1,
        space:     1,
      ),

      // Chip (used for score band badges)
      chipTheme: const ChipThemeData(
        backgroundColor:  Color(0xFFEEF1F3),
        labelStyle: TextStyle(
          fontFamily: 'Inter',
          fontSize:   12,
          fontWeight: FontWeight.w500,
          color:      Color(0xFF3F4A57),
        ),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        shape: StadiumBorder(),
      ),

      // Bottom navigation
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor:     _Primitives.white,
        indicatorColor:      _Primitives.teal050,
        elevation:           0,
        surfaceTintColor:    Colors.transparent,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontFamily: 'Inter',
            fontSize: 12,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? _Primitives.teal800 : const Color(0xFF6B7684),
          );
        }),
      ),

      // Progress indicators default to the brand teal
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: _Primitives.teal700,
      ),

      // Text
      textTheme: _textTheme,
      fontFamily: 'Inter',

      // Custom extension
      extensions: const [CrediSyncColors.light],
    );
  }
}
