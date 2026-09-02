const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'bruce-burguer.db');
console.log('DB path:', dbPath);

const db = new Database(dbPath);
const r = db.prepare('SELECT * FROM business_settings').all();
console.log('Antes:', JSON.stringify(r, null, 2));

db.prepare('UPDATE business_settings SET business_name=?, slogan=?, whatsapp=?, address=?, city=?, uf=?, hours=? WHERE id=1').run(
  'Bruce Burguer',
  'Seu hambúrguer artesanal, do nosso jeito para você.',
  '+5522981667509',
  'Loteamento Nova Macuco, em frente à Mercearia do Davi',
  'São Francisco de Itabapoana',
  'RJ',
  'Terça a sábado, das 18:30 às 23:00'
);

const after = db.prepare('SELECT * FROM business_settings').all();
console.log('Depois:', JSON.stringify(after, null, 2));