import { db } from '../server/db.js';

const properties = db.get('properties');
console.log(properties.slice(0, 5));
