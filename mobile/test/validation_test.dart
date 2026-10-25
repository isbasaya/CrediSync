import 'package:credisync_mobile/services/auth_service.dart';
import 'package:credisync_mobile/theme/app_theme.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('isValidSaIdNumber', () {
    test('accepts a valid ID, with or without spaces', () {
      expect(isValidSaIdNumber('8001015009087'), isTrue);
      expect(isValidSaIdNumber('800101 5009 087'), isTrue);
    });

    test('rejects a bad check digit or wrong length', () {
      expect(isValidSaIdNumber('8001015009088'), isFalse);
      expect(isValidSaIdNumber('80010150090'), isFalse);
    });
  });

  group('AccountStatus.fromApi', () {
    test('maps every database value, and anything else to unknown', () {
      expect(AccountStatus.fromApi('default'), AccountStatus.defaulted);
      expect(AccountStatus.fromApi('written_off'), AccountStatus.writtenOff);
      expect(AccountStatus.fromApi('something_new'), AccountStatus.unknown);
      expect(AccountStatusTheme.values.keys, containsAll(AccountStatus.values));
    });
  });
}
