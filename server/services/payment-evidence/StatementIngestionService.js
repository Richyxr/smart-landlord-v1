import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import XLSX from 'xlsx';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { classifyPaymentEvidenceRow } from './classifyPaymentEvidenceRow.js';
import { IGNORE_KEYWORDS } from './paymentEvidenceRules.js';

/**
 * StatementIngestionService
 * Handles the ingestion, parsing, provider detection, normalization,
 * duplicate detection, and matching suggestions for bank/payment statements.
 */
export class StatementIngestionService {
  /**
   * Detects the file format from filename extension and/or binary magic bytes.
   */
  static detectFileType(filename, buffer = null) {
    if (buffer && Buffer.isBuffer(buffer) && buffer.length >= 4) {
      // PDF magic bytes: %PDF- (0x25, 0x50, 0x44, 0x46)
      if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return 'PDF';
      }
      // ZIP magic bytes: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04) -> XLSX or DOCX
      if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
        const ext = String(filename || '').toLowerCase().split('.').pop();
        if (ext === 'docx') return 'DOCX';
        return 'XLSX';
      }
      // OLE Compound File magic bytes: \xD0\xCF\x11\xE0 -> XLS or DOC
      if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
        const ext = String(filename || '').toLowerCase().split('.').pop();
        if (ext === 'doc') return 'DOC';
        return 'XLS';
      }
    }

    const ext = String(filename || '').toLowerCase().split('.').pop();
    switch (ext) {
      case 'csv': return 'CSV';
      case 'pdf': return 'PDF';
      case 'xlsx': return 'XLSX';
      case 'xls': return 'XLS';
      case 'docx': return 'DOCX';
      case 'doc': return 'DOC';
      case 'txt': return 'TXT';
      default: return 'UNKNOWN';
    }
  }

  /**
   * Helper to normalize date string to YYYY-MM-DD
   */
  static normalizeDate(dateStr) {
    if (!dateStr) return null;
    const clean = String(dateStr).trim().replace(/\s+/g, ' ');

    // YYYY-MM-DD or YYYY/MM/DD
    const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
    }

    // DD MMM YYYY or DD-MMM-YYYY (e.g. 25 Jun 2026, 25-Jun-2026)
    const monthNames = {
      jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
      apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
      aug: '08', august: '08', sep: '09', september: '09', oct: '10', october: '10',
      nov: '11', november: '11', dec: '12', december: '12'
    };
    const alphaMatch = clean.match(/^(\d{1,2})[\s/-]([A-Za-z]+)[\s/-](\d{4})/);
    if (alphaMatch) {
      const mKey = alphaMatch[2].toLowerCase();
      if (monthNames[mKey]) {
        return `${alphaMatch[3]}-${monthNames[mKey]}-${String(alphaMatch[1]).padStart(2, '0')}`;
      }
    }

    const alphaMatch2 = clean.match(/^([A-Za-z]+)[\s/-](\d{1,2})[\s/-](\d{4})/);
    if (alphaMatch2) {
      const mKey = alphaMatch2[1].toLowerCase();
      if (monthNames[mKey]) {
        return `${alphaMatch2[3]}-${monthNames[mKey]}-${String(alphaMatch2[2]).padStart(2, '0')}`;
      }
    }

    // Attempt native Date parsing
    try {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch (_) {}

    return null;
  }

  /**
   * Helper to parse currency values in Kenyan formats
   */
  static parseAmount(val) {
    if (val === null || val === undefined) return NaN;
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (!str) return NaN;
    const clean = str.replace(/KES|KSH|KSHS|UGX|TZS|\$/gi, '').replace(/\s+/g, '').replace(/,/g, '');
    return parseFloat(clean);
  }

  /**
   * Heuristic provider detection based on keyword matching
   */
  static detectProvider(text, filename) {
    const content = (String(text || '') + ' ' + String(filename || '')).toLowerCase();

    const scores = {
      MPESA: 0,
      LOOP_STATEMENT: 0,
      COOP_BANK_STATEMENT: 0,
      KCB_BANK_STATEMENT: 0,
      EQUITY_BANK_STATEMENT: 0,
      ABSA_BANK_STATEMENT: 0,
      GENERIC_BANK_STATEMENT: 0
    };

    // M-Pesa keywords
    if (/m-pesa|completion time|receipt no|paid in|withdrawn|pay bill|till|transaction cost|safaricom|mpesa/i.test(content)) scores.MPESA += 20;
    if (content.includes('safaricom')) scores.MPESA += 10;
    if (content.includes('mpesa') || content.includes('m-pesa')) scores.MPESA += 15;
    if (content.includes('receipt no')) scores.MPESA += 15;

    // Loop keywords
    if (/loop ref|via ncba|wltbnk|customer number|account statement/i.test(content)) scores.LOOP_STATEMENT += 20;
    if (content.includes('loop')) scores.LOOP_STATEMENT += 20;
    if (content.includes('ncba')) scores.LOOP_STATEMENT += 15;

    // Co-op Bank
    if (/co-operative bank|co-op bank|coop bank|statement of account|kcookena|coop house/i.test(content)) scores.COOP_BANK_STATEMENT += 25;
    if (content.includes('kcookena')) scores.COOP_BANK_STATEMENT += 20;

    // KCB Bank
    if (/kenya commercial bank|kcb/i.test(content)) scores.KCB_BANK_STATEMENT += 30;

    // Equity Bank
    if (/equity bank|equity/i.test(content)) scores.EQUITY_BANK_STATEMENT += 30;

    // Absa Bank
    if (/absa|barclays/i.test(content)) scores.ABSA_BANK_STATEMENT += 30;

    // Generic Bank indicators
    const genericMatches = (content.match(/value date|transaction date|particulars|description|debit|credit|balance|money in|money out|reference/g) || []).length;
    if (genericMatches > 0) {
      scores.GENERIC_BANK_STATEMENT += Math.min(30, genericMatches * 10);
    }

    let bestProvider = 'UNKNOWN_STATEMENT';
    let maxScore = 0;
    for (const [provider, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestProvider = provider;
      }
    }

    if (bestProvider === 'UNKNOWN_STATEMENT' && scores.GENERIC_BANK_STATEMENT >= 10) {
      bestProvider = 'GENERIC_BANK_STATEMENT';
      maxScore = scores.GENERIC_BANK_STATEMENT;
    }

    if (maxScore < 15) {
      bestProvider = 'UNKNOWN_STATEMENT';
    }

    return {
      provider: bestProvider,
      score: maxScore
    };
  }

  /**
   * Unzips docx files manually using standard Local File Headers and zlib
   */
  static extractDocxText(buffer) {
    const filename = 'word/document.xml';
    const filenameBuffer = Buffer.from(filename, 'utf8');
    const fileIdx = buffer.indexOf(filenameBuffer);
    if (fileIdx === -1) {
      throw new Error('Not a valid DOCX file: word/document.xml not found');
    }

    let headerIdx = -1;
    for (let i = fileIdx - 30; i >= 0; i--) {
      if (buffer[i] === 0x50 && buffer[i+1] === 0x4B && buffer[i+2] === 0x03 && buffer[i+3] === 0x04) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      throw new Error('Local file header signature not found for word/document.xml');
    }

    const compressionMethod = buffer.readUInt16LE(headerIdx + 8);
    const compressedSize = buffer.readUInt32LE(headerIdx + 18);
    const filenameLength = buffer.readUInt16LE(headerIdx + 26);
    const extraFieldLength = buffer.readUInt16LE(headerIdx + 28);

    const start = headerIdx + 30 + filenameLength + extraFieldLength;
    const compressedData = buffer.slice(start, start + compressedSize);

    let xmlText = '';
    if (compressionMethod === 8) {
      const decompressed = zlib.inflateRawSync(compressedData);
      xmlText = decompressed.toString('utf8');
    } else if (compressionMethod === 0) {
      xmlText = compressedData.toString('utf8');
    } else {
      throw new Error(`Unsupported DOCX compression method ${compressionMethod}`);
    }

    // Extract paragraph text content from xml
    const pRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
    const tRegex = /<w:t[^>]*>([^<]*?)<\/w:t>/g;

    let match;
    const paragraphs = [];
    while ((match = pRegex.exec(xmlText)) !== null) {
      const pContent = match[1];
      let tMatch;
      let pText = '';
      while ((tMatch = tRegex.exec(pContent)) !== null) {
        pText += tMatch[1];
      }
      if (pText.trim()) {
        paragraphs.push(pText.trim());
      }
    }

    return paragraphs.join('\n');
  }

  /**
   * Generates matching suggestions using the candidate score algorithm
   */
  static async getMatchingSuggestions(activeDb, orgId, row, allTenants, allInvoices, allUnits, allProperties) {
    if (row.direction !== 'money_in' || row.row_status === 'ignored') {
      return [];
    }

    const unitsMap = new Map(allUnits.map(u => [u.id, u]));
    const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
    const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
    const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && inv.status !== 'deleted');

    const suggestions = [];

    const normalizePhoneLocal = (phone) => {
      if (!phone) return '';
      const digits = String(phone).replace(/\D/g, '');
      return digits.slice(-9);
    };

    const getDaysDiff = (d1, d2) => {
      const date1 = new Date(d1);
      const date2 = new Date(d2);
      if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return Infinity;
      return Math.ceil(Math.abs(date1 - date2) / (1000 * 60 * 60 * 24));
    };

    for (const invoice of eligibleInvoices) {
      const tenant = activeTenants.find(t => t.id === invoice.tenant_id);
      if (!tenant) continue;

      const unit = tenant.unit_id ? unitsMap.get(tenant.unit_id) : null;
      const property = unit ? propertiesMap.get(unit.property_id) : null;

      let score = 0;
      let confidence = 'low';
      const reasons = [];
      const warnings = [];

      const amount = Number(row.amount);
      const invBalance = Number(invoice.balance);
      const invTotal = Number(invoice.total);
      const isAmountMatch = (amount === invBalance || amount === invTotal);

      // Account match
      let refAccMatch = false;
      if (row.reference_account && tenant.tenant_account_number) {
        if (row.reference_account.trim().toLowerCase() === tenant.tenant_account_number.trim().toLowerCase()) {
          refAccMatch = true;
        }
      }

      // Invoice number match
      let invNumMatch = false;
      const invNum = String(invoice.invoice_number || '').trim().toLowerCase();
      if (invNum) {
        const transCode = String(row.transaction_code || '').trim().toLowerCase();
        const narr = String(row.narration || '').trim().toLowerCase();
        if (transCode === invNum || narr.includes(invNum)) {
          invNumMatch = true;
        }
      }

      // Phone match
      let phoneMatch = false;
      if (row.payer_phone && tenant.phone_number) {
        const p1 = normalizePhoneLocal(row.payer_phone);
        const p2 = normalizePhoneLocal(tenant.phone_number);
        if (p1 && p2 && p1 === p2) {
          phoneMatch = true;
        }
      }

      // Name match
      let nameMatch = false;
      if (row.payer_name && tenant.full_name) {
        const n1 = row.payer_name.trim().toLowerCase();
        const n2 = tenant.full_name.trim().toLowerCase();
        if (n1.includes(n2) || n2.includes(n1)) {
          nameMatch = true;
        }
      }

      // Unit match
      let unitMatch = false;
      if (unit && unit.unit_code) {
        const uc = unit.unit_code.trim().toLowerCase();
        const narr = String(row.narration || '').trim().toLowerCase();
        if (narr.includes(uc)) {
          unitMatch = true;
        }
      }

      // Score evaluation
      if (refAccMatch) {
        if (isAmountMatch) {
          score = 96; confidence = 'high';
          reasons.push('Reference account matches tenant account number and amount matches invoice balance.');
        } else {
          score = 75; confidence = 'medium';
          reasons.push('Reference account matches tenant account number but amount does not match invoice balance.');
          warnings.push('Amount mismatch with matching tenant account reference.');
        }
      } else if (invNumMatch) {
        if (isAmountMatch) {
          score = 98; confidence = 'high';
          reasons.push('Invoice number matches payment reference and amount matches invoice balance.');
        } else {
          score = 75; confidence = 'medium';
          reasons.push('Invoice number matches payment reference but amount does not match invoice.');
          warnings.push('Amount mismatch with matching invoice number reference.');
        }
      } else if (phoneMatch && isAmountMatch) {
        const diffDays = getDaysDiff(row.transaction_date, invoice.due_date);
        if (diffDays <= 30) {
          score = 90; confidence = 'high';
          reasons.push('Tenant phone matches payer phone and amount matches invoice balance within date window.');
        } else {
          score = 70; confidence = 'medium';
          reasons.push('Tenant phone matches payer phone and amount matches invoice balance outside date window.');
          warnings.push('Payment date far from expected invoice due date (>30 days).');
        }
      } else if (phoneMatch) {
        score = 65; confidence = 'medium';
        reasons.push('Tenant phone matches payer phone but amount does not match invoice balance.');
        warnings.push('Amount mismatch with matching phone number.');
      } else if (unitMatch && isAmountMatch) {
        score = 80; confidence = 'medium';
        reasons.push('Unit code matches narration and amount matches invoice balance.');
      } else if (nameMatch && isAmountMatch) {
        score = 75; confidence = 'medium';
        reasons.push('Payer name matches tenant name and amount matches invoice balance.');
      } else if (nameMatch) {
        score = 40; confidence = 'low';
        reasons.push('Payer name matches tenant name but amount does not match.');
        warnings.push('Name similarity match only (amount mismatch).');
      } else if (unitMatch) {
        score = 40; confidence = 'low';
        reasons.push('Unit code matches narration but amount does not match.');
        warnings.push('Unit code match only (amount mismatch).');
      } else if (isAmountMatch) {
        score = 50; confidence = 'low';
        reasons.push('Amount matches invoice balance exactly (no other matching signals).');
        warnings.push('Amount-only match; high risk of false positive.');
      }

      if (score > 0) {
        suggestions.push({
          tenant_id: tenant.id,
          tenant_name: tenant.full_name,
          unit_id: unit ? unit.id : null,
          unit_label: unit ? `${property ? property.name + ' - ' : ''}${unit.unit_code}` : 'N/A',
          property_id: property ? property.id : null,
          property_name: property ? property.name : null,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          invoice_status: invoice.status,
          invoice_balance: Number(invoice.balance),
          confidence,
          score,
          reason: reasons.join(', '),
          warnings
        });
      }
    }

    // Sort suggestions by score descending
    suggestions.sort((a, b) => b.score - a.score);

    // Tie-break / ambiguity check
    if (suggestions.length > 1 && suggestions[0].score >= 70) {
      if (Math.abs(suggestions[0].score - suggestions[1].score) <= 5) {
        suggestions[0].warnings.push('Multiple candidate matches found with similar confidence score; manual review required.');
        suggestions[1].warnings.push('Multiple candidate matches found with similar confidence score; manual review required.');
      }
    }

    return suggestions;
  }

  /**
   * Main service runner for statement preview
   */
  static async preview(buffer, filename, orgId, activeDb) {
    const sourceFormat = this.detectFileType(filename, buffer);

    if (!buffer || buffer.length === 0) {
      return {
        success: true,
        mode: 'statement_reconciliation_preview',
        source_format: sourceFormat,
        detected_provider: 'UNKNOWN_STATEMENT',
        parser_status: 'parsed',
        financial_mutation: false,
        summary: { rows_detected: 0, rows_ready_for_review: 0, rows_needing_attention: 0, rows_ignored: 0, rows_duplicates: 0, rows_unreadable: 0 },
        preview_rows: [],
        message: 'No payment rows were extracted from this statement. Check that the file is readable and contains transaction rows.',
        safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
      };
    }

    if (sourceFormat === 'DOC') {
      return {
        success: false,
        mode: 'statement_reconciliation_preview',
        source_format: 'DOC',
        detected_provider: 'UNKNOWN_STATEMENT',
        parser_status: 'legacy_doc_not_supported',
        financial_mutation: false,
        summary: { rows_detected: 0, rows_ready_for_review: 0, rows_needing_attention: 0, rows_ignored: 0, rows_duplicates: 0, rows_unreadable: 0 },
        preview_rows: [],
        message: 'Legacy .doc format is not supported. Please convert the file to .docx or .csv.',
        safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
      };
    }

    if (sourceFormat === 'UNKNOWN') {
      return {
        success: false,
        mode: 'statement_reconciliation_preview',
        source_format: 'UNKNOWN',
        detected_provider: 'UNKNOWN_STATEMENT',
        parser_status: 'unsupported_structure',
        financial_mutation: false,
        summary: { rows_detected: 0, rows_ready_for_review: 0, rows_needing_attention: 0, rows_ignored: 0, rows_duplicates: 0, rows_unreadable: 0 },
        preview_rows: [],
        message: 'Unsupported file format or unreadable structure. Upload a CSV, PDF, XLSX, XLS, DOCX, or TXT file.',
        safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
      };
    }

    let rawText = '';
    let extractedRows = [];
    let parserStatus = 'parsed';
    let extraMetadata = {};

    try {
      if (sourceFormat === 'CSV') {
        const text = buffer.toString('utf8');
        rawText = text;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        let headers = [];
        let dataLines = [];
        if (lines.length > 0) {
          headers = lines[0].split(',').map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
          dataLines = lines.slice(1);
        }

        const dateIdx = headers.findIndex(h => /date/i.test(h));
        const amountIdx = headers.findIndex(h => /amount|value|sum|credit|paid/i.test(h));
        const codeIdx = headers.findIndex(h => /code|ref|receipt|id/i.test(h));
        const payerIdx = headers.findIndex(h => /payer|name|customer/i.test(h));
        const phoneIdx = headers.findIndex(h => /phone|mobile|msisdn/i.test(h));
        const narrationIdx = headers.findIndex(h => /narration|desc|particulars/i.test(h));

        let index = 1;
        for (const line of dataLines) {
          const cols = line.split(',').map(c => c.replace(/^["']|["']$/g, '').trim());
          if (cols.length < Math.min(2, headers.length)) continue;

          const dateVal = dateIdx !== -1 ? cols[dateIdx] : null;
          const rawAmount = amountIdx !== -1 ? cols[amountIdx] : null;
          const amountVal = this.parseAmount(rawAmount);
          const codeVal = codeIdx !== -1 ? cols[codeIdx] : null;
          const payerVal = payerIdx !== -1 ? cols[payerIdx] : null;
          const phoneVal = phoneIdx !== -1 ? cols[phoneIdx] : null;
          const narrationVal = narrationIdx !== -1 ? cols[narrationIdx] : line;

          if (!dateVal || isNaN(amountVal)) continue;

          extractedRows.push({
            row_index: index++,
            transaction_date: this.normalizeDate(dateVal),
            transaction_time: null,
            transaction_code: codeVal ? codeVal.toUpperCase() : null,
            payer_name: payerVal,
            payer_phone: phoneVal,
            amount: Math.abs(amountVal),
            direction: amountVal >= 0 ? 'money_in' : 'money_out',
            reference_account: null,
            invoice_reference: null,
            narration: narrationVal,
            source_provider: 'CSV_GENERIC',
            source_format: 'CSV',
            row_status: codeVal ? 'ready_for_review' : 'needs_attention',
            parser_confidence: codeVal ? 'high' : 'medium',
            confidence_score: codeVal ? 80 : 50,
            warnings: codeVal ? [] : ['Missing transaction reference code'],
            ignored_reason: null,
            duplicate_reason: null,
            raw_fields: { line, headers: cols },
            suggested_matches: []
          });
        }
      }
      else if (sourceFormat === 'XLSX' || sourceFormat === 'XLS') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetNames = workbook.SheetNames;
        let selectedSheetName = sheetNames[0];
        let maxScore = -1;
        const candidateSheets = [];

        for (const name of sheetNames) {
          const sheet = workbook.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (rows.length === 0) continue;

          let score = 0;
          for (let r = 0; r < Math.min(5, rows.length); r++) {
            const row = rows[r];
            if (!Array.isArray(row)) continue;
            const rowStr = row.join(' ').toLowerCase();
            if (/(date|amount|code|ref|desc|narration|payer|payee|debit|credit)/i.test(rowStr)) {
              score += 10;
            }
          }

          candidateSheets.push({ sheet_name: name, row_count: rows.length });
          if (score > maxScore) {
            maxScore = score;
            selectedSheetName = name;
          }
        }

        extraMetadata.sheets = candidateSheets;
        extraMetadata.selected_sheet = selectedSheetName;

        const sheet = workbook.Sheets[selectedSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        let index = 1;
        for (const row of rows) {
          const getVal = (patterns) => {
            const key = Object.keys(row).find(k => patterns.some(p => p.test(k)));
            return key ? row[key] : null;
          };

          const dateVal = getVal([/date/i]);
          const rawAmount = getVal([/amount/i, /value/i, /sum/i, /credit/i, /paid/i]);
          const amountVal = this.parseAmount(rawAmount);
          const codeVal = getVal([/code/i, /ref/i, /receipt/i, /id/i]);
          const payerVal = getVal([/payer/i, /name/i, /customer/i]);
          const phoneVal = getVal([/phone/i, /mobile/i, /msisdn/i]);
          const narrationVal = getVal([/narration/i, /desc/i, /particulars/i]) || JSON.stringify(row);

          if (!dateVal || isNaN(amountVal) || amountVal === 0) continue;

          extractedRows.push({
            row_index: index++,
            transaction_date: this.normalizeDate(dateVal),
            transaction_time: null,
            transaction_code: codeVal ? String(codeVal).toUpperCase() : null,
            payer_name: payerVal ? String(payerVal) : null,
            payer_phone: phoneVal ? String(phoneVal) : null,
            amount: Math.abs(amountVal),
            direction: amountVal >= 0 ? 'money_in' : 'money_out',
            reference_account: null,
            invoice_reference: null,
            narration: String(narrationVal),
            source_provider: 'EXCEL_GENERIC',
            source_format: sourceFormat,
            row_status: codeVal ? 'ready_for_review' : 'needs_attention',
            parser_confidence: codeVal ? 'high' : 'medium',
            confidence_score: codeVal ? 80 : 50,
            warnings: codeVal ? [] : ['Missing transaction reference code'],
            ignored_reason: null,
            duplicate_reason: null,
            raw_fields: row,
            suggested_matches: []
          });
        }
      }
      else if (sourceFormat === 'PDF') {
        let pdfData;
        try {
          pdfData = await pdfParse(buffer);
          rawText = pdfData.text || '';
        } catch (err) {
          const errMsg = String(err && err.message ? err.message : '').toLowerCase();
          if (errMsg.includes('password') || errMsg.includes('encrypted')) {
            return {
              success: false,
              mode: 'statement_reconciliation_preview',
              source_format: 'PDF',
              detected_provider: 'UNKNOWN_STATEMENT',
              parser_status: 'password_protected',
              financial_mutation: false,
              summary: { rows_detected: 0, rows_ready_for_review: 0, rows_needing_attention: 0, rows_ignored: 0, rows_duplicates: 0, rows_unreadable: 0 },
              preview_rows: [],
              message: 'This file appears to be password-protected and cannot be read.',
              safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
            };
          }
          rawText = '';
        }

        const cleanText = (rawText || '').trim();
        if (!cleanText || cleanText.length < 15 || !/[a-zA-Z0-9]/.test(cleanText)) {
          return {
            success: false,
            mode: 'statement_reconciliation_preview',
            source_format: 'PDF',
            detected_provider: 'UNKNOWN_STATEMENT',
            parser_status: 'scanned_pdf_needs_ocr',
            financial_mutation: false,
            summary: { rows_detected: 0, rows_ready_for_review: 0, rows_needing_attention: 0, rows_ignored: 0, rows_duplicates: 0, rows_unreadable: 0 },
            preview_rows: [],
            message: 'Text could not be extracted from this PDF. It may be scanned and require OCR.',
            safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
          };
        }

        const { provider } = this.detectProvider(rawText, filename);
        if (provider === 'LOOP_STATEMENT') {
          extractedRows = this.parseLoopPdfText(rawText);
        } else if (provider === 'MPESA') {
          extractedRows = this.parseMpesaPdfText(rawText);
        } else {
          extractedRows = this.parseUnstructuredText(rawText, 'PDF', provider);
        }
      }
      else if (sourceFormat === 'DOCX') {
        const docxText = this.extractDocxText(buffer);
        rawText = docxText;
        const { provider } = this.detectProvider(docxText, filename);
        extractedRows = this.parseUnstructuredText(docxText, 'DOCX', provider);
      }
      else if (sourceFormat === 'TXT') {
        const txtText = buffer.toString('utf8');
        rawText = txtText;
        const { provider } = this.detectProvider(txtText, filename);
        extractedRows = this.parseUnstructuredText(txtText, 'TXT', provider);
      }
    } catch (err) {
      console.error('Extraction failed:', err);
      return {
        success: false,
        mode: 'statement_reconciliation_preview',
        source_format: sourceFormat,
        detected_provider: 'UNKNOWN_STATEMENT',
        parser_status: 'unreadable',
        financial_mutation: false,
        summary: { rows_detected: 0, rows_ready_for_review: 0, rows_needing_attention: 0, rows_ignored: 0, rows_duplicates: 0, rows_unreadable: 0 },
        preview_rows: [],
        message: 'This workbook/document could not be read. Please export it again or upload a CSV version.',
        safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
      };
    }

    const detectedProviderInfo = this.detectProvider(rawText || filename, filename);
    const detectedProvider = detectedProviderInfo.provider;

    const allTenants = await activeDb.find('tenants', { organization_id: orgId }) || [];
    const allInvoices = await activeDb.find('invoices', { organization_id: orgId }) || [];
    const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];
    const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
    const existingEvidence = await activeDb.find('payment_evidence', { organization_id: orgId }) || [];
    const existingTransactions = await activeDb.find('transactions', { organization_id: orgId }) || [];

    const existingHashes = new Set(existingEvidence.map(e => e.row_hash).filter(Boolean));
    const existingCodes = new Set([
      ...existingEvidence.map(e => e.transaction_code).filter(Boolean),
      ...existingTransactions.map(t => t.reference_number).filter(Boolean)
    ]);

    const existingCompositeKeys = new Set();
    for (const e of existingEvidence) {
      if (e.transaction_date && e.amount) {
        if (e.reference_account) existingCompositeKeys.add(`${e.transaction_date}_${e.amount}_${e.reference_account}`);
        if (e.payer_phone) existingCompositeKeys.add(`${e.transaction_date}_${e.amount}_${e.payer_phone}`);
      }
    }

    const seenHashesInUpload = new Set();
    const seenCodesInUpload = new Set();
    const seenCompositeKeys = new Set();

    let rowsDetected = extractedRows.length;
    let readyCount = 0;
    let attentionCount = 0;
    let ignoredCount = 0;
    let duplicateCount = 0;
    let unreadableCount = 0;

    const normalizedRows = [];

    for (const row of extractedRows) {
      const rowHash = row.row_hash || this.generateRowHash(row);
      row.row_hash = rowHash;

      const classified = classifyPaymentEvidenceRow(row);
      row.direction = classified.direction || row.direction;

      if (classified.status === 'ignored') {
        row.row_status = 'ignored';
        row.ignored_reason = classified.ignored_reason || 'contains_ignored_keyword';
        ignoredCount++;
      } else {
        const dateAmtRefKey = `${row.transaction_date}_${row.amount}_${row.reference_account || row.transaction_code || ''}`;
        const dateAmtPhoneKey = `${row.transaction_date}_${row.amount}_${row.payer_phone || ''}`;

        const isDuplicateHash = existingHashes.has(rowHash) || seenHashesInUpload.has(rowHash);
        const isDuplicateCode = Boolean(row.transaction_code) && (existingCodes.has(row.transaction_code) || seenCodesInUpload.has(row.transaction_code));
        const isDuplicateCompositeRef = Boolean(row.reference_account) && (seenCompositeKeys.has(dateAmtRefKey) || existingCompositeKeys.has(dateAmtRefKey));
        const isDuplicateCompositePhone = Boolean(row.payer_phone) && (seenCompositeKeys.has(dateAmtPhoneKey) || existingCompositeKeys.has(dateAmtPhoneKey));

        if (isDuplicateHash || isDuplicateCode || isDuplicateCompositeRef || isDuplicateCompositePhone) {
          row.row_status = 'duplicate';
          if (isDuplicateCode) {
            row.duplicate_reason = 'Transaction reference code already processed';
          } else if (isDuplicateHash) {
            row.duplicate_reason = 'Duplicate row structure already processed';
          } else if (isDuplicateCompositeRef) {
            row.duplicate_reason = 'Duplicate date, amount, and reference already processed';
          } else {
            row.duplicate_reason = 'Duplicate date, amount, and payer phone already processed';
          }
          duplicateCount++;
        } else {
          seenHashesInUpload.add(rowHash);
          if (row.transaction_code) seenCodesInUpload.add(row.transaction_code);
          if (row.reference_account) seenCompositeKeys.add(dateAmtRefKey);
          if (row.payer_phone) seenCompositeKeys.add(dateAmtPhoneKey);

          if (row.row_status === 'needs_attention' || !row.transaction_code) {
            row.row_status = 'needs_attention';
            attentionCount++;
          } else {
            row.row_status = 'ready_for_review';
            readyCount++;
          }
        }
      }

      row.suggested_matches = await this.getMatchingSuggestions(
        activeDb,
        orgId,
        row,
        allTenants,
        allInvoices,
        allUnits,
        allProperties
      );

      normalizedRows.push({
        row_index: row.row_index,
        transaction_date: row.transaction_date || null,
        transaction_time: row.transaction_time || null,
        transaction_code: row.transaction_code || null,
        payer_name: row.payer_name || null,
        payer_phone: row.payer_phone || null,
        amount: Number(row.amount || 0),
        direction: row.direction || 'unknown',
        reference_account: row.reference_account || null,
        invoice_reference: row.invoice_reference || null,
        narration: row.narration || row.description || '',
        source_provider: row.source_provider || detectedProvider,
        source_format: row.source_format || sourceFormat,
        row_status: row.row_status,
        parser_confidence: row.parser_confidence || 'unknown',
        confidence_score: row.confidence_score || 0,
        warnings: row.warnings || [],
        ignored_reason: row.ignored_reason || null,
        duplicate_reason: row.duplicate_reason || null,
        row_hash: rowHash,
        raw_fields: row.raw_fields || { narration: row.narration },
        suggested_matches: row.suggested_matches || []
      });
    }

    return {
      success: true,
      mode: 'statement_reconciliation_preview',
      source_format: sourceFormat,
      detected_provider: detectedProvider,
      parser_status: parserStatus,
      financial_mutation: false,
      summary: {
        rows_detected: rowsDetected,
        rows_ready_for_review: readyCount,
        rows_needing_attention: attentionCount,
        rows_ignored: ignoredCount,
        rows_duplicates: duplicateCount,
        rows_unreadable: unreadableCount
      },
      preview_rows: normalizedRows,
      extra_metadata: Object.keys(extraMetadata).length > 0 ? extraMetadata : undefined,
      safety_message: 'Preview does not change invoice balances, tenant balances, receipts, or ledger records.'
    };
  }

  static generateRowHash(rawData) {
    const content = typeof rawData === 'string'
      ? rawData
      : JSON.stringify(rawData, Object.keys(rawData || {}).sort());
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Line parser for general unstructured statements (DOCX, TXT, PDF)
   */
  static parseUnstructuredText(text, format, provider) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const parsedRows = [];
    let index = 1;

    for (const line of lines) {
      if (/(balance b\/f|brought forward|closing balance|statement period|opening balance|total credit|total debit)/i.test(line)) continue;

      const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}[\s\/-][A-Za-z]+[\s\/-]\d{4})\b/);
      if (!dateMatch) continue;

      const cleanLine = line.replace(dateMatch[0], ' ');

      const amountMatches = cleanLine.match(/\b(?:KES|KSH)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\b/gi);
      if (!amountMatches) continue;

      let amountVal = 0;
      let foundAmount = false;
      for (const match of amountMatches) {
        const clean = match.replace(/KES|KSH/gi, '').replace(/,/g, '').trim();
        const num = parseFloat(clean);
        if (Number.isFinite(num) && num > 0) {
          amountVal = num;
          foundAmount = true;
          break;
        }
      }
      if (!foundAmount) continue;

      const codeMatch = cleanLine.match(/\b([A-Z0-9]{8,12})\b/);
      const transactionCode = codeMatch ? codeMatch[1].toUpperCase() : null;

      let direction = 'unknown';
      if (/(received|deposit|credit|incoming|paid in|inward)/i.test(line)) {
        direction = 'money_in';
      } else if (/(withdraw|debit|sent|payment|outgoing|fee|charge|reversal)/i.test(line)) {
        direction = 'money_out';
      }

      parsedRows.push({
        row_index: index++,
        transaction_date: this.normalizeDate(dateMatch[1]),
        transaction_time: null,
        transaction_code: transactionCode,
        payer_name: null,
        payer_phone: null,
        amount: amountVal,
        direction,
        reference_account: null,
        invoice_reference: null,
        narration: line,
        source_provider: provider,
        source_format: format,
        row_status: transactionCode ? 'ready_for_review' : 'needs_attention',
        parser_confidence: transactionCode ? 'medium' : 'low',
        confidence_score: transactionCode ? 60 : 30,
        warnings: transactionCode ? [] : ['Missing transaction reference code'],
        ignored_reason: null,
        duplicate_reason: null,
        raw_fields: { line },
        suggested_matches: []
      });
    }

    return parsedRows;
  }

  /**
   * PDF text parser specifically tuned for Safaricom M-Pesa Statements
   */
  static parseMpesaPdfText(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const parsedRows = [];
    let index = 1;

    for (const line of lines) {
      const codeMatch = line.match(/\b([A-Z0-9]{10})\b/);
      if (!codeMatch) continue;

      const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (!dateMatch) continue;

      const timeMatch = line.match(/\b(\d{2}:\d{2}:\d{2})\b/);

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

      parsedRows.push({
        row_index: index++,
        transaction_date: dateMatch[1],
        transaction_time: timeMatch ? timeMatch[1] : null,
        transaction_code: codeMatch[1].toUpperCase(),
        payer_name: null,
        payer_phone: null,
        amount,
        direction,
        reference_account: null,
        invoice_reference: null,
        narration: line,
        source_provider: 'MPESA',
        source_format: 'PDF',
        row_status: 'ready_for_review',
        parser_confidence: 'high',
        confidence_score: 90,
        warnings: [],
        ignored_reason: null,
        duplicate_reason: null,
        raw_fields: { line },
        suggested_matches: []
      });
    }

    return parsedRows;
  }

  /**
   * PDF text parser specifically tuned for Loop statement format
   */
  static parseLoopPdfText(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const parsedRows = [];
    let index = 1;

    for (const line of lines) {
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
        transaction_date: this.normalizeDate(dateMatch[1]),
        transaction_time: null,
        transaction_code: codeMatch[1].toUpperCase(),
        payer_name: null,
        payer_phone: null,
        amount,
        direction,
        reference_account: null,
        invoice_reference: null,
        narration: line,
        source_provider: 'LOOP_STATEMENT',
        source_format: 'PDF',
        row_status: 'ready_for_review',
        parser_confidence: 'high',
        confidence_score: 85,
        warnings: [],
        ignored_reason: null,
        duplicate_reason: null,
        raw_fields: { line },
        suggested_matches: []
      });
    }

    return parsedRows;
  }
}
