import 'api_client.dart';

class CreditProfile {
  final String id;
  final int? unifiedScore;
  final String? unifiedScoreBand;
  final List<BureauScore> bureauScores;
  final int totalAccounts;
  final int openAccounts;
  final int adverseAccounts;
  final int judgementsCount;
  final int defaultsCount;
  final int enquiriesLast12m;
  final double totalCreditExposure;
  final double? bankReadinessScore;
  final String? bankReadinessTier;
  final String lastRefreshedAt;

  CreditProfile({
    required this.id,
    this.unifiedScore,
    this.unifiedScoreBand,
    required this.bureauScores,
    required this.totalAccounts,
    required this.openAccounts,
    required this.adverseAccounts,
    required this.judgementsCount,
    required this.defaultsCount,
    required this.enquiriesLast12m,
    required this.totalCreditExposure,
    this.bankReadinessScore,
    this.bankReadinessTier,
    required this.lastRefreshedAt,
  });

  factory CreditProfile.fromJson(Map<String, dynamic> json) {
    return CreditProfile(
      id: json['id'] as String,
      unifiedScore: json['unifiedScore'] as int?,
      unifiedScoreBand: json['unifiedScoreBand'] as String?,
      bureauScores: (json['bureauScores'] as List<dynamic>? ?? []).map((e) => BureauScore.fromJson(e as Map<String, dynamic>)).toList(),
      totalAccounts: json['totalAccounts'] as int? ?? 0,
      openAccounts: json['openAccounts'] as int? ?? 0,
      adverseAccounts: json['adverseAccounts'] as int? ?? 0,
      judgementsCount: json['judgementsCount'] as int? ?? 0,
      defaultsCount: json['defaultsCount'] as int? ?? 0,
      enquiriesLast12m: json['enquiriesLast12m'] as int? ?? 0,
      totalCreditExposure: (json['totalCreditExposure'] as num?)?.toDouble() ?? 0.0,
      bankReadinessScore: (json['bankReadinessScore'] as num?)?.toDouble(),
      bankReadinessTier: json['bankReadinessTier'] as String?,
      lastRefreshedAt: json['lastRefreshedAt'] as String,
    );
  }
}

class BureauScore {
  final String bureau;
  final int? score;
  final String? scoreBand;

  BureauScore({required this.bureau, this.score, this.scoreBand});

  factory BureauScore.fromJson(Map<String, dynamic> json) =>
      BureauScore(bureau: json['bureau'] as String, score: json['score'] as int?, scoreBand: json['scoreBand'] as String?);
}

/// One bureau's record of an account (dispute one of these).
class BureauRecord {
  final String accountId;
  final String bureau;
  final String status;
  final double currentBalance;

  BureauRecord({required this.accountId, required this.bureau, required this.status, required this.currentBalance});

  factory BureauRecord.fromJson(Map<String, dynamic> json) => BureauRecord(
        accountId: json['accountId'] as String,
        bureau: json['bureau'] as String,
        status: json['status'] as String,
        currentBalance: (json['currentBalance'] as num).toDouble(),
      );
}

/// One real-world credit facility, with every bureau that reports it.
class CreditAccount {
  final String resolvedAccountId;
  final String creditorName;
  final String accountType;
  final String status;
  final double currentBalance;
  final List<BureauRecord> reportedBy;

  CreditAccount({
    required this.resolvedAccountId,
    required this.creditorName,
    required this.accountType,
    required this.status,
    required this.currentBalance,
    required this.reportedBy,
  });

  factory CreditAccount.fromJson(Map<String, dynamic> json) => CreditAccount(
        resolvedAccountId: json['resolvedAccountId'] as String,
        creditorName: json['creditorName'] as String,
        accountType: json['accountType'] as String,
        status: json['status'] as String,
        currentBalance: (json['currentBalance'] as num).toDouble(),
        reportedBy: (json['reportedBy'] as List<dynamic>).map((e) => BureauRecord.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

/// All calls act for the signed-in user; the server never takes a user id from the app.
class CreditProfileService {
  /// Returns null when the user hasn't fetched their reports yet.
  static Future<CreditProfile?> getProfile() async {
    try {
      return CreditProfile.fromJson(await ApiClient.get('/credit-profile'));
    } on ApiError catch (e) {
      if (e.code == 'no_credit_profile') return null;
      rethrow;
    }
  }

  static Future<CreditProfile> refreshProfile() async {
    final response = await ApiClient.post('/credit-profile/refresh');
    return CreditProfile.fromJson(response['profile'] as Map<String, dynamic>);
  }

  static Future<List<CreditAccount>> getAccounts() async {
    final list = await ApiClient.getList('/credit-profile/accounts');
    return list.map((e) => CreditAccount.fromJson(e as Map<String, dynamic>)).toList();
  }
}
