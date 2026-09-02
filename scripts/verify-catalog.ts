import { db } from '../server/src/db.ts';

console.log("=== CATEGORIAS ===");
const cats = db.prepare("SELECT * FROM categories ORDER BY id").all();
console.log(JSON.stringify(cats, null, 2));

console.log("\n=== ADICIONAIS ===");
const addons = db.prepare("SELECT * FROM addons ORDER BY id").all();
console.log(JSON.stringify(addons, null, 2));

console.log("\n=== PRODUTOS ===");
const products = db.prepare("SELECT id, name, category_id, sale_price_cents, active FROM products ORDER BY category_id, id").all();
console.log(JSON.stringify(products, null, 2));

console.log("\n=== COMBOS ===");
const combos = db.prepare("SELECT * FROM combos ORDER BY id").all();
console.log(JSON.stringify(combos, null, 2));

console.log("\n=== COMBO ITEMS ===");
const comboItems = db.prepare("SELECT * FROM combo_items ORDER BY combo_id, id").all();
console.log(JSON.stringify(comboItems, null, 2));

console.log("\n=== PRODUCT ADDONS ===");
const productAddons = db.prepare("SELECT * FROM product_addons ORDER BY product_id, addon_id").all();
console.log(JSON.stringify(productAddons, null, 2));