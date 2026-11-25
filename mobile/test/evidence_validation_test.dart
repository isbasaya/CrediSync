import 'package:credisync_mobile/services/evidence_validation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('validateEvidence', () {
    for (final type in evidenceContentTypes) {
      test('accepts $type at exactly 10 MB', () {
        expect(validateEvidence(type, maxEvidenceBytes, 0), isNull);
      });
    }

    test('rejects one byte over 10 MB', () {
      expect(validateEvidence('application/pdf', maxEvidenceBytes + 1, 0), 'Files must be smaller than 10 MB');
    });

    test('rejects empty files and other types', () {
      expect(validateEvidence('application/pdf', 0, 0), 'This file is empty');
      for (final type in ['application/x-msdownload', 'image/gif', '']) {
        expect(validateEvidence(type, 100, 0), 'Upload a PDF, JPEG or PNG file');
      }
    });

    test('rejects an 11th file', () {
      expect(validateEvidence('image/png', 100, maxEvidenceFiles - 1), isNull);
      expect(validateEvidence('image/png', 100, maxEvidenceFiles), 'You can attach up to 10 files');
    });
  });

  group('contentTypeForName', () {
    test('maps known extensions, case-insensitively, and nothing else', () {
      expect(contentTypeForName('Statement.PDF'), 'application/pdf');
      expect(contentTypeForName('photo.jpeg'), 'image/jpeg');
      expect(contentTypeForName('photo.JPG'), 'image/jpeg');
      expect(contentTypeForName('scan.png'), 'image/png');
      expect(contentTypeForName('setup.exe'), '');
      expect(contentTypeForName('noextension'), '');
    });
  });

  group('formatFileSize', () {
    test('formats bytes, KB and MB', () {
      expect(formatFileSize(512), '512 B');
      expect(formatFileSize(1536), '1.5 KB');
      expect(formatFileSize(10 * 1024 * 1024), '10 MB');
      expect(formatFileSize((2.25 * 1024 * 1024).round()), '2.3 MB');
    });
  });
}
