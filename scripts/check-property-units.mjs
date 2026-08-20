import { db } from '../server/db.js';

console.log('--- PROPERTIES ---');
const properties = db.get('properties');
console.log(JSON.stringify(properties, null, 2));

console.log('--- UNITS ---');
const units = db.get('units');
console.log(JSON.stringify(units, null, 2));

console.log('--- staff_assignments ---');
const staffAssignments = db.get('staff_assignments');
console.log(JSON.stringify(staffAssignments, null, 2));
