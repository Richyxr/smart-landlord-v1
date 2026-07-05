import { StatementParser } from './StatementParser.js';
import { GenericParser } from './GenericParser.js';

export class CoopParser extends StatementParser {
  constructor() {
    super('Coop', '1.0.0');
    this.generic = new GenericParser();
  }

  supports(document) {
    const text = String(document.text || '').toLowerCase();
    const filename = String(document.filename || '').toLowerCase();
    const headers = (document.headers || []).map(h => String(h).toLowerCase());

    const content = text + ' ' + filename + ' ' + headers.join(' ');
    
    let confidence = 0.0;
    if (/co-operative bank|coop bank|statement of account|kcookena/i.test(content)) {
      confidence += 0.90;
    }

    return { supported: confidence >= 0.80, confidence: Math.min(confidence, 1.0) };
  }

  normalize(rawRows, fileType) {
    const normalized = this.generic.normalize(rawRows, fileType);
    for (const row of normalized) {
      row.source_provider = 'COOP';
    }
    return normalized;
  }
}
