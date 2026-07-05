import { GenericParser } from './GenericParser.js';
import { MPesaParser } from './MPesaParser.js';
import { NCBAParser } from './NCBAParser.js';
import { KCBParser } from './KCBParser.js';
import { EquityParser } from './EquityParser.js';
import { AbsaParser } from './AbsaParser.js';
import { CoopParser } from './CoopParser.js';
import { FamilyParser } from './FamilyParser.js';
import { DTBParser } from './DTBParser.js';
import { IMParser } from './IMParser.js';

export const parsers = [
  new MPesaParser(),
  new NCBAParser(),
  new KCBParser(),
  new EquityParser(),
  new AbsaParser(),
  new CoopParser(),
  new FamilyParser(),
  new DTBParser(),
  new IMParser(),
  new GenericParser() // Generic should be checked last as a fallback
];
