import 'api_client.dart';

class Dispute {
  final String id;
  final String bureau;
  final String disputeReason;
  final String status;
  final String createdAt;
  final String? resolutionDeadline;
  final String? deadlineBreachedAt;
  final String? creditorName;
  final String? letterContent;

  Dispute({
    required this.id,
    required this.bureau,
    required this.disputeReason,
    required this.status,
    required this.createdAt,
    this.resolutionDeadline,
    this.deadlineBreachedAt,
    this.creditorName,
    this.letterContent,
  });

  factory Dispute.fromJson(Map<String, dynamic> json) {
    return Dispute(
      id: json['id'] as String,
      bureau: json['bureau'] as String,
      disputeReason: json['disputeReason'] as String,
      status: json['status'] as String,
      createdAt: json['createdAt'] as String,
      resolutionDeadline: json['resolutionDeadline'] as String?,
      deadlineBreachedAt: json['deadlineBreachedAt'] as String?,
      creditorName: json['creditorName'] as String?,
      letterContent: json['letterContent'] as String?,
    );
  }
}

class DisputeService {
  static Future<List<Dispute>> getDisputes() async {
    final response = await ApiClient.get('/disputes');
    final list = response['disputes'] as List<dynamic>? ?? [];
    return list.map((e) => Dispute.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Creates a draft. The bureau is taken from the account record on the server.
  static Future<Dispute> createDispute({
    required String bureauAccountId,
    required String reason,
    required String description,
  }) async {
    final response = await ApiClient.post('/disputes', body: {
      'bureauAccountId': bureauAccountId,
      'reason': reason,
      'description': description,
    });
    return Dispute.fromJson(response);
  }

  static Future<Dispute> submitDispute(String disputeId) async {
    return Dispute.fromJson(await ApiClient.post('/disputes/$disputeId/submit'));
  }
}
