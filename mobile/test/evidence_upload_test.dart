import 'dart:io';
import 'dart:typed_data';

import 'package:credisync_mobile/services/dispute_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late HttpServer server;
  late HttpRequest Function() lastRequest;
  late List<int> received;
  int status = 200;

  setUp(() async {
    status = 200;
    HttpRequest? last;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    lastRequest = () => last!;
    server.listen((req) async {
      last = req;
      received = [for (final chunk in await req.toList()) ...chunk];
      req.response.statusCode = status;
      await req.response.close();
    });
  });

  tearDown(() => server.close(force: true));

  EvidenceUpload link() => EvidenceUpload(
        const DisputeEvidence(id: 'e1', displayName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 3, status: 'pending'),
        'http://127.0.0.1:${server.port}/bucket/uploads/k.pdf?X-Amz-Signature=abc',
        const {'Content-Type': 'application/pdf', 'If-None-Match': '*'},
      );

  test('PUTs the bytes with the signed headers, never a bearer token, reporting progress', () async {
    final bytes = Uint8List.fromList(List.generate(200 * 1024, (i) => i % 251));
    final progress = <double>[];
    await DisputeService.putEvidence(link(), bytes, progress.add);

    final req = lastRequest();
    expect(req.method, 'PUT');
    expect(req.uri.queryParameters['X-Amz-Signature'], 'abc');
    expect(req.headers.value('content-type'), 'application/pdf');
    expect(req.headers.value('if-none-match'), '*');
    expect(req.headers.value('authorization'), isNull);
    expect(req.headers.contentLength, bytes.length);
    expect(received, bytes);
    expect(progress.length, greaterThan(1));
    expect(progress.last, 1.0);
  });

  test('a storage rejection becomes EvidenceUploadFailed', () async {
    status = 403;
    expect(
      () => DisputeService.putEvidence(link(), Uint8List.fromList([1, 2, 3]), (_) {}),
      throwsA(isA<EvidenceUploadFailed>()),
    );
  });

  test('an unreachable store becomes EvidenceUploadFailed', () async {
    final evidence = link().evidence;
    final port = server.port;
    await server.close(force: true);
    final dead = EvidenceUpload(evidence, 'http://127.0.0.1:$port/x', const {});
    expect(
      () => DisputeService.putEvidence(dead, Uint8List.fromList([1]), (_) {}),
      throwsA(isA<EvidenceUploadFailed>()),
    );
  });
}
