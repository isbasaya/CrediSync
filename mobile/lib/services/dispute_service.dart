import 'api_client.dart';

class Dispute {
  final String id;
  final String bureau;
  final String disputeReason;
  final String status;
  final String createdAt;
  final String? resolutionDeadline;

  Dispute({
    required this.id,
    required this.bureau,
    required this.disputeReason,
    required this.status,
    required this.createdAt,
    this.resolutionDeadline,
  });

  factory Dispute.fromJson(Map<String, dynamic> json) {
    return Dispute(
      id: json['id'] as String,
      bureau: json['bureau'] as String,
      disputeReason: json['disputeReason'] as String,
      status: json['status'] as String,
      createdAt: json['createdAt'] as String,
      resolutionDeadline: json['resolutionDeadline'] as String?,
    );
  }
}

class DisputeService {
  static Future<List<Dispute>> getDisputes() async {
    final response = await ApiClient.get('/disputes');
    final list = response['disputes'] as List<dynamic>? ?? [];
    return list.map((e) => Dispute.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<Dispute> createDispute({
    required String bureauAccountId,
    required String bureau,
    required String reason,
    required String description,
    required String maskedSaId,
  }) async {
    final response = await ApiClient.post('/disputes', body: {
      'bureauAccountId': bureauAccountId,
      'bureau': bureau,
      'reason': reason,
      'description': description,
      'maskedSaId': maskedSaId,
    });
    return Dispute.fromJson(response);
  }

  static Future<void> submitDispute(String disputeId) async {
    await ApiClient.post('/disputes/$disputeId/submit');
  }
}
