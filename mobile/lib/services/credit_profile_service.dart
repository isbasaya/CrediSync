import 'api_client.dart';

class CreditProfile {
  final String id;
  final String userId;
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
  final int? bankReadinessScore;
  final String? bankReadinessTier;
  final String lastRefreshedAt;

  CreditProfile({
    required this.id,
    required this.userId,
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
      userId: json['userId'] as String,
      unifiedScore: json['unifiedScore'] as int?,
      unifiedScoreBand: json['unifiedScoreBand'] as String?,
      bureauScores: (json['bureauScores'] as List<dynamic>? ?? [])
          .map((e) => BureauScore.fromJson(e as Map<String, dynamic>))
          .toList(),
      totalAccounts: json['totalAccounts'] as int? ?? 0,
      openAccounts: json['openAccounts'] as int? ?? 0,
      adverseAccounts: json['adverseAccounts'] as int? ?? 0,
      judgementsCount: json['judgementsCount'] as int? ?? 0,
      defaultsCount: json['defaultsCount'] as int? ?? 0,
      enquiriesLast12m: json['enquiriesLast12m'] as int? ?? 0,
      totalCreditExposure: (json['totalCreditExposure'] as num?)?.toDouble() ?? 0.0,
      bankReadinessScore: json['bankReadinessScore'] as int?,
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

  factory BureauScore.fromJson(Map<String, dynamic> json) {
    return BureauScore(
      bureau: json['bureau'] as String,
      score: json['score'] as int?,
      scoreBand: json['scoreBand'] as String?,
    );
  }
}

class CreditProfileService {
  static Future<CreditProfile> getProfile(String userId) async {
    final response = await ApiClient.get('/credit-profiles/$userId');
    return CreditProfile.fromJson(response);
  }

  static Future<CreditProfile> refreshProfile(String userId) async {
    final response = await ApiClient.post('/credit-profiles/$userId/refresh');
    return CreditProfile.fromJson(response);
  }
}
