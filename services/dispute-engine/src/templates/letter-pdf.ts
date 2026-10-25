import PDFDocument from 'pdfkit';

export interface LetterPdfOptions {
  disputeId: string;
  /** Lodging copies carry the full ID number and are marked confidential. */
  confidential?: boolean;
}

/**
 * Renders a stored dispute letter (plain text from generateDisputeLetter)
 * to an A4 PDF. Uses the built-in Helvetica fonts so no font files ship
 * with the service; the text layout comes from the template itself.
 */
export function renderLetterPdf(letter: string, options: LetterPdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 64, right: 64 },
      bufferPages: true,
      info: {
        Title: `Credit information dispute ${options.disputeId}`,
        Author: 'CrediSync',
        Subject: 'Dispute of credit information',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#0B7A70')
      .text('CrediSync', { continued: false });
    doc.moveDown(0.2);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#6B7684')
      .text(`Dispute reference ${options.disputeId}`);
    if (options.confidential) {
      doc.moveDown(0.4);
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#B91C1C')
        .text(
          'CONFIDENTIAL — contains the consumer’s full ID number. For submission to the credit bureau only.',
        );
    }
    doc.moveDown(1.2);

    doc.fillColor('#12181F');
    for (const line of letter.split('\n')) {
      const heading =
        /^(RE:|Consumer details:|Disputed account|Ground of dispute:|Consumer's statement:)/.test(
          line,
        );
      doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5);
      if (line.trim() === '') doc.moveDown(0.6);
      else {
        // Indented lines (consumer details, numbered points) wrap with a hanging indent.
        const indented = /^\s/.test(line);
        const left = doc.page.margins.left + (indented ? 14 : 0);
        const width = doc.page.width - doc.page.margins.right - left;
        doc.text(line.trimStart(), left, doc.y, { lineGap: 2, width });
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; lift the margin so pdfkit doesn't add a page.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const bottom = doc.page.height - 48;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#6B7684')
        .text(`Page ${i + 1} of ${range.count} · ${options.disputeId}`, 64, bottom, {
          width: doc.page.width - 128,
          align: 'center',
          lineBreak: false,
        });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
