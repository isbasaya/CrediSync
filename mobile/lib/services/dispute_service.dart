import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'api_client.dart';

/// A file attached to a dispute. Storage keys are never sent to clients.
class DisputeEvidence {
  final String id;
  final String displayName;
  final String contentType;
  final int sizeBytes;

  /// `pending` until the server has checked the uploaded file, then `verified`.
  final String status;

  const DisputeEvidence({
    required this.id,
    required this.displayName,
    required this.contentType,
    required this.sizeBytes,
    required this.status,
  });

  bool get isVerified => status == 'verified';

  factory DisputeEvidence.fromJson(Map<String, dynamic> json) => DisputeEvidence(
        id: json['id'] as String,
        displayName: json['displayName'] as String,
        contentType: json['contentType'] as String,
        sizeBytes: (json['sizeBytes'] as num).toInt(),
        status: json['status'] as String,
      );
}

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
  final List<DisputeEvidence> evidence;

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
    this.evidence = const [],
  });

  bool get isDraft => status == 'draft';

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
      evidence: [
        for (final e in json['evidence'] as List<dynamic>? ?? const []) DisputeEvidence.fromJson(e as Map<String, dynamic>),
      ],
    );
  }
}

/// A presigned link to upload one file straight to storage.
class EvidenceUpload {
  final DisputeEvidence evidence;
  final String uploadUrl;
  final Map<String, String> requiredHeaders;

  const EvidenceUpload(this.evidence, this.uploadUrl, this.requiredHeaders);

  factory EvidenceUpload.fromJson(Map<String, dynamic> json) => EvidenceUpload(
        DisputeEvidence.fromJson(json['evidence'] as Map<String, dynamic>),
        json['uploadUrl'] as String,
        (json['requiredHeaders'] as Map<String, dynamic>? ?? const {}).map((k, v) => MapEntry(k, v as String)),
      );
}

/// The storage PUT failed or never reached storage. The file stays pending on the server.
class EvidenceUploadFailed implements Exception {
  const EvidenceUploadFailed();
}

class DisputeService {
  static Future<List<Dispute>> getDisputes() async {
    final response = await ApiClient.get('/disputes');
    final list = response['disputes'] as List<dynamic>? ?? [];
    return list.map((e) => Dispute.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<Dispute> getDispute(String disputeId) async =>
      Dispute.fromJson(await ApiClient.get('/disputes/${Uri.encodeComponent(disputeId)}'));

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
    return Dispute.fromJson(await ApiClient.post('/disputes/${Uri.encodeComponent(disputeId)}/submit'));
  }

  /// Deletes an unsent draft and any files attached to it.
  static Future<void> deleteDraft(String disputeId) => ApiClient.delete('/disputes/${Uri.encodeComponent(disputeId)}');

  // --- Evidence ----------------------------------------------------------------

  static String _evidencePath(String disputeId, [String? evidenceId]) =>
      '/disputes/${Uri.encodeComponent(disputeId)}/evidence${evidenceId == null ? '' : '/${Uri.encodeComponent(evidenceId)}'}';

  static Future<EvidenceUpload> requestUpload(String disputeId, String fileName, String contentType, int size) async =>
      EvidenceUpload.fromJson(await ApiClient.post(_evidencePath(disputeId), body: {
        'contentType': contentType,
        'contentLength': size,
        'fileName': fileName,
      }));

  /// A fresh link for a file that is still pending, because the first may have expired.
  static Future<EvidenceUpload> retryUpload(String disputeId, String evidenceId) async =>
      EvidenceUpload.fromJson(await ApiClient.post('${_evidencePath(disputeId, evidenceId)}/retry'));

  /// Asks the server to check the stored file. Returns the dispute with its updated letter.
  static Future<Dispute> completeEvidence(String disputeId, String evidenceId) async =>
      Dispute.fromJson(await ApiClient.post('${_evidencePath(disputeId, evidenceId)}/complete'));

  static Future<Dispute> removeEvidence(String disputeId, String evidenceId) async =>
      Dispute.fromJson(await ApiClient.delete(_evidencePath(disputeId, evidenceId)));

  /// Uploads straight to storage on the presigned link. The API bearer token is never
  /// sent: the URL carries its own signature, and storage is not our API.
  ///
  /// Uses dart:io so each chunk is flushed to the socket before progress is reported;
  /// package:http buffers the whole body, which would make progress meaningless on slow
  /// connections.
  static Future<void> putEvidence(
    EvidenceUpload upload,
    Uint8List bytes,
    void Function(double fraction) onProgress,
  ) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 30);
    try {
      final request = await client.openUrl('PUT', Uri.parse(upload.uploadUrl));
      upload.requiredHeaders.forEach((k, v) => request.headers.set(k, v, preserveHeaderCase: true));
      request.contentLength = bytes.length;
      const chunk = 64 * 1024;
      for (var offset = 0; offset < bytes.length; offset += chunk) {
        final end = offset + chunk < bytes.length ? offset + chunk : bytes.length;
        request.add(Uint8List.sublistView(bytes, offset, end));
        await request.flush().timeout(const Duration(seconds: 60));
        onProgress(end / bytes.length);
      }
      final response = await request.close().timeout(const Duration(seconds: 60));
      await response.drain<void>();
      if (response.statusCode < 200 || response.statusCode >= 300) throw const EvidenceUploadFailed();
    } on EvidenceUploadFailed {
      rethrow;
    } catch (_) {
      throw const EvidenceUploadFailed();
    } finally {
      client.close(force: true);
    }
  }

  /// Request a link, upload, then verify. [onCreated] receives the evidence id as soon as
  /// the server has a row for it, so a failed upload can be retried or removed.
  static Future<Dispute> uploadEvidence(
    String disputeId,
    String fileName,
    String contentType,
    Uint8List bytes,
    void Function(double fraction) onProgress, {
    void Function(String evidenceId)? onCreated,
  }) async {
    final upload = await requestUpload(disputeId, fileName, contentType, bytes.length);
    onCreated?.call(upload.evidence.id);
    await putEvidence(upload, bytes, onProgress);
    return completeEvidence(disputeId, upload.evidence.id);
  }
}
