import { parseBusinessHours } from '../server/src/lib/businessHours.ts';

const hours = 'Terça a sábado, das 18:30 às 23:00';

console.log('Original:', hours);
const normalize = (str: string) => str
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();
console.log('Normalizado:', normalize(hours));

const str = normalize(hours.trim());

const rangeMatch = str.match(/(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)\s*(?:a|ate)\s*(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)/);
console.log('Range match:', rangeMatch);

const parts = str.split(/\s*(?:a|ate)\s*/);
console.log('Parts:', parts);

const dayMap: Record<string, number> = {
  "domingo": 0,
  "segunda": 1,
  "terca": 2,
  "quarta": 3,
  "quinta": 4,
  "sexta": 5,
  "sabado": 6,
};

for (const [dayName, dayNum] of Object.entries(dayMap)) {
  console.log(`Day "${dayName}" in str: ${str.includes(dayName)}`);
}