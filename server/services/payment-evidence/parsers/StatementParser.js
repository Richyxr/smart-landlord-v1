import XLSX from 'xlsx';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export class StatementParser {
  constructor(name, version) {
    this.name = name;
    this.version = version;
  }

  supports(document) {
    return { supported: false, confidence: 0.0 };
  }

  async extract(buffer, filename) {
    const ext = String(filename || '').toLowerCase().split('.').pop();
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
  }

  normalize(rawRows, fileType) {
    return [];
  }

  normalizeDate(dateStr) {
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
}
