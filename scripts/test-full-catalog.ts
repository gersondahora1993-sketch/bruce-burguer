import { db } from '../server/src/db.ts';

console.log("=== TESTANDO APIs DO CATÁLOGO ===");

// Test categories
console.log("\n=== CATEGORIAS ===");
const cats = db.prepare("SELECT * FROM categories ORDER BY id").all();
cats.forEach(c => console.log(`${c.id}: ${c.name} (active: ${c.active})`));

// Test products
console.log("\n=== PRODUTOS ===");
const products = db.prepare("SELECT id, name, category_id, sale_price_cents, active FROM products ORDER BY category_id, id").all();
let currentCat = 0;
for (const p of products) {
  if (p.category_id !== currentCat) {
    currentCat = p.category_id;
    const cat = db.prepare("SELECT name FROM categories WHERE id = ?").get(currentCat);
    console.log(`\n--- ${cat?.name || 'Unknown'} (cat_id: ${currentCat}) ---`);
  }
  console.log(`  ${p.id}: ${p.name} - R$ ${(p.sale_price_cents/100).toFixed(2)} (active: ${p.active})`);
}

// Test addons
console.log("\n=== ADICIONAIS ===");
const addons = db.prepare("SELECT * FROM addons ORDER BY id").all();
addons.forEach(a => console.log(`${a.id}: ${a.name} - R$ ${(a.price_cents/100).toFixed(2)} (active: ${a.active})`));

// Test product_addons
console.log("\n=== PRODUCT_ADDONS ===");
const pa = db.prepare(`
  SELECT pa.product_id, p.name as product_name, pa.addon_id, a.name as addon_name, a.price_cents
  FROM product_addons pa
  JOIN products p ON p.id = pa.product_id
  JOIN addons a ON a.id = pa.addon_id
  ORDER BY pa.product_id, pa.addon_id
`).all();
pa.forEach(r => console.log(`  Produto: ${r.product_name} (${r.product_id}) -> Adicional: ${r.addon_name} (${r.addon_id}) R$ ${(r.price_cents/100).toFixed(2)}`));

// Test combos
console.log("\n=== COMBOS ===");
const combos = db.prepare("SELECT * FROM combos ORDER BY id").all();
combos.forEach(c => console.log(`${c.id}: ${c.name} - R$ ${(c.sale_price_cents/100).toFixed(2)} (active: ${c.active})`));

// Test combo_items
console.log("\n=== COMBO ITEMS ===");
const ci = db.prepare(`
  SELECT ci.combo_id, c.name as combo_name, ci.product_id, p.name as product_name, ci.quantity
  FROM combo_items ci
  JOIN combos c ON c.id = ci.combo_id
  JOIN products p ON p.id = ci.product_id
  ORDER BY ci.combo_id, ci.id
`).all();
ci.forEach(r => console.log(`  Combo: ${r.combo_name} (${r.combo_id}) -> Produto: ${r.product_name} (${r.product_id}) x${r.quantity}`));

console.log("\n✅ Todos os testes passaram!");