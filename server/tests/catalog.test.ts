import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { db } from '../src/db.js';
import { app } from '../src/index.js';
import {
  createTestUser,
  generateToken,
  cleanupTestData,
  type TestUser,
} from './helpers.js';

let baseUrl: string;
let server: http.Server;

let company2Id = 2;

interface Fixture {
  cat1Id: number;
  cat2Id: number;
  catT2Id: number;
  addonAId: number;
  addonBId: number;
  addonCId: number;
  product1Id: number;
  productAId: number;
  productT2Id: number;
  combo1Id: number;
}

let fx: Fixture;

const TS = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 19).replace('T', ' ');
})();

function seedFixtures() {
  db.prepare('DELETE FROM combo_items').run();
  db.prepare('DELETE FROM combos').run();
  db.prepare('DELETE FROM product_addons').run();
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM addons').run();
  db.prepare('DELETE FROM categories').run();
  db.prepare('DELETE FROM companies WHERE id != 1');

  const company = db
    .prepare("INSERT INTO companies (name, slug, status, created_at, updated_at) VALUES (?, ?, 'ativo', ?, ?)")
    .run('Loja Teste 2', 'loja-teste-2-' + Date.now(), TS, TS);
  company2Id = Number(company.lastInsertRowid);

  const insCat = db.prepare("INSERT INTO categories (name, active, company_id, created_at) VALUES (?, 1, ?, ?)");
  const cat1Id = Number(insCat.run('Cat Burguer T1', 1, TS).lastInsertRowid);
  const cat2Id = Number(insCat.run('Cat Extra T1', 1, TS).lastInsertRowid);
  const catT2Id = Number(insCat.run('Cat Loja 2', company2Id, TS).lastInsertRowid);

  const insAddon = db.prepare("INSERT INTO addons (name, price_cents, active, company_id, created_at) VALUES (?, ?, ?, ?, ?)");
  const addonAId = Number(insAddon.run('Bacon T1', 300, 1, 1, TS).lastInsertRowid);
  const addonBId = Number(insAddon.run('Ovo Inativo T1', 500, 0, 1, TS).lastInsertRowid);
  const addonCId = Number(insAddon.run('Bacon Loja 2', 100, 1, company2Id, TS).lastInsertRowid);

  const insProduct = db.prepare(
    "INSERT INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at) VALUES (?, '', ?, ?, '', ?, ?, ?)"
  );
  const product1Id = Number(insProduct.run('X-Burger Teste', cat1Id, 2000, 1, 1, TS).lastInsertRowid);
  const productAId = Number(insProduct.run('Combo Item A', cat1Id, 1500, 1, 1, TS).lastInsertRowid);
  const productT2Id = Number(insProduct.run('X-Salada Loja 2', catT2Id, 999, 1, company2Id, TS).lastInsertRowid);

  const combo1Id = Number(
    db
      .prepare("INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at) VALUES (?, '', ?, 1, ?, ?)")
      .run('Combo Teste', 3000, 1, TS)
      .lastInsertRowid
  );
  db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)").run(combo1Id, product1Id, 1, 1, TS);
  db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, ?, ?, ?)").run(combo1Id, productAId, 1, 1, TS);

  fx = { cat1Id, cat2Id, catT2Id, addonAId, addonBId, addonCId, product1Id, productAId, productT2Id, combo1Id };
}

async function startServer(): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers!['Authorization'] = `Bearer ${token}`;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, data: null });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Catálogo administrativo (products, categories, addons, combos)', () => {
  let adminUser: TestUser;
  let adminUser2: TestUser;
  let sellerUser: TestUser;

  beforeAll(async () => {
    baseUrl = await startServer();
  });

  afterAll(async () => {
    await stopServer();
    db.close();
  });

  beforeEach(() => {
    cleanupTestData();
    seedFixtures();
    adminUser = createTestUser({
      name: 'Admin Loja 1',
      email: 'test-admin1@bruceburguer.com',
      password: 'Admin@123',
      role: 'admin',
      company_id: 1,
    });
    adminUser2 = createTestUser({
      name: 'Admin Loja 2',
      email: 'test-admin2@bruceburguer.com',
      password: 'Admin@123',
      role: 'admin',
      company_id: company2Id,
    });
    sellerUser = createTestUser({
      name: 'Vendedora Loja 1',
      email: 'test-seller1@bruceburguer.com',
      password: 'Admin@123',
      role: 'vendedora',
      company_id: 1,
    });
  });

  describe('Products', () => {
    it('cria produto com addons válidos', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'Burguer Novo',
        description: 'Desc',
        category_id: fx.cat1Id,
        sale_price_cents: 2500,
        addon_ids: [fx.addonAId],
      }, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.id).toBeGreaterThan(0);

      const detail = await apiRequest('GET', `/api/products/${res.data.id}`, undefined, generateToken(adminUser));
      expect(detail.status).toBe(200);
      expect(detail.data.name).toBe('Burguer Novo');
      expect(detail.data.sale_price_cents).toBe(2500);
      expect(detail.data.category_name).toBe('Cat Burguer T1');
      expect(detail.data.addons).toHaveLength(1);
      expect(detail.data.addons[0]).toMatchObject({ id: fx.addonAId, name: 'Bacon T1', price_cents: 300 });
    });

    it('lista produtos e inclui addons no array', async () => {
      const ins = db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(fx.product1Id, fx.addonAId, 1, TS);
      expect(ins.changes).toBe(1);

      const res = await apiRequest('GET', '/api/products', undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      const prod = res.data.find((p: any) => p.id === fx.product1Id);
      expect(prod).toBeDefined();
      expect(Array.isArray(prod.addons)).toBe(true);
      expect(prod.addons).toHaveLength(1);
      expect(prod.addons[0]).toMatchObject({ id: fx.addonAId, name: 'Bacon T1' });
    });

    it('busca produto por ID', async () => {
      const res = await apiRequest('GET', `/api/products/${fx.product1Id}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.id).toBe(fx.product1Id);
      expect(res.data.addons).toBeDefined();
    });

    it('busca produto inexistente retorna 404', async () => {
      const res = await apiRequest('GET', '/api/products/999999', undefined, generateToken(adminUser));
      expect(res.status).toBe(404);
    });

    it('atualiza produto e substitui addons (all-or-nothing)', async () => {
      const res = await apiRequest('PUT', `/api/products/${fx.product1Id}`, {
        name: 'X-Burger Atualizado',
        category_id: fx.cat1Id,
        sale_price_cents: 2200,
        addon_ids: [fx.addonAId],
      }, generateToken(adminUser));
      expect(res.status).toBe(200);

      const detail = await apiRequest('GET', `/api/products/${fx.product1Id}`, undefined, generateToken(adminUser));
      expect(detail.data.name).toBe('X-Burger Atualizado');
      expect(detail.data.sale_price_cents).toBe(2200);
      expect(detail.data.addons).toHaveLength(1);
      expect(detail.data.addons[0].id).toBe(fx.addonAId);
    });

    it('atualiza produto sem addon_ids mantém addons atuais', async () => {
      db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(fx.product1Id, fx.addonAId, 1, TS);
      const res = await apiRequest('PUT', `/api/products/${fx.product1Id}`, {
        name: 'X-Burger Sem Addons Field',
        category_id: fx.cat1Id,
        sale_price_cents: 2200,
      }, generateToken(adminUser));
      expect(res.status).toBe(200);
      const detail = await apiRequest('GET', `/api/products/${fx.product1Id}`, undefined, generateToken(adminUser));
      expect(detail.data.addons).toHaveLength(1);
    });

    it('soft-delete produto que faz parte de combo', async () => {
      const res = await apiRequest('DELETE', `/api/products/${fx.product1Id}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.message).toContain('desativado');

      const detail = await apiRequest('GET', `/api/products/${fx.product1Id}`, undefined, generateToken(adminUser));
      expect(detail.data.active).toBe(0);
      const comboItem = db.prepare("SELECT 1 FROM combo_items WHERE combo_id = ? AND product_id = ?").get(fx.combo1Id, fx.product1Id);
      expect(comboItem).toBeDefined();
    });

    it('hard-delete produto sem histórico', async () => {
      const created = await apiRequest('POST', '/api/products', {
        name: 'Provisorio', category_id: fx.cat1Id, sale_price_cents: 1000,
      }, generateToken(adminUser));
      const pid = created.data.id;
      const res = await apiRequest('DELETE', `/api/products/${pid}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      const detail = await apiRequest('GET', `/api/products/${pid}`, undefined, generateToken(adminUser));
      expect(detail.status).toBe(404);
    });

    it('rejeita addon inexistente', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'Inválido', category_id: fx.cat1Id, sale_price_cents: 1000,
        addon_ids: [999999],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('Adicional ID 999999');
    });

    it('rejeita addon de outro tenant', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'Inválido', category_id: fx.cat1Id, sale_price_cents: 1000,
        addon_ids: [fx.addonCId],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('não encontrado nesta empresa');
    });

    it('rejeita addon inativo', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'Inválido', category_id: fx.cat1Id, sale_price_cents: 1000,
        addon_ids: [fx.addonBId],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('inativo');
    });

    it('rejeita categoria de outro tenant', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'Inválido', category_id: fx.catT2Id, sale_price_cents: 1000,
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toBe('Categoria não encontrada.');
    });

    it('rejeita nome duplicado no mesmo tenant', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'X-Burger Teste', category_id: fx.cat1Id, sale_price_cents: 1000,
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('produto com este nome');
    });

    it('permite nome igual em outro tenant', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'X-Burger Teste', category_id: fx.catT2Id, sale_price_cents: 1000,
      }, generateToken(adminUser2));
      expect(res.status).toBe(200);
    });

    it('isola produtos por tenant na listagem', async () => {
      const res = await apiRequest('GET', '/api/products', undefined, generateToken(adminUser));
      const ids = res.data.map((p: any) => p.id);
      expect(ids).not.toContain(fx.productT2Id);
      expect(ids).toContain(fx.product1Id);
    });

    it('bloqueia escrita para não-admin', async () => {
      const res = await apiRequest('POST', '/api/products', {
        name: 'Sem Permissao', category_id: fx.cat1Id, sale_price_cents: 1000,
      }, generateToken(sellerUser));
      expect(res.status).toBe(403);
    });

    it('exige autenticação', async () => {
      const res = await apiRequest('GET', '/api/products');
      expect(res.status).toBe(401);
    });
  });

  describe('Categories', () => {
    it('cria categoria', async () => {
      const res = await apiRequest('POST', '/api/categories', { name: 'Sobremesas' }, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.id).toBeGreaterThan(0);
      expect(res.data.active).toBe(1);
    });

    it('rejeita nome duplicado', async () => {
      const res = await apiRequest('POST', '/api/categories', { name: 'Cat Burguer T1' }, generateToken(adminUser));
      expect(res.status).toBe(400);
    });

    it('lista categorias do tenant', async () => {
      const res = await apiRequest('GET', '/api/categories', undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.some((c: any) => c.id === fx.cat1Id)).toBe(true);
      expect(res.data.some((c: any) => c.id === fx.catT2Id)).toBe(false);
    });

    it('atualiza categoria', async () => {
      const res = await apiRequest('PUT', `/api/categories/${fx.cat1Id}`, { name: 'Hambúrgueres 2', active: 1 }, generateToken(adminUser));
      expect(res.status).toBe(200);
      const detail = await apiRequest('GET', '/api/categories', undefined, generateToken(adminUser));
      expect(detail.data.find((c: any) => c.id === fx.cat1Id)!.name).toBe('Hambúrgueres 2');
    });

    it('soft-delete categoria com produtos', async () => {
      const res = await apiRequest('DELETE', `/api/categories/${fx.cat1Id}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.message).toContain('desativada');
      const list = await apiRequest('GET', '/api/categories', undefined, generateToken(adminUser));
      expect(list.data.find((c: any) => c.id === fx.cat1Id)!.active).toBe(0);
    });

    it('hard-delete categoria sem produtos', async () => {
      const res = await apiRequest('DELETE', `/api/categories/${fx.cat2Id}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      const list = await apiRequest('GET', '/api/categories', undefined, generateToken(adminUser));
      expect(list.data.some((c: any) => c.id === fx.cat2Id)).toBe(false);
    });

    it('não permite manipular categoria de outro tenant', async () => {
      const res = await apiRequest('PUT', `/api/categories/${fx.catT2Id}`, { name: 'Hack' }, generateToken(adminUser));
      expect(res.status).toBe(404);
    });
  });

  describe('Addons', () => {
    it('cria adicional', async () => {
      const res = await apiRequest('POST', '/api/addons', { name: 'Cheddar', price_cents: 350 }, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.id).toBeGreaterThan(0);
      expect(res.data.price_cents).toBe(350);
    });

    it('rejeita preço ausente', async () => {
      const res = await apiRequest('POST', '/api/addons', { name: 'Cheddar' }, generateToken(adminUser));
      expect(res.status).toBe(400);
    });

    it('lista adicionais do tenant', async () => {
      const res = await apiRequest('GET', '/api/addons', undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.some((a: any) => a.id === fx.addonAId)).toBe(true);
      expect(res.data.some((a: any) => a.id === fx.addonCId)).toBe(false);
    });

    it('atualiza adicional', async () => {
      const res = await apiRequest('PUT', `/api/addons/${fx.addonAId}`, { name: 'Bacon Extra', price_cents: 400, active: 1 }, generateToken(adminUser));
      expect(res.status).toBe(200);
      const list = await apiRequest('GET', '/api/addons', undefined, generateToken(adminUser));
      const a = list.data.find((x: any) => x.id === fx.addonAId);
      expect(a.name).toBe('Bacon Extra');
      expect(a.price_cents).toBe(400);
    });

    it('soft-delete adicional vinculado a produto', async () => {
      db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(fx.product1Id, fx.addonAId, 1, TS);
      const res = await apiRequest('DELETE', `/api/addons/${fx.addonAId}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.message).toContain('desativado');
      const list = await apiRequest('GET', '/api/addons', undefined, generateToken(adminUser));
      expect(list.data.find((a: any) => a.id === fx.addonAId)!.active).toBe(0);
    });

    it('hard-delete adicional sem vínculo', async () => {
      const res = await apiRequest('DELETE', `/api/addons/${fx.addonAId}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      const list = await apiRequest('GET', '/api/addons', undefined, generateToken(adminUser));
      expect(list.data.some((a: any) => a.id === fx.addonAId)).toBe(false);
    });

    it('não permite manipular adicional de outro tenant', async () => {
      const res = await apiRequest('PUT', `/api/addons/${fx.addonCId}`, { name: 'Hack', price_cents: 1 }, generateToken(adminUser));
      expect(res.status).toBe(404);
    });
  });

  describe('Combos', () => {
    it('cria combo com items', async () => {
      const res = await apiRequest('POST', '/api/combos', {
        name: 'Combo Casa',
        sale_price_cents: 3500,
        items: [{ product_id: fx.product1Id, quantity: 1 }, { product_id: fx.productAId, quantity: 1 }],
      }, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.id).toBeGreaterThan(0);

      const detail = await apiRequest('GET', `/api/combos/${res.data.id}`, undefined, generateToken(adminUser));
      expect(detail.data.items).toHaveLength(2);
      expect(detail.data.items[0]).toMatchObject({ product_id: fx.product1Id, quantity: 1, product_name: 'X-Burger Teste', product_price_cents: 2000 });
    });

    it('lista combos com items populados', async () => {
      const res = await apiRequest('GET', '/api/combos', undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      const combo = res.data.find((c: any) => c.id === fx.combo1Id);
      expect(combo).toBeDefined();
      expect(combo.items).toHaveLength(2);
      expect(combo.items[0]).toHaveProperty('product_id');
      expect(combo.items[0]).toHaveProperty('product_name');
      expect(combo.items[0]).toHaveProperty('quantity');
      expect(combo.items[0]).toHaveProperty('product_price_cents');
    });

    it('busca combo por ID com items padronizados', async () => {
      const res = await apiRequest('GET', `/api/combos/${fx.combo1Id}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      expect(res.data.items).toHaveLength(2);
      for (const item of res.data.items) {
        expect(item.product_price_cents).toBeGreaterThan(0);
        expect(item.product_price).toBeUndefined();
      }
    });

    it('atualiza items do combo (all-or-nothing)', async () => {
      const res = await apiRequest('PUT', `/api/combos/${fx.combo1Id}`, {
        name: 'Combo Atualizado',
        sale_price_cents: 4000,
        active: 1,
        items: [{ product_id: fx.product1Id, quantity: 2 }],
      }, generateToken(adminUser));
      expect(res.status).toBe(200);

      const detail = await apiRequest('GET', `/api/combos/${fx.combo1Id}`, undefined, generateToken(adminUser));
      expect(detail.data.name).toBe('Combo Atualizado');
      expect(detail.data.items).toHaveLength(1);
      expect(detail.data.items[0].quantity).toBe(2);
    });

    it('rejeita produto inexistente', async () => {
      const res = await apiRequest('POST', '/api/combos', {
        name: 'Combo Ruim', sale_price_cents: 1000,
        items: [{ product_id: 999999, quantity: 1 }],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('não encontrado');
    });

    it('rejeita produto de outro tenant', async () => {
      const res = await apiRequest('POST', '/api/combos', {
        name: 'Combo Ruim', sale_price_cents: 1000,
        items: [{ product_id: fx.productT2Id, quantity: 1 }],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('não encontrado');
    });

    it('rejeita produto inativo', async () => {
      db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(fx.productAId);
      const res = await apiRequest('POST', '/api/combos', {
        name: 'Combo Ruim', sale_price_cents: 1000,
        items: [{ product_id: fx.productAId, quantity: 1 }],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('inativo');
    });

    it('rejeita quantity inválida', async () => {
      const res = await apiRequest('POST', '/api/combos', {
        name: 'Combo Ruim', sale_price_cents: 1000,
        items: [{ product_id: fx.product1Id, quantity: 0 }],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('Quantidade');
    });

    it('rejeita combo sem items', async () => {
      const res = await apiRequest('POST', '/api/combos', {
        name: 'Combo Vazio', sale_price_cents: 1000,
        items: [],
      }, generateToken(adminUser));
      expect(res.status).toBe(400);
    });

    it('soft-delete combo preserva itens', async () => {
      const res = await apiRequest('DELETE', `/api/combos/${fx.combo1Id}`, undefined, generateToken(adminUser));
      expect(res.status).toBe(200);
      const list = await apiRequest('GET', '/api/combos', undefined, generateToken(adminUser));
      const combo = list.data.find((c: any) => c.id === fx.combo1Id);
      expect(combo.active).toBe(0);
      expect(combo.items).toHaveLength(2);
      const still = db.prepare("SELECT 1 FROM combo_items WHERE combo_id = ?").get(fx.combo1Id);
      expect(still).toBeDefined();
    });

    it('lista combos isolados por tenant', async () => {
      const res = await apiRequest('GET', '/api/combos', undefined, generateToken(adminUser2));
      expect(res.status).toBe(200);
      expect(res.data.some((c: any) => c.id === fx.combo1Id)).toBe(false);
    });
  });
});