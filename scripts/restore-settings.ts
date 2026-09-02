import { db, seed } from '../server/src/db.ts';
seed();
const r = db.prepare('SELECT * FROM business_settings WHERE company_id = 1').get();
console.log('Seed executado, dados:', JSON.stringify(r, null, 2));