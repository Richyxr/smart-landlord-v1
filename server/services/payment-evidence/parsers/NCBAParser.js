import { StatementParser } from './StatementParser.js';

export class NCBAParser extends StatementParser {
  constructor() {
    super('NCBA', '1.0.0');
  }

  supports(document) {
    const text = String(document.text || '').toLowerCase();
    const filename = String(document.filename || '').toLowerCase();
    const headers = (document.headers || []).map(h => String(h).toLowerCase());

    const content = text + ' ' + filename + ' ' + headers.join(' ');
    
    let confidence = 0.0;
    if (/loop ref|via ncba|wltbnk|customer number/i.test(content)) {
      confidence += 0.70;
    }
    if (content.includes('account statement') && content.includes('loop')) {
      confidence += 0.25;
    }

    return { supported: confidence >= 0.80, confidence: Math.min(confidence, 1.0) };
  }

  normalize(rawRows, fileType) {
    const parsedRows = [];
    let index = 1;

    for (const row of rawRows) {
      const line = String(row.line || '').trim();
      if (!line) continue;

      const codeMatch = line.match(/\b([A-Z0-9]{8,12})\b/);
      if (!codeMatch) continue;

      const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/);
      if (!dateMatch) continue;

      const numbers = line.match(/\b\d+(?:,\d{3})*(?:\.\d{2})?\b/g);
      if (!numbers || numbers.length < 2) continue;

      const amount = parseFloat(numbers[0].replace(/,/g, ''));
      const direction = line.toLowerCase().includes('payment in') || line.toLowerCase().includes('credit') ? 'money_in' : 'money_out';

      parsedRows.push({
        row_index: index++,
        transactionDate: this.normalizeDate(dateMatch[1]),
        valueDate: this.normalizeDate(dateMatch[1]),
        description: line,
        reference: codeMatch[1].toUpperCase(),
        payer_name: null,
        payer_phone: null,
        debitAmount: direction === 'money_out' ? amount : null,
        creditAmount: direction === 'money_in' ? amount : null,
        runningBalance: null,
        normalizedAmount: direction === 'money_in' ? amount : -amount,
        transactionType: direction === 'money_in' ? 'credit' : 'debit',
        currency: 'KES',
        confidenceScore: 85,
        rawRow: { line },
        validationFlags: []
      });
    }

    return parsedRows;
  }
}
