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
  product1Id: number;
  product2Id: number;
  product3Id: number;
  addonAId: number;
  addonBId: number;
  addonCId: number;
  addonDId: number;
  combo1Id: number;
}

let fx: Fixture;

const TS = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 19).replace('T', ' ');
})();

function seedFixtures() {
  db.prepare('DELETE FROM order_item_addons').run();
  db.prepare('DELETE FROM order_items').run();
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM combo_items').run();
  db.prepare('DELETE FROM combos').run();
  db.prepare('DELETE FROM product_addons').run();
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM addons').run();
  db.prepare("DELETE FROM companies WHERE id != 1");

  const company = db.prepare("INSERT INTO companies (name, slug, status, created_at, updated_at) VALUES (?, ?, 'ativo', ?, ?)").run('Loja Teste 2', 'loja-teste-2-' + Date.now(), TS, TS);
  company2Id = Number(company.lastInsertRowid);

  const insProduct = db.prepare("INSERT INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, '', NULL, ?, '', ?, ?, ?, ?, ?)");
  const product1Id = Number(insProduct.run('X-Burger Teste', 2000, 1, 1, TS, 5000, 0).lastInsertRowid);
  const product2Id = Number(insProduct.run('X-Salada Inativo', 1500, 0, 1, TS, 0, 0).lastInsertRowid);
  const product3Id = Number(insProduct.run('X-Burger Loja 2', 999, 1, company2Id, TS, 5000, 0).lastInsertRowid);

  const insAddon = db.prepare("INSERT INTO addons (name, price_cents, active, company_id, created_at) VALUES (?, ?, ?, ?, ?)");
  const addonAId = Number(insAddon.run('Bacon', 300, 1, 1, TS).lastInsertRowid);
  const addonBId = Number(insAddon.run('Ovo Inativo', 500, 0, 1, TS).lastInsertRowid);
  const addonCId = Number(insAddon.run('Bacon Loja 2', 100, 1, company2Id, TS).lastInsertRowid);
  const addonDId = Number(insAddon.run('Cheddar Sem Vinculo', 400, 1, 1, TS).lastInsertRowid);

  db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(product1Id, addonAId, 1, TS);
  db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(product1Id, addonBId, 1, TS);
  db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(product2Id, addonAId, 1, TS);

  const combo1Id = Number(db.prepare("INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at) VALUES (?, '', ?, 1, ?, ?)").run('Combo Teste', 3000, 1, TS).lastInsertRowid);

  fx = { product1Id, product2Id, product3Id, addonAId, addonBId, addonCId, addonDId, combo1Id };
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
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers!['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, data: null });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('Orders API - produto + adicionais + combos (loja pública)', () => {
  let adminUser: TestUser;
  let adminUser2: TestUser;

  beforeAll(async () => {
    baseUrl = await startServer();
  });

  afterAll(async () => {
    await stopServer();
    db.close();
  });

  beforeEach(() => {
    cleanupTestData();
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
    seedFixtures();
  });

  describe('Criação pública (POST /api/orders)', () => {
    it('registra pedido de produto sem variação', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        street: 'Rua A, 123',
        neighborhood: 'Centro',
        payment_method: 'pix',
        items: [{ product_id: fx.product1Id, quantity: 2 }],
      });

      expect(res.status).toBe(201);
      expect(res.data.order_id).toBeGreaterThan(0);
      expect(res.data.total_cents).toBe(4000);
      expect(res.data.status).toBe('novo');
      expect(res.data.item_count).toBe(1);
      expect(res.data.items[0].product_id).toBe(fx.product1Id);
      expect(res.data.items[0].line_cents).toBe(4000);
    });

    it('registra pedido com adicionais e calcula o total no backend', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [
          {
            product_id: fx.product1Id,
            quantity: 1,
            addons: [{ addon_id: fx.addonAId, quantity: 2 }],
          },
        ],
      });

      expect(res.status).toBe(201);
      // 2000 + (300*2) = 2600
      expect(res.data.total_cents).toBe(2600);
      const addonLine = res.data.items[0].addons[0];
      expect(addonLine.total_cents).toBe(600);
    });

    it('rejeita adicional inativo', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [
          {
            product_id: fx.product1Id,
            quantity: 1,
            addons: [{ addon_id: fx.addonBId, quantity: 1 }],
          },
        ],
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('indisponível');
    });

    it('registra múltiplos itens (produto + combo) com múltiplas unidades', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [
          { product_id: fx.product1Id, quantity: 2, addons: [{ addon_id: fx.addonAId, quantity: 1 }] },
          { combo_id: fx.combo1Id, quantity: 1 },
        ],
      });

      expect(res.status).toBe(201);
      // (2000 + 300) * 2 + 3000 = 7600
      expect(res.data.total_cents).toBe(7600);
      // quantidade de linhas de itens
    });

    it('calcula via preço do backend e ignora preços enviados pelo cliente', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        unit_price_cents: 1000000,
        subtotal_cents: 999,
        total_cents: 999,
        items: [{ product_id: fx.product1Id, quantity: 1, unit_price_cents: 1000000, total_cents: 999999 }],
      });

      expect(res.status).toBe(201);
      expect(res.data.total_cents).toBe(2000);
    });

    it('registra pedido com combo (sem adicionais)', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ combo_id: fx.combo1Id, quantity: 2 }],
      });

      expect(res.status).toBe(201);
      expect(res.data.total_cents).toBe(6000);
      expect(res.data.items[0].combo_id).toBe(fx.combo1Id);
    });

    it('rejeita adicionais em combo', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ combo_id: fx.combo1Id, quantity: 1, addons: [{ addon_id: fx.addonAId, quantity: 1 }] }],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita produto de outro tenant', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product3Id, quantity: 1 }],
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('produto');
    });

    it('rejeita produto inexistente', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: 999999, quantity: 1 }],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita produto inativo', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product2Id, quantity: 1 }],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita adicional de outro tenant', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1, addons: [{ addon_id: fx.addonCId, quantity: 1 }] }],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita adicional não vinculado ao produto', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1, addons: [{ addon_id: fx.addonDId, quantity: 1 }] }],
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('não está disponível');
    });

    it('aceita adicional ativo vinculado ao produto', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1, addons: [{ addon_id: fx.addonAId, quantity: 1 }] }],
      });

      expect(res.status).toBe(201);
    });

    it('rejeita combo inativo', async () => {
      db.prepare("UPDATE combos SET active = 0 WHERE id = ?").run(fx.combo1Id);
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ combo_id: fx.combo1Id, quantity: 1 }],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita quantidade inválida', async () => {
      for (const qty of [0, -1, 'abc', 1.5]) {
        const res = await apiRequest('POST', '/api/orders', {
          customer_name: 'Cliente Teste',
          customer_phone: '22999999999',
          items: [{ product_id: fx.product1Id, quantity: qty }],
        });
        expect(res.status).toBe(400);
      }
    });

    it('rejeita item sem product_id nem combo_id', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ quantity: 1 }],
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('product_id ou combo_id');
    });

    it('rejeita carrinho vazio', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita payload legado com variation_id (schema sem variações)', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ variation_id: 1, quantity: 1 }],
      });

      expect(res.status).toBe(400);
    });

    it('rejeita pedido sem nome', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      expect(res.status).toBe(400);
    });

    it('persiste itens e adicionais (order_item_addons)', async () => {
      await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [
          {
            product_id: fx.product1Id,
            quantity: 2,
            addons: [{ addon_id: fx.addonAId, quantity: 3 }],
          },
        ],
      });

      const items = db.prepare("SELECT * FROM order_items").all() as any[];
      expect(items.length).toBe(1);
      expect(items[0].quantity).toBe(2);
      expect(items[0].price_cents).toBe(2000);
      expect(items[0].product_id).toBe(fx.product1Id);

      const addons = db.prepare("SELECT * FROM order_item_addons").all() as any[];
      expect(addons.length).toBe(1);
      expect(addons[0].addon_id).toBe(fx.addonAId);
      expect(addons[0].quantity).toBe(3);
      expect(addons[0].price_cents).toBe(300);
    });
  });

  describe('Painel (autenticado)', () => {
    it('exige autenticação para listar', async () => {
      const res = await apiRequest('GET', '/api/orders');
      expect(res.status).toBe(401);
    });

    it('lista pedidos do tenant', async () => {
      await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      const token = generateToken(adminUser);
      const res = await apiRequest('GET', '/api/orders', undefined, token);
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(1);
      expect(res.data[0].customer_name).toBe('Cliente Teste');
    });

    it('busca por produto na listagem', async () => {
      await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      const token = generateToken(adminUser);
      const res = await apiRequest('GET', `/api/orders?search=${encodeURIComponent('X-Burger Teste')}`, undefined, token);
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(1);

      const resNot = await apiRequest('GET', `/api/orders?search=${encodeURIComponent('asdfghjkl')}`, undefined, token);
      expect(resNot.data.length).toBe(0);
    });

    it('retorna detalhe com itens e adicionais', async () => {
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 2, addons: [{ addon_id: fx.addonAId, quantity: 2 }] }],
      });

      const token = generateToken(adminUser);
      const res = await apiRequest('GET', `/api/orders/${created.data.order_id}`, undefined, token);
      expect(res.status).toBe(200);
      expect(res.data.items.length).toBe(1);
      expect(res.data.items[0].product_name).toBe('X-Burger Teste');
      expect(res.data.items[0].addons.length).toBe(1);
      expect(res.data.items[0].addons[0].name).toBe('Bacon');
      expect(res.data.items[0].addons[0].total_cents).toBe(600);
      // (2000 + 300*2) * 2 = 5200
      expect(res.data.items[0].total_cents).toBe(5200);
    });

    it('isola pedidos por tenant no detalhe', async () => {
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      const token2 = generateToken(adminUser2);
      const res = await apiRequest('GET', `/api/orders/${created.data.order_id}`, undefined, token2);
      expect(res.status).toBe(404);
    });

    it('permite transição sequencial de status', async () => {
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });
      const token = generateToken(adminUser);

      const ok = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'confirmado' }, token);
      expect(ok.status).toBe(200);
      expect(ok.data.status).toBe('confirmado');

      const invalid = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'pronto' }, token);
      expect(invalid.status).toBe(400);
    });

    it('permite cancelar pedido a qualquer momento', async () => {
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });
      const token = generateToken(adminUser);

      const res = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('cancelado');
    });
  });
});