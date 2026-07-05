import { parsers } from './parsers/index.js';

export class ProviderDetectionService {
  /**
   * Detects the provider/source of the statement from content heuristics or headers.
   *
   * @param {Object} document - Contains text, filename, headers.
   * @returns {Object} { provider, confidence, parser }
   */
  static detect(document) {
    const results = [];

    for (const parser of parsers) {
      const support = parser.supports(document);
      results.push({
        provider: parser.name,
        confidence: support.confidence,
        parser
      });
    }

    // Sort descending by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    const highest = results[0];
    const confidence = highest ? highest.confidence : 0.0;
    
    // Default to Generic if confidence is negligible
    let provider = 'Generic';
    if (highest && confidence >= 0.10) {
      provider = highest.provider;
    }

    const status = confidence < 0.80 ? 'needs_review' : 'parsed';
    const activeParser = provider === 'Generic' 
      ? parsers.find(p => p.name === 'Generic') 
      : (highest ? highest.parser : null);

    return {
      provider,
      confidence,
      status,
      parser: activeParser
    };
  }
}
