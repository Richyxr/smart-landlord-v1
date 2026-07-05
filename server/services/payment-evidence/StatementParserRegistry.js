import XLSX from 'xlsx';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import crypto from 'crypto';

export class StatementParserRegistry {
  /**
   * Detects the provider/source of the statement from content heuristics or headers.
   */
  static detectProvider(file, extractedText = '', sheetHeaders = []) {
    const filename = String(file?.filename || '').toLowerCase();
    const content = (String(extractedText || '') + ' ' + filename + ' ' + sheetHeaders.join(' ')).toLowerCase();

    // Check M-Pesa keywords
    if (/m-pesa|completion time|receipt no|paid in|withdrawn|pay bill|till number/i.test(content)) {
      return 'MPESA';
    }
    // Check Loop
    if (/loop ref|via ncba|wltbnk|customer number/i.test(content)) {
      return 'LOOP_STATEMENT';
    }
    // Check Co-op
    if (/co-operative bank|coop bank|statement of account|kcookena/i.test(content)) {
      return 'COOP';
    }
    // Check KCB
    if (/kenya commercial bank|kcb/i.test(content)) {
      return 'KCB';
    }
    // Check Equity
    if (/equity bank|equity/i.test(content)) {
      return 'EQUITY';
    }
    // Check Absa
    if (/absa|barclays/i.test(content)) {
      return 'ABSA';
    }
    // Check Family Bank
    if (/family bank/i.test(content)) {
      return 'FAMILY_BANK';
    }
    // Check I&M
    if (/i&m bank|i\&m/i.test(content)) {
      return 'IM_BANK';
    }
    // Check DTB
    if (/diamond trust bank|dtb/i.test(content)) {
      return 'DTB_BANK';
    }

    // Default if we have general statement indicators
    if (/value date|transaction date|particulars|description|debit|credit|balance/i.test(content)) {
      return 'generic_bank_statement';
    }

    return 'generic_bank_statement';
  }

  /**
   * Parses the file buffer based on the file type.
   */
  static async parse(file) {
    try {
      const ext = String(file.filename || '').toLowerCase().split('.').pop();
      const buffer = file.buffer;

      if (!buffer || buffer.length === 0) {
        throw new Error('File buffer is empty.');
      }

      let rawText = '';
      let rawRows = [];

      if (ext === 'csv') {
        const text = buffer.toString('utf8');
        rawText = text;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const headers = lines[0].split(',').map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
          const dataLines = lines.slice(1);
          rawRows = dataLines.map((line, idx) => {
            const cols = line.split(',').map(c => c.replace(/^["']|["']$/g, '').trim());
            return { headers, cols, line, index: idx + 1 };
          });
        } else {
          throw new Error('CSV file contains no lines.');
        }
      } else if (ext === 'xlsx' || ext === 'xls') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('Workbook contains no sheets.');
        }
        const sheet = workbook.Sheets[sheetName];
        rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rawRows.length === 0) {
          throw new Error('Excel sheet contains no data rows.');
        }
        rawText = JSON.stringify(rawRows);
      } else if (ext === 'pdf') {
        try {
          const pdfData = await pdfParse(buffer);
          rawText = pdfData.text || '';
        } catch (err) {
          throw new Error('Failed to parse PDF file structure.');
        }
        if (!rawText || rawText.trim().length === 0) {
          throw new Error('No text layer could be extracted from this PDF statement. It might be scanned or image-based.');
        }
        // Simple fallback line parse for PDF text content
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        rawRows = lines.map((line, idx) => ({ line, index: idx + 1 }));
      } else if (ext === 'txt') {
        const text = buffer.toString('utf8');
        rawText = text;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        rawRows = lines.map((line, idx) => ({ line, index: idx + 1 }));
      } else {
        throw new Error(`Unsupported file extension: ${ext}`);
      }

      return { rawRows, rawText };
    } catch (err) {
      throw new Error(`Statement parsing failed: ${err.message}`);
    }
  }

  /**
   * Helper to normalize dates to YYYY-MM-DD
   */
  static normalizeDate(dateStr) {
    if (!dateStr) return null;
    const clean = String(dateStr).trim().replace(/\s+/g, ' ');

    const isoMatch = clean.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
    }

    try {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch (_) {}

    return null;
  }

  /**
   * Standardizes raw rows into the normalized transaction schema.
   */
  static normalize(rawRows, fileType, provider) {
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

        // Standard rules:
        // normalizedAmount is positive for credits, negative for debits
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
          confidenceScore: normDate && codeVal ? 90 : 50,
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
      // PDF or TXT unstructured parsing fallback
      let index = 1;
      for (const row of rawRows) {
        const line = String(row.line || '').trim();
        if (!line) continue;

        // Try to parse transaction date from line: e.g. 2026-06-20 or 20/06/2026
        const dateMatch = line.match(/(\d{4}[-/]\d{2}[-/]\d{2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
        const dateVal = dateMatch ? dateMatch[0] : null;
        const normDate = this.normalizeDate(dateVal);

        // Try to parse amount (positive or negative decimal)
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

        // Reference: alphanumeric code e.g. TX12345 or loop ref
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

  /**
   * Deterministic validation checks
   */
  static async validate(normalizedRows, orgId, activeDb) {
    // 1. Balance continuity
    let lastRunningBalance = null;
    for (const row of normalizedRows) {
      if (row.runningBalance !== null && row.runningBalance !== undefined) {
        if (lastRunningBalance !== null) {
          const expected = lastRunningBalance + row.normalizedAmount;
          if (Math.abs(expected - row.runningBalance) > 0.01) {
            row.validationFlags.push('running_balance_mismatch');
          }
        }
        lastRunningBalance = row.runningBalance;
      }
    }

    // 2. Load existing confirmed transactions to check duplicates
    const confirmed = await activeDb.find('confirmed_statement_transactions', { organization_id: orgId });
    const existingSourceHashes = new Set(confirmed.map(c => c.source_hash));

    // Keep track of source hashes seen in the current upload block to flag duplicates
    const seenSourceHashes = new Set();

    for (const row of normalizedRows) {
      if (row.validationFlags.includes('missing_date') || row.validationFlags.includes('incomplete_no_amount')) {
        continue;
      }

      // Compute row source hash
      const cleanAmount = Number(row.normalizedAmount || 0);
      const cleanDate = row.transactionDate instanceof Date
        ? `${row.transactionDate.getFullYear()}-${String(row.transactionDate.getMonth() + 1).padStart(2, '0')}-${String(row.transactionDate.getDate()).padStart(2, '0')}`
        : String(row.transactionDate).split('T')[0];
      const sourceHashStr = `${cleanDate}_${cleanAmount}_${row.reference || ''}_${row.description}`;
      const sourceHash = crypto
        .createHash('sha256')
        .update(sourceHashStr)
        .digest('hex');

      row.sourceHash = sourceHash;

      // Duplicate detection
      const isDuplicateInDb = existingSourceHashes.has(sourceHash);
      const isDuplicateInUpload = seenSourceHashes.has(sourceHash);

      if (isDuplicateInDb || isDuplicateInUpload) {
        row.duplicate_candidate = true;
        row.validationFlags.push('duplicate_row');
      } else {
        seenSourceHashes.add(sourceHash);
      }
    }

    return normalizedRows;
  }
}
