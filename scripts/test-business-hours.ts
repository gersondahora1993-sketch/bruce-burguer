import { isBusinessOpen, getBusinessStatus, parseBusinessHours } from '../server/src/lib/businessHours.ts';

// Testar com o horário oficial da Bruce Burguer
const hours = 'Terça a sábado, das 18:30 às 23:00';

console.log('=== Testando parseBusinessHours ===');
const parsed = parseBusinessHours(hours);
console.log('Parsed:', JSON.stringify(parsed, null, 2));

console.log('\n=== Testando isBusinessOpen ===');
const testCases = [
  { day: 1, hour: 10, min: 0, desc: 'Segunda 10:00' },
  { day: 2, hour: 10, min: 0, desc: 'Terca 10:00 (antes de abrir)' },
  { day: 2, hour: 18, min: 30, desc: 'Terca 18:30 (abre)' },
  { day: 2, hour: 22, min: 0, desc: 'Terca 22:00 (aberto)' },
  { day: 2, hour: 23, min: 0, desc: 'Terca 23:00 (fecha)' },
  { day: 5, hour: 20, min: 0, desc: 'Sexta 20:00 (aberto)' },
  { day: 6, hour: 20, min: 0, desc: 'Sabado 20:00 (aberto)' },
  { day: 0, hour: 20, min: 0, desc: 'Domingo 20:00 (fechado)' },
];

for (const tc of testCases) {
  const testDate = new Date();
  testDate.setDate(testDate.getDate() + ((tc.day - testDate.getDay() + 7) % 7));
  testDate.setHours(tc.hour, tc.min, 0, 0);
  const status = isBusinessOpen('Terça a sábado, das 18:30 às 23:00', testDate);
  console.log(tc.desc + ': ' + status);
}

console.log('\n=== getBusinessStatus ===');
const status = getBusinessStatus(hours);
console.log('Status atual:', status);