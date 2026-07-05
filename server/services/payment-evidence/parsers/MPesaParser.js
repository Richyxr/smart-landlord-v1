import { StatementParser } from './StatementParser.js';

export class MPesaParser extends StatementParser {
  constructor() {
    super('MPesa', '1.0.0');
  }

  supports(document) {
    const text = String(document.text || '').toLowerCase();
    const filename = String(document.filename || '').toLowerCase();
    const headers = (document.headers || []).map(h => String(h).toLowerCase());

    const content = text + ' ' + filename + ' ' + headers.join(' ');
    
    let confidence = 0.0;
    if (/m-pesa|completion time|receipt no|paid in|withdrawn|pay bill|till number/i.test(content)) {
      confidence += 0.60;
    }
    if (content.includes('safaricom')) {
      confidence += 0.20;
    }
    if (content.includes('mpesa')) {
      confidence += 0.18;
    }

    return { supported: confidence >= 0.80, confidence: Math.min(confidence, 1.0) };
  }

  normalize(rawRows, fileType) {
    // If it's a PDF statement, we parse safaricom format line by line
    const parsedRows = [];
    let index = 1;

    for (const row of rawRows) {
      const line = String(row.line || '').trim();
      if (!line) continue;

      // Example line format: "RFG2P3Q98M 2026-06-04 10:55:00 Customer Transfer Paid In KES 30,000.00 ..."
      const codeMatch = line.match(/\b([A-Z0-9]{10})\b/);
      if (!codeMatch) continue;

      const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (!dateMatch) continue;

      const timeMatch = line.match(/\b(\d{2}:\d{2}:\d{2})\b/);

      // Amount extraction
      const amountMatches = line.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g);
      if (!amountMatches) continue;

      let amount = 0;
      for (const val of amountMatches) {
        const num = parseFloat(val.replace(/,/g, ''));
        if (num > 0 && num < 10000000) {
          amount = num;
        }
      }

      const direction = line.toLowerCase().includes('paid in') || line.toLowerCase().includes('received') ? 'money_in' : 'money_out';

      let payerPhone = null;
      let payerName = null;
      
      // Match phone number
      const phoneMatch = line.match(/\b(254\d{9}|0\d{9}|\+254\d{9})\b/);
      if (phoneMatch) {
        payerPhone = phoneMatch[1];
      }

      // Match name from pattern "from <phone> - <name>" or "from <name>"
      const fromMatch = line.match(/from\s+(?:\+?254|0)?\d{9}\s*-\s*([^,\n]+)/i);
      if (fromMatch) {
        payerName = fromMatch[1].trim();
      } else {
        const fromNameOnlyMatch = line.match(/from\s+([^-\d,\n]+)/i);
        if (fromNameOnlyMatch) {
          payerName = fromNameOnlyMatch[1].trim();
        }
      }

      parsedRows.push({
        row_index: index++,
        transactionDate: dateMatch[1],
        valueDate: dateMatch[1],
        transaction_time: timeMatch ? timeMatch[1] : null,
        description: line,
        reference: codeMatch[1].toUpperCase(),
        payer_name: payerName,
        payer_phone: payerPhone,
        debitAmount: direction === 'money_out' ? amount : null,
        creditAmount: direction === 'money_in' ? amount : null,
        runningBalance: null,
        normalizedAmount: direction === 'money_in' ? amount : -amount,
        transactionType: direction === 'money_in' ? 'credit' : 'debit',
        currency: 'KES',
        confidenceScore: 90,
        rawRow: { line },
        validationFlags: []
      });
    }

    return parsedRows;
  }
}
