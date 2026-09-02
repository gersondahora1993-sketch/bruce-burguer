import { db } from '../server/src/db.ts';

const r = db.prepare('SELECT * FROM business_settings WHERE company_id = 1').all();
console.log('business_settings:', JSON.stringify(r, null, 2));