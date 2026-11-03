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
  combo2Id: number;
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
  db.prepare('DELETE FROM companies WHERE id != 1');

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

  const insCombo = db.prepare("INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at) VALUES (?, '', ?, 1, ?, ?)");
  const combo1Id = Number(insCombo.run('Combo Teste', 3000, 1, TS).lastInsertRowid);
  const combo2Id = Number(insCombo.run('Combo Loja 2', 4000, company2Id, TS).lastInsertRowid);

  fx = { product1Id, product2Id, product3Id, addonAId, addonBId, addonCId, addonDId, combo1Id, combo2Id };
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

function lastOrder() {
  return db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get() as any;
}

describe('Vendas presenciais (FASE 3A) — orders com source/discount/paid_at/combo_id', () => {
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

  describe('Loja online (POST /api/orders) — preservada', () => {
    it('mantém pedido online com source = online e sem vendedor', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 2 }],
      });

      expect(res.status).toBe(201);
      expect(res.data.source).toBe('online');
      const order = lastOrder();
      expect(order.source).toBe('online');
      expect(order.user_id).toBeNull();
    });

    it('ignora source forjado pelo cliente (sempre online)', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        source: 'presencial',
        user_id: 999,
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      expect(res.status).toBe(201);
      const order = lastOrder();
      expect(order.source).toBe('online');
      expect(order.user_id).toBeNull();
    });

    it('não taxa pagamento do pedido online na criação (paid_at nulo)', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        payment_method: 'pix',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      expect(res.status).toBe(201);
      const order = lastOrder();
      expect(order.discount_cents).toBe(0);
      expect(order.paid_at).toBeNull();
      expect(order.completed_at).toBeNull();
    });

    it('continua rejeitando payload legado com variation_id', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ variation_id: 1, quantity: 1 }],
      });

      expect(res.status).toBe(400);
    });

    it('aplica delivery_type entrega por padrão no online', async () => {
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      expect(res.status).toBe(201);
      expect(lastOrder().delivery_type).toBe('entrega');
    });
  });

  describe('Venda presencial (POST /api/orders/presencial)', () => {
    it('exige autenticação', async () => {
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });

      expect(res.status).toBe(401);
    });

    it('registra venda presencial com source e vendedor do contexto', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'dinheiro',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(201);
      expect(res.data.source).toBe('presencial');
      expect(res.data.total_cents).toBe(2000);
      const order = lastOrder();
      expect(order.source).toBe('presencial');
      expect(order.user_id).toBe(adminUser.id);
      expect(order.company_id).toBe(1);
    });

    it('usa user_id do contexto e ignora user_id enviado no corpo', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        user_id: 777777,
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(201);
      expect(lastOrder().user_id).toBe(adminUser.id);
    });

    it('apoia acesso de usuária vendedora autenticada', async () => {
      const seller = createTestUser({
        name: 'Vendedora Teste',
        email: 'test-seller3a@bruceburguer.com',
        password: 'Admin@123',
        role: 'vendedora',
        company_id: 1,
      });
      const token = generateToken(seller);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(201);
      expect(lastOrder().user_id).toBe(seller.id);
    });

    it('rejeita produto de outro tenant', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product3Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
    });

    it('rejeita adicional de outro tenant', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1, addons: [{ addon_id: fx.addonCId, quantity: 1 }] }],
      }, token);

      expect(res.status).toBe(400);
    });

    it('registra combo com combo_id persistido no order_items (sem produto)', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ combo_id: fx.combo1Id, quantity: 2 }],
      }, token);

      expect(res.status).toBe(201);
      expect(res.data.total_cents).toBe(6000);
      const item = db.prepare('SELECT * FROM order_items ORDER BY id DESC LIMIT 1').get() as any;
      expect(item.product_id).toBeNull();
      expect(item.combo_id).toBe(fx.combo1Id);
      expect(item.price_cents).toBe(3000);
      expect(item.observation).toBe('Combo Teste');
    });

    it('rejeita item com product_id e combo_id ao mesmo tempo (XOR)', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, combo_id: fx.combo1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('product_id ou combo_id');
    });

    it('rejeita combo de outro tenant', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ combo_id: fx.combo2Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
    });

    it('rejeita combo inativo', async () => {
      db.prepare('UPDATE combos SET active = 0 WHERE id = ?').run(fx.combo1Id);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ combo_id: fx.combo1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
    });

    it('rejeita combo inexistente', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ combo_id: 999999, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
    });

    it('calcula total no backend e aplica desconto válido', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        unit_price_cents: 100000,
        subtotal_cents: 9999,
        total_cents: 1,
        discount_cents: 500,
        items: [{ product_id: fx.product1Id, quantity: 2, unit_price_cents: 100000 }],
      }, token);

      expect(res.status).toBe(201);
      // subtotal backend = 2000 * 2 = 4000; desconto 500 → total 3500
      expect(res.data.subtotal_cents).toBe(4000);
      expect(res.data.discount_cents).toBe(500);
      expect(res.data.total_cents).toBe(3500);
      const order = lastOrder();
      expect(order.subtotal_cents).toBe(4000);
      expect(order.discount_cents).toBe(500);
      expect(order.total_cents).toBe(3500);
    });

    it('rejeita desconto maior que o subtotal', async () => {
      const token = generateToken(adminUser);
      const before = (db.prepare('SELECT COUNT(*) AS c FROM orders').get() as any).c;
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        discount_cents: 9900,
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('desconto');
      const after = (db.prepare('SELECT COUNT(*) AS c FROM orders').get() as any).c;
      expect(after).toBe(before);
    });

    it('rejeita desconto inválido (negativo, fracionado ou texto)', async () => {
      const token = generateToken(adminUser);
      for (const discount of [-1, 1.5, 'abc']) {
        const res = await apiRequest('POST', '/api/orders/presencial', {
          customer_name: 'Cliente Balcão',
          customer_phone: '22999999999',
          discount_cents: discount,
          items: [{ product_id: fx.product1Id, quantity: 1 }],
        }, token);
        expect(res.status).toBe(400);
      }
    });

    it('fiado não marca paid_at (crédito com vencimento posterior)', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'fiado',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(201);
      expect(res.data.paid_at).toBeNull();
      expect(lastOrder().paid_at).toBeNull();
    });

    it('pagamento normal marca paid_at na criação', async () => {
      const token = generateToken(adminUser);
      for (const method of ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito']) {
        const res = await apiRequest('POST', '/api/orders/presencial', {
          customer_name: 'Cliente Balcão',
          customer_phone: '22999999999',
          payment_method: method,
          items: [{ product_id: fx.product1Id, quantity: 1 }],
        }, token);
        expect(res.status).toBe(201);
        expect(res.data.paid_at).toBeTruthy();
        expect(lastOrder().paid_at).toBeTruthy();
        expect(lastOrder().payment_method).toBe(method);
      }
    });

    it('normaliza aliases de forma de pagamento', async () => {
      const token = generateToken(adminUser);
      const deb = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'DeBito',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);
      expect(deb.status).toBe(201);
      expect(lastOrder().payment_method).toBe('cartao_debito');

      const cred = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'crediário',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);
      expect(cred.status).toBe(201);
      expect(lastOrder().payment_method).toBe('fiado');
      expect(lastOrder().paid_at).toBeNull();
    });

    it('rejeita forma de pagamento desconhecida', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'bitcoin',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(400);
      expect(res.data.error).toContain('pagamento');
    });

    it('aplica delivery_type retirada por padrão no presencial', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(201);
      expect(res.data.delivery_type).toBe('retirada');
      expect(lastOrder().delivery_type).toBe('retirada');
    });

    it('persiste customer_id como nulo (tabela customers adiada para Fase 5)', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      expect(res.status).toBe(201);
      expect(lastOrder().customer_id).toBeNull();
    });
  });

  describe('Ciclo de status, conclusão e isolamento', () => {
    it('cancelamento não apaga o histórico (mantém a venda)', async () => {
      const token = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'pix',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);
      expect(created.status).toBe(201);

      const cancelled = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(cancelled.status).toBe(200);
      expect(cancelled.data.status).toBe('cancelado');

      const detail = await apiRequest('GET', `/api/orders/${created.data.order_id}`, undefined, token);
      expect(detail.status).toBe(200);
      expect(detail.data.status).toBe('cancelado');
      expect(detail.data.items).toHaveLength(1);
    });

    it('concluir pedido online não-fiado marca completed_at e paid_at', async () => {
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste',
        customer_phone: '22999999999',
        payment_method: 'pix',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });
      expect(created.status).toBe(201);

      const token = generateToken(adminUser);
      for (const st of ['confirmado', 'em_preparacao', 'pronto', 'entregue']) {
        const res = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: st }, token);
        expect(res.status).toBe(200);
      }

      const order = lastOrder();
      expect(order.status).toBe('entregue');
      expect(order.completed_at).toBeTruthy();
      expect(order.paid_at).toBeTruthy();
    });

    it('venda presencial fiado continua sem paid_at mesmo concluída', async () => {
      const token = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'fiado',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);
      expect(created.status).toBe(201);

      for (const st of ['confirmado', 'em_preparacao', 'pronto', 'entregue']) {
        const res = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: st }, token);
        expect(res.status).toBe(200);
      }

      const order = lastOrder();
      expect(order.status).toBe('entregue');
      expect(order.completed_at).toBeTruthy();
      expect(order.paid_at).toBeNull();
    });

    it('isola pedidos por tenant na venda presencial', async () => {
      const token1 = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'pix',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token1);
      expect(created.status).toBe(201);

      const token2 = generateToken(adminUser2);
      const detail = await apiRequest('GET', `/api/orders/${created.data.order_id}`, undefined, token2);
      expect(detail.status).toBe(404);
    });

    it('lista suporta filtro por source e distingue online de presencial', async () => {
      const token = generateToken(adminUser);
      await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Online',
        customer_phone: '22999999999',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      });
      await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'pix',
        items: [{ product_id: fx.product1Id, quantity: 1 }],
      }, token);

      const all = await apiRequest('GET', '/api/orders', undefined, token);
      expect(all.status).toBe(200);
      expect(all.data).toHaveLength(2);

      const online = await apiRequest('GET', '/api/orders?source=online', undefined, token);
      expect(online.data).toHaveLength(1);
      expect(online.data[0].source).toBe('online');

      const presencial = await apiRequest('GET', '/api/orders?source=presencial', undefined, token);
      expect(presencial.data).toHaveLength(1);
      expect(presencial.data[0].source).toBe('presencial');
    });

    it('detalhe devolve combo por nome usando combo_id', async () => {
      const token = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão',
        customer_phone: '22999999999',
        payment_method: 'pix',
        items: [{ combo_id: fx.combo1Id, quantity: 1 }],
      }, token);
      expect(created.status).toBe(201);

      const detail = await apiRequest('GET', `/api/orders/${created.data.order_id}`, undefined, token);
      expect(detail.status).toBe(200);
      expect(detail.data.items).toHaveLength(1);
      expect(detail.data.items[0].combo_id).toBe(fx.combo1Id);
      expect(detail.data.items[0].product_name).toBe('Combo Teste');
    });
  });
});