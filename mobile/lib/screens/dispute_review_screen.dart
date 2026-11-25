import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api_client.dart';
import '../services/dispute_service.dart';
import '../services/evidence_validation.dart';
import '../theme/app_theme.dart';

/// Review a saved draft: read the letter, attach supporting documents, then send it,
/// keep it as a draft, or delete it. Pops `true` when the dispute list should reload.
class DisputeReviewScreen extends StatefulWidget {
  final String disputeId;

  const DisputeReviewScreen({super.key, required this.disputeId});

  @override
  State<DisputeReviewScreen> createState() => _DisputeReviewScreenState();
}

enum _Phase { uploading, verifying, failed }

/// A file this screen is working on. Server rows without one were left by an earlier visit.
class _LocalUpload {
  final int key;
  final String name;
  final int size;
  final String contentType;
  final Uint8List bytes;
  String? evidenceId;
  _Phase phase = _Phase.uploading;
  double progress = 0;
  String? error;

  _LocalUpload(this.key, this.name, this.contentType, this.bytes) : size = bytes.length;
}

/// Codes after which the server has already discarded the file.
const _erasedCodes = {'invalid_evidence', 'evidence_upload_expired'};

class _DisputeReviewScreenState extends State<DisputeReviewScreen> {
  Dispute? _dispute;
  String? _loadError;
  final List<_LocalUpload> _uploads = [];
  final Map<String, String> _rowErrors = {};
  String? _busyRow;
  String? _busyAction; // 'send' | 'delete'
  int _seq = 0;

  static const _bureauLabels = {'transunion': 'TransUnion', 'experian': 'Experian', 'xds': 'XDS'};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final d = await DisputeService.getDispute(widget.disputeId);
      if (!mounted) return;
      setState(() {
        _dispute = d;
        if (!d.isDraft) _loadError = 'This dispute has already been sent.';
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    } catch (_) {
      if (mounted) setState(() => _loadError = 'We couldn’t load your draft.');
    }
  }

  // --- Derived state ------------------------------------------------------------

  List<DisputeEvidence> get _evidence => _dispute?.evidence ?? const [];
  Set<String> get _tracked => {for (final u in _uploads) if (u.evidenceId != null) u.evidenceId!};
  List<DisputeEvidence> get _orphans => _evidence.where((e) => !e.isVerified && !_tracked.contains(e.id)).toList();
  List<DisputeEvidence> get _verified => _evidence.where((e) => e.isVerified).toList();

  /// Anything uploading, checking, or left on the server unfinished blocks sending.
  bool get _uploadsPending =>
      _orphans.isNotEmpty || _uploads.any((u) => u.phase != _Phase.failed || u.evidenceId != null);

  int get _slotsUsed => _evidence.length + _uploads.where((u) => u.evidenceId == null && u.phase != _Phase.failed).length;

  void _announce(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  String _messageOf(Object e, String fallback) => e is ApiError ? e.message : fallback;
  String? _codeOf(Object e) => e is ApiError ? e.code : null;

  // --- Adding files ---------------------------------------------------------------

  Future<void> _chooseSource() async {
    final source = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              subtitle: const Text('Of a letter, slip or statement'),
              onTap: () => Navigator.pop(context, 'camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose a photo'),
              onTap: () => Navigator.pop(context, 'gallery'),
            ),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: const Text('Choose a PDF or image file'),
              onTap: () => Navigator.pop(context, 'file'),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    if (source == 'file') {
      await _pickFiles();
    } else {
      await _pickPhoto(source == 'camera' ? ImageSource.camera : ImageSource.gallery);
    }
  }

  Future<void> _pickPhoto(ImageSource source) async {
    try {
      // Scaled and compressed so a photo of a page uploads quickly on a slow connection.
      final photo = await ImagePicker().pickImage(source: source, imageQuality: 80, maxWidth: 2000);
      if (photo == null) return;
      final bytes = await photo.readAsBytes();
      // The picker re-encodes as JPEG at this quality, whatever the original was.
      final type = contentTypeForName(photo.name).isEmpty ? 'image/jpeg' : contentTypeForName(photo.name);
      await _start(photo.name, type, bytes, _slotsUsed);
    } catch (_) {
      _announce('We couldn’t open your camera or photos. Check CrediSync’s permissions in Settings.');
    }
  }

  Future<void> _pickFiles() async {
    final FilePickerResult? result;
    try {
      result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: evidenceExtensions,
        allowMultiple: true,
        withData: true,
      );
    } catch (_) {
      _announce('We couldn’t open your files.');
      return;
    }
    if (result == null) return;
    var used = _slotsUsed;
    for (final f in result.files) {
      final bytes = f.bytes;
      if (bytes == null) {
        _addRejected(f.name, f.size, 'We couldn’t read this file. Try another.');
        continue;
      }
      await _start(f.name, contentTypeForName(f.name), bytes, used++);
    }
  }

  void _addRejected(String name, int size, String error) {
    setState(() {
      _uploads.add(_LocalUpload(++_seq, name, '', Uint8List(0))
        ..phase = _Phase.failed
        ..error = error);
    });
    _announce('$name: $error');
  }

  Future<void> _start(String name, String contentType, Uint8List bytes, int existing) async {
    final invalid = validateEvidence(contentType, bytes.length, existing);
    if (invalid != null) {
      _addRejected(name, bytes.length, invalid);
      return;
    }
    final u = _LocalUpload(++_seq, name, contentType, bytes);
    setState(() => _uploads.add(u));
    try {
      final link = await DisputeService.requestUpload(widget.disputeId, name, contentType, bytes.length);
      setState(() => u.evidenceId = link.evidence.id);
      await _send(u, link);
    } catch (e) {
      setState(() {
        u.phase = _Phase.failed;
        u.error = _messageOf(e, 'We couldn’t start this upload.');
      });
    }
  }

  Future<void> _send(_LocalUpload u, EvidenceUpload link) async {
    setState(() {
      u.phase = _Phase.uploading;
      u.progress = 0;
      u.error = null;
    });
    try {
      await DisputeService.putEvidence(link, u.bytes, (p) {
        if (mounted) setState(() => u.progress = p);
      });
    } on EvidenceUploadFailed {
      if (!mounted) return;
      setState(() {
        u.phase = _Phase.failed;
        u.error = 'The upload didn’t finish. Check your connection and try again.';
      });
      return;
    }
    await _verify(u);
  }

  Future<void> _verify(_LocalUpload u) async {
    final id = u.evidenceId;
    if (id == null) return;
    setState(() {
      u.phase = _Phase.verifying;
      u.error = null;
    });
    try {
      final updated = await DisputeService.completeEvidence(widget.disputeId, id);
      if (!mounted) return;
      setState(() {
        _uploads.remove(u);
        _dispute = updated;
      });
      _announce('${u.name} attached.');
    } catch (e) {
      if (!mounted) return;
      final erased = _erasedCodes.contains(_codeOf(e));
      setState(() {
        u.phase = _Phase.failed;
        u.error = _messageOf(e, 'We couldn’t check this file.');
        if (erased) u.evidenceId = null; // the server removed it; it can only be dismissed
      });
      if (erased) _refresh();
    }
  }

  /// Checks again first, because the upload may have landed and only the check failed.
  /// Only if nothing arrived does it upload again on a fresh link.
  Future<void> _retry(_LocalUpload u) async {
    final id = u.evidenceId;
    if (id == null) return;
    setState(() {
      u.phase = _Phase.verifying;
      u.error = null;
    });
    try {
      final updated = await DisputeService.completeEvidence(widget.disputeId, id);
      if (!mounted) return;
      setState(() {
        _uploads.remove(u);
        _dispute = updated;
      });
      _announce('${u.name} attached.');
      return;
    } catch (e) {
      if (_codeOf(e) != 'evidence_not_uploaded') {
        if (!mounted) return;
        final erased = _erasedCodes.contains(_codeOf(e));
        setState(() {
          u.phase = _Phase.failed;
          u.error = _messageOf(e, 'We couldn’t check this file.');
          if (erased) u.evidenceId = null;
        });
        if (erased) _refresh();
        return;
      }
    }
    try {
      final link = await DisputeService.retryUpload(widget.disputeId, id);
      await _send(u, link);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        u.phase = _Phase.failed;
        u.error = _messageOf(e, 'We couldn’t restart this upload.');
      });
      if (_erasedCodes.contains(_codeOf(e))) _refresh();
    }
  }

  /// An unfinished file from an earlier visit. This screen no longer has the bytes, so it
  /// can only check whether the upload landed; otherwise the person removes and re-adds it.
  Future<void> _resume(DisputeEvidence e) async {
    setState(() {
      _busyRow = e.id;
      _rowErrors.remove(e.id);
    });
    try {
      final updated = await DisputeService.completeEvidence(widget.disputeId, e.id);
      if (mounted) setState(() => _dispute = updated);
      _announce('${e.displayName} attached.');
    } catch (err) {
      if (!mounted) return;
      setState(() => _rowErrors[e.id] = _codeOf(err) == 'evidence_not_uploaded'
          ? 'This upload didn’t finish. Remove it and add the file again.'
          : _messageOf(err, 'We couldn’t check this file.'));
      if (_erasedCodes.contains(_codeOf(err))) _refresh();
    } finally {
      if (mounted) setState(() => _busyRow = null);
    }
  }

  Future<void> _remove(String evidenceId, String name, [_LocalUpload? local]) async {
    setState(() => _busyRow = evidenceId);
    try {
      final updated = await DisputeService.removeEvidence(widget.disputeId, evidenceId);
      if (!mounted) return;
      setState(() {
        _dispute = updated;
        if (local != null) _uploads.remove(local);
        _rowErrors.remove(evidenceId);
      });
      _announce('$name removed.');
    } catch (e) {
      if (mounted) setState(() => _rowErrors[evidenceId] = _messageOf(e, 'We couldn’t remove this file.'));
    } finally {
      if (mounted) setState(() => _busyRow = null);
    }
  }

  Future<void> _refresh() async {
    try {
      final d = await DisputeService.getDispute(widget.disputeId);
      if (mounted) setState(() => _dispute = d);
    } catch (_) {/* the next action will surface any problem */}
  }

  // --- Draft actions ----------------------------------------------------------------

  Future<void> _sendDispute() async {
    setState(() => _busyAction = 'send');
    try {
      await DisputeService.submitDispute(widget.disputeId);
      if (!mounted) return;
      _announce('Dispute sent. The bureau must respond within 20 business days.');
      Navigator.pop(context, true);
    } catch (e) {
      _announce(_messageOf(e, 'We couldn’t send your dispute.'));
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this draft?'),
        content: const Text('It hasn’t been sent, and you can’t get it back. Any files you attached are deleted too.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep draft')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: CrediSyncColors.light.alertError),
            child: const Text('Delete draft'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busyAction = 'delete');
    try {
      await DisputeService.deleteDraft(widget.disputeId);
      if (!mounted) return;
      _announce('Draft deleted.');
      Navigator.pop(context, true);
    } catch (e) {
      _announce(_messageOf(e, 'We couldn’t delete your draft.'));
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  // --- UI -------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).extension<CrediSyncColors>() ?? CrediSyncColors.light;
    final d = _dispute;

    return Scaffold(
      backgroundColor: c.bgBase,
      appBar: AppBar(title: const Text('Check your dispute letter'), backgroundColor: Colors.transparent, elevation: 0),
      body: _loadError != null
          ? _LoadFailed(message: _loadError!, onRetry: d == null ? _load : null, colors: c)
          : d == null
              ? Center(child: CircularProgressIndicator(color: c.brandPrimary))
              : _body(d, c),
    );
  }

  Widget _body(Dispute d, CrediSyncColors c) {
    final bureau = _bureauLabels[d.bureau] ?? d.bureau;
    final busy = _busyAction != null;
    final full = _slotsUsed >= maxEvidenceFiles;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'This is what we’ll send to $bureau. The bureau must respond within 20 business days of receiving it.',
            style: TextStyle(color: c.textSecondary, fontSize: 14),
          ),
          const SizedBox(height: 12),
          Container(
            constraints: const BoxConstraints(maxHeight: 360),
            decoration: BoxDecoration(
              color: c.bgSurface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: c.borderDefault),
            ),
            child: Scrollbar(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: SelectableText(d.letterContent ?? '', style: TextStyle(color: c.textSecondary, fontSize: 13, height: 1.5)),
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text('Supporting documents', style: TextStyle(color: c.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(
            'Optional. Add proof such as a paid-up letter or statement. PDF, JPEG or PNG, up to 10 MB each, $maxEvidenceFiles files at most.',
            style: TextStyle(color: c.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 12),
          if (_verified.isNotEmpty || _orphans.isNotEmpty || _uploads.isNotEmpty)
            Container(
              decoration: BoxDecoration(
                color: c.bgSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: c.borderDefault),
              ),
              child: Column(
                children: [
                  for (final e in _verified)
                    _FileRow(
                      colors: c,
                      name: e.displayName,
                      meta: formatFileSize(e.sizeBytes),
                      error: _rowErrors[e.id],
                      actions: [
                        _RowAction('Remove', danger: true, enabled: !busy && _busyRow != e.id, onTap: () => _remove(e.id, e.displayName)),
                      ],
                    ),
                  for (final e in _orphans)
                    _FileRow(
                      colors: c,
                      name: e.displayName,
                      meta: '${formatFileSize(e.sizeBytes)} · Upload didn’t finish',
                      warn: true,
                      error: _rowErrors[e.id],
                      actions: [
                        _RowAction('Retry', enabled: !busy && _busyRow != e.id, onTap: () => _resume(e)),
                        _RowAction('Remove', danger: true, enabled: !busy && _busyRow != e.id, onTap: () => _remove(e.id, e.displayName)),
                      ],
                    ),
                  for (final u in _uploads)
                    _FileRow(
                      colors: c,
                      name: u.name,
                      meta: switch (u.phase) {
                        _Phase.uploading => '${formatFileSize(u.size)} · Uploading ${(u.progress * 100).round()}%',
                        _Phase.verifying => '${formatFileSize(u.size)} · Checking file…',
                        _Phase.failed => formatFileSize(u.size),
                      },
                      warn: u.phase == _Phase.failed,
                      error: u.error,
                      progress: u.phase == _Phase.uploading ? u.progress : null,
                      actions: [
                        if (u.phase == _Phase.failed && u.evidenceId != null)
                          _RowAction('Retry', enabled: !busy, onTap: () => _retry(u)),
                        if (u.phase == _Phase.failed)
                          u.evidenceId != null
                              ? _RowAction('Remove',
                                  danger: true,
                                  enabled: !busy && _busyRow != u.evidenceId,
                                  onTap: () => _remove(u.evidenceId!, u.name, u))
                              : _RowAction('Dismiss', onTap: () => setState(() => _uploads.remove(u))),
                      ],
                    ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: busy || full ? null : _chooseSource,
              icon: const Icon(Icons.attach_file),
              label: Text(full ? 'File limit reached' : (_evidence.isEmpty && _uploads.isEmpty ? 'Add a file' : 'Add another file')),
              style: OutlinedButton.styleFrom(
                foregroundColor: c.brandPrimary,
                minimumSize: const Size(44, 48),
                side: BorderSide(color: c.borderDefault),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(height: 32),
          if (_uploadsPending) ...[
            Text('Finish or remove your uploads before sending.', style: TextStyle(color: c.textSecondary, fontSize: 13)),
            const SizedBox(height: 8),
          ],
          FilledButton(
            onPressed: busy || _uploadsPending ? null : _sendDispute,
            style: FilledButton.styleFrom(
              backgroundColor: c.brandPrimary,
              minimumSize: const Size.fromHeight(52),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: _busyAction == 'send'
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text('Send to $bureau', style: const TextStyle(fontSize: 16)),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: busy ? null : () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: c.textMuted, minimumSize: const Size.fromHeight(48)),
            child: const Text('Keep as draft'),
          ),
          TextButton(
            onPressed: busy ? null : _confirmDelete,
            style: TextButton.styleFrom(foregroundColor: c.alertError, minimumSize: const Size.fromHeight(48)),
            child: _busyAction == 'delete'
                ? SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: c.alertError))
                : const Text('Delete draft'),
          ),
        ],
      ),
    );
  }
}

class _RowAction {
  final String label;
  final bool danger;
  final bool enabled;
  final VoidCallback onTap;
  const _RowAction(this.label, {this.danger = false, this.enabled = true, required this.onTap});
}

class _FileRow extends StatelessWidget {
  final CrediSyncColors colors;
  final String name;
  final String meta;
  final String? error;
  final bool warn;
  final double? progress;
  final List<_RowAction> actions;

  const _FileRow({
    required this.colors,
    required this.name,
    required this.meta,
    this.error,
    this.warn = false,
    this.progress,
    this.actions = const [],
  });

  @override
  Widget build(BuildContext context) {
    final c = colors;
    return Container(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.borderSubtle))),
      padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Semantics(
              liveRegion: progress != null || error != null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Names come from the user's device: plain Text, never interpreted.
                  Text(name, style: TextStyle(color: c.textPrimary, fontSize: 14, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 2),
                  Text(meta, style: TextStyle(color: warn ? c.alertWarning : c.textMuted, fontSize: 12)),
                  if (progress != null) ...[
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: progress,
                        minHeight: 6,
                        color: c.brandPrimary,
                        backgroundColor: c.bgMuted,
                        semanticsLabel: 'Uploading $name',
                      ),
                    ),
                  ],
                  if (error != null) ...[
                    const SizedBox(height: 4),
                    Text(error!, style: TextStyle(color: c.alertError, fontSize: 12, fontWeight: FontWeight.w500)),
                  ],
                ],
              ),
            ),
          ),
          for (final a in actions)
            TextButton(
              onPressed: a.enabled ? a.onTap : null,
              style: TextButton.styleFrom(
                foregroundColor: a.danger ? c.alertError : c.brandPrimary,
                minimumSize: const Size(48, 48),
                padding: const EdgeInsets.symmetric(horizontal: 10),
              ),
              child: Text(a.label, semanticsLabel: '${a.label} $name'),
            ),
        ],
      ),
    );
  }
}

class _LoadFailed extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final CrediSyncColors colors;

  const _LoadFailed({required this.message, required this.onRetry, required this.colors});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center, style: TextStyle(color: colors.textSecondary)),
            const SizedBox(height: 16),
            if (onRetry != null)
              OutlinedButton(onPressed: onRetry, style: OutlinedButton.styleFrom(minimumSize: const Size(44, 48)), child: const Text('Try again'))
            else
              TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Back to your disputes')),
          ],
        ),
      ),
    );
  }
}
