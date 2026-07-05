import { ProviderDetectionService } from './ProviderDetectionService.js';
import { GenericParser } from './parsers/GenericParser.js';
import { parsers } from './parsers/index.js';
import crypto from 'crypto';

export class StatementParserRegistry {
  /**
   * Detects the provider/source of the statement from content heuristics or headers.
   */
  static detectProvider(file, extractedText = '', sheetHeaders = []) {
    const doc = {
      filename: file?.filename || '',
      text: extractedText,
      headers: sheetHeaders
    };
    const result = ProviderDetectionService.detect(doc);
    return result.provider;
  }

  /**
   * Parses the file buffer based on the file type.
   */
  static async parse(file) {
    try {
      const gp = new GenericParser();
      const { rawRows, rawText } = await gp.extract(file.buffer, file.filename);
      return { rawRows, rawText };
    } catch (err) {
      throw new Error(`Statement parsing failed: ${err.message}`);
    }
  }

  /**
   * Standardizes raw rows into the normalized transaction schema using the detected parser.
   */
  static normalize(rawRows, fileType, providerName) {
    const parser = parsers.find(p => p.name === providerName) || new GenericParser();
    return parser.normalize(rawRows, fileType);
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
