import PDFDocument from 'pdfkit';
import { buildAgreement } from './agreementService.js';

// The loan agreement as a PDF. Before it is signed it is marked as a draft; after, it carries the signature record.
const METHOD_TEXT = { click: 'Accepted in the LIFC app (tick-box confirmation)', otp: 'Signed with a one-time code sent to the borrower\'s registered mobile number', aadhaar: 'Signed with Aadhaar eSign' };

export function agreementPdf(loan, user, acceptance = null) {
  const agreement = acceptance ? { text: acceptance.text, hash: acceptance.hash, version: acceptance.version } : buildAgreement(loan, user);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 56, right: 56 }, info: { Title: `Loan agreement ${loan._id}`, Author: 'LIFC' }, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lines = String(agreement.text).split('\n');
    doc.font('Helvetica-Bold').fontSize(15).text(lines[0] || 'LOAN AGREEMENT', { align: 'left' });
    doc.moveDown(0.6);
    for (const line of lines.slice(1)) {
      if (!line.trim()) { doc.moveDown(0.5); continue; }
      const heading = /^\d+\.\s+[A-Z][A-Z ,&-]+$/.test(line);
      doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 10.5 : 9.5).text(line, { lineGap: 2 });
    }

    doc.moveDown(1.2);
    if (doc.y > 650) doc.addPage();
    const y = doc.y;
    doc.rect(56, y, 483, acceptance ? 118 : 46).lineWidth(0.8).stroke(acceptance ? '#166534' : '#9CA3AF');
    doc.font('Helvetica-Bold').fontSize(10).fillColor(acceptance ? '#166534' : '#6B7280').text(acceptance ? 'ELECTRONICALLY SIGNED' : 'DRAFT - NOT YET SIGNED', 66, y + 10);
    doc.font('Helvetica').fontSize(9).fillColor('#111827');
    if (acceptance) {
      const sig = acceptance.signature || {};
      doc.text(`Signed by: ${user.firstName} ${user.lastName}`, 66, y + 26);
      doc.text(`Date and time: ${new Date(acceptance.acceptedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (India time)`, 66, y + 40);
      doc.text(`Method: ${METHOD_TEXT[acceptance.method] || acceptance.method}${sig.test ? ' (TEST, not a real signature)' : ''}`, 66, y + 54, { width: 460 });
      if (sig.providerRef) doc.text(`Signing reference: ${sig.providerRef}${sig.certificateId ? `, certificate ${sig.certificateId}` : ''}`, 66, y + 68, { width: 460 });
      doc.text(`Device address: ${acceptance.ip || 'not recorded'}`, 66, y + 82);
      doc.fontSize(8).fillColor('#6B7280').text(`Document fingerprint (SHA-256): ${agreement.hash}`, 66, y + 98, { width: 460 });
    } else {
      doc.text('This copy has not been signed. Open the loan in the LIFC app to read and sign it.', 66, y + 26, { width: 460 });
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(`Loan ${loan._id}  -  page ${i + 1} of ${range.count}`, 56, 800, { align: 'center', width: 483, lineBreak: false });
    }
    doc.end();
  });
}

export default { agreementPdf };
