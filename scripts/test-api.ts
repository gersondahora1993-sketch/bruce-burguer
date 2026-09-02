import { db } from '../server/src/db.ts';

console.log('=== Testando GET /api/business-settings (simulado) ===');

// Simular o que a rota faz
const companyId = 1;
const row = db
  .prepare(
    `SELECT business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url, updated_at
     FROM business_settings WHERE company_id = ?`
  )
  .get(companyId) as {
    business_name: string;
    slogan: string;
    whatsapp: string;
    address: string;
    city: string;
    uf: string;
    cep: string;
    hours: string;
    logo_url: string;
    updated_at: string;
  } | undefined;

if (!row) {
  console.log('Nenhuma configuração encontrada');
} else {
  console.log('Resposta da API GET:');
  console.log(JSON.stringify({
    ...row,
    whatsapp_digits_only: row.whatsapp.replace(/\D/g, ""),
  }, null, 2));
}

console.log('\n=== Testando PUT /api/business-settings (simulado) ===');
const testForm = {
  business_name: "Bruce Burguer Teste",
  slogan: "Slogan teste",
  whatsapp: "5522981667509",
  address: "Endereço teste",
  city: "Cidade teste",
  uf: "RJ",
  cep: "12345-678",
  hours: "Terça a sábado, das 18:30 às 23:00",
  logo_url: "https://exemplo.com/logo.png",
};

const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

try {
  db.prepare(
    `UPDATE business_settings SET
       business_name = ?, slogan = ?, whatsapp = ?, address = ?, city = ?, uf = ?, cep = ?, hours = ?, logo_url = ?, updated_at = ?
     WHERE company_id = ?`
  ).run(
    testForm.business_name,
    testForm.slogan,
    testForm.whatsapp,
    testForm.address,
    testForm.city,
    testForm.uf,
    testForm.cep,
    testForm.hours,
    testForm.logo_url,
    ts,
    1
  );
  console.log('UPDATE executado com sucesso');
  
  // Verificar
  const after = db.prepare('SELECT * FROM business_settings WHERE company_id = 1').get();
  console.log('Depois do UPDATE:', JSON.stringify(after, null, 2));
} catch (err: any) {
  console.error('Erro:', err.message);
}