/// Client-side checks that mirror the dispute engine's limits (and the web app's
/// messages), so people hear about a problem before spending data on an upload.
/// The server still checks each file's real contents.
library;

const evidenceContentTypes = ['application/pdf', 'image/jpeg', 'image/png'];
const maxEvidenceBytes = 10 * 1024 * 1024;
const maxEvidenceFiles = 10;

/// Extensions offered by the file picker.
const evidenceExtensions = ['pdf', 'jpg', 'jpeg', 'png'];

String? validateEvidence(String contentType, int size, int existingCount) {
  if (existingCount >= maxEvidenceFiles) return 'You can attach up to $maxEvidenceFiles files';
  if (!evidenceContentTypes.contains(contentType)) return 'Upload a PDF, JPEG or PNG file';
  if (size <= 0) return 'This file is empty';
  if (size > maxEvidenceBytes) return 'Files must be smaller than 10 MB';
  return null;
}

/// Picked files carry no reliable MIME type on every platform, so it comes from the
/// extension. Anything else maps to '' and is rejected by [validateEvidence].
String contentTypeForName(String name) {
  final dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return switch (name.substring(dot + 1).toLowerCase()) {
    'pdf' => 'application/pdf',
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    _ => '',
  };
}

String formatFileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  final kb = bytes / 1024;
  if (kb < 1024) return '${_trim(kb)} KB';
  return '${_trim(kb / 1024)} MB';
}

String _trim(double n) {
  final s = n.toStringAsFixed(1);
  return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
}
