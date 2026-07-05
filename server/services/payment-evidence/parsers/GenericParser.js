import { StatementParser } from './StatementParser.js';

export class GenericParser extends StatementParser {
  constructor() {
    super('Generic', '1.0.0');
  }

  supports(document) {
    const text = String(document.text || '').toLowerCase();
    const filename = String(document.filename || '').toLowerCase();
    const headers = (document.headers || []).map(h => String(h).toLowerCase());

    const content = text + ' ' + filename + ' ' + headers.join(' ');
    
    // Check if there are generic statement keywords
    let confidence = 0.0;
    if (headers.some(h => /(date|amount|balance|debit|credit|description|narration|ref|code)/.test(h))) {
      confidence = 0.50;
    } else if (/(value date|transaction date|particulars|description|debit|credit|balance|date|amount|ref|code)/i.test(content)) {
      confidence = 0.40;
    }

    return { supported: confidence > 0, confidence };
  }

  normalize(rawRows, fileType) {
    const normalized = [];

    if (fileType === 'CSV') {
      for (const row of rawRows) {
        const { headers, cols, line, index } = row;
        const getVal = (patterns) => {
          const idx = headers.findIndex(h => patterns.some(p => p.test(h)));
          return idx !== -1 ? cols[idx] : null;
        };

        const dateVal = getVal([/date/i]);
        const debitVal = getVal([/debit/i, /withdrawal/i, /money_out/i]);
        const creditVal = getVal([/credit/i, /deposit/i, /money_in/i, /amount/i, /value/i, /sum/i]);
        const balanceVal = getVal([/balance/i]);
        const codeVal = getVal([/code/i, /ref/i, /receipt/i, /id/i]);
        const descVal = getVal([/desc/i, /narration/i, /particulars/i]) || line;

        let debitAmount = debitVal ? parseFloat(String(debitVal).replace(/,/g, '')) : null;
        let creditAmount = creditVal ? parseFloat(String(creditVal).replace(/,/g, '')) : null;
        let runningBalance = balanceVal ? parseFloat(String(balanceVal).replace(/,/g, '')) : null;

        if (isNaN(debitAmount)) debitAmount = null;
        if (isNaN(creditAmount)) creditAmount = null;
        if (isNaN(runningBalance)) runningBalance = null;

        const validationFlags = [];
        if (debitAmount !== null && creditAmount !== null && debitAmount !== 0 && creditAmount !== 0) {
          validationFlags.push('invalid_both_debit_credit');
        }
        if (debitAmount === null && creditAmount === null) {
          validationFlags.push('incomplete_no_amount');
        }

        const normDate = this.normalizeDate(dateVal);
        if (!normDate) {
          validationFlags.push('missing_date');
        }

        let normalizedAmount = 0;
        let transactionType = 'unknown';
        if (creditAmount !== null && creditAmount > 0) {
          normalizedAmount = creditAmount;
          transactionType = 'credit';
        } else if (debitAmount !== null && debitAmount > 0) {
          normalizedAmount = -debitAmount;
          transactionType = 'debit';
        } else if (creditAmount !== null) {
          normalizedAmount = creditAmount;
          transactionType = creditAmount >= 0 ? 'credit' : 'debit';
        }

        normalized.push({
          row_index: index,
          transactionDate: normDate,
          valueDate: normDate,
          description: descVal || 'CSV Row',
          reference: codeVal ? String(codeVal).toUpperCase() : null,
          debitAmount,
          creditAmount,
          runningBalance,
          normalizedAmount,
          transactionType,
          currency: 'KES',
          confidenceScore: normDate && codeVal ? 80 : 50,
          rawRow: { raw: line },
          validationFlags
        });
      }
    } else if (fileType === 'XLSX' || fileType === 'XLS') {
      let index = 1;
      for (const row of rawRows) {
        const getVal = (patterns) => {
          const key = Object.keys(row).find(k => patterns.some(p => p.test(k)));
          return key ? row[key] : null;
        };

        const dateVal = getVal([/date/i]);
        const debitVal = getVal([/debit/i, /withdrawal/i]);
        const creditVal = getVal([/credit/i, /deposit/i, /amount/i, /value/i, /sum/i]);
        const balanceVal = getVal([/balance/i]);
        const codeVal = getVal([/code/i, /ref/i, /receipt/i, /id/i]);
        const descVal = getVal([/desc/i, /narration/i, /particulars/i]) || JSON.stringify(row);

        let debitAmount = debitVal ? parseFloat(String(debitVal).replace(/,/g, '')) : null;
        let creditAmount = creditVal ? parseFloat(String(creditVal).replace(/,/g, '')) : null;
        let runningBalance = balanceVal ? parseFloat(String(balanceVal).replace(/,/g, '')) : null;

        if (isNaN(debitAmount)) debitAmount = null;
        if (isNaN(creditAmount)) creditAmount = null;
        if (isNaN(runningBalance)) runningBalance = null;

        const validationFlags = [];
        if (debitAmount !== null && creditAmount !== null && debitAmount !== 0 && creditAmount !== 0) {
          validationFlags.push('invalid_both_debit_credit');
        }
        if (debitAmount === null && creditAmount === null) {
          validationFlags.push('incomplete_no_amount');
        }

        const normDate = this.normalizeDate(dateVal);
        if (!normDate) {
          validationFlags.push('missing_date');
        }

        let normalizedAmount = 0;
        let transactionType = 'unknown';
        if (creditAmount !== null && creditAmount > 0) {
          normalizedAmount = creditAmount;
          transactionType = 'credit';
        } else if (debitAmount !== null && debitAmount > 0) {
          normalizedAmount = -debitAmount;
          transactionType = 'debit';
        } else if (creditAmount !== null) {
          normalizedAmount = creditAmount;
          transactionType = creditAmount >= 0 ? 'credit' : 'debit';
        }

        normalized.push({
          row_index: index++,
          transactionDate: normDate,
          valueDate: normDate,
          description: descVal || 'Excel Row',
          reference: codeVal ? String(codeVal).toUpperCase() : null,
          debitAmount,
          creditAmount,
          runningBalance,
          normalizedAmount,
          transactionType,
          currency: 'KES',
          confidenceScore: normDate && codeVal ? 90 : 50,
          rawRow: row,
          validationFlags
        });
      }
    } else {
      let index = 1;
      for (const row of rawRows) {
        const line = String(row.line || '').trim();
        if (!line) continue;

        const dateMatch = line.match(/(\d{4}[-/]\d{2}[-/]\d{2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
        const dateVal = dateMatch ? dateMatch[0] : null;
        const normDate = this.normalizeDate(dateVal);

        const amountMatches = line.match(/(?:kes|shs|amt|sum)?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
        let normalizedAmount = 0;
        let transactionType = 'unknown';
        let debitAmount = null;
        let creditAmount = null;

        if (amountMatches) {
          const val = parseFloat(amountMatches[1].replace(/,/g, ''));
          if (!isNaN(val)) {
            normalizedAmount = val;
            if (val >= 0) {
              creditAmount = val;
              transactionType = 'credit';
            } else {
              debitAmount = Math.abs(val);
              transactionType = 'debit';
            }
          }
        }

        const refMatch = line.match(/(?:ref|receipt|code|refno)\s*[:\-\s]*([A-Z0-9]{8,12})/i);
        const codeVal = refMatch ? refMatch[1] : null;

        const validationFlags = [];
        if (!normDate) {
          validationFlags.push('missing_date');
        }
        if (normalizedAmount === 0) {
          validationFlags.push('incomplete_no_amount');
        }

        normalized.push({
          row_index: index++,
          transactionDate: normDate,
          valueDate: normDate,
          description: line,
          reference: codeVal ? String(codeVal).toUpperCase() : null,
          debitAmount,
          creditAmount,
          runningBalance: null,
          normalizedAmount,
          transactionType,
          currency: 'KES',
          confidenceScore: normDate && codeVal ? 70 : 40,
          rawRow: { line },
          validationFlags
        });
      }
    }

    return normalized;
  }
}
