import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { db, migrateSchema } from '../src/db.js';
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
  catT2Id: number;
  p1: number;
  p3: number;
  p4: number;
  pT2: number;
  addonA: number;
  combo1: number;
  combo2: number;
}

let fx: Fixture;

const TS = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 19).replace('T', ' ');
})();

function seedFixtures() {
  db.prepare('DELETE FROM order_item_addons').run();
  db.prepare('DELETE FROM order_items').run();
  db.prepare('DELETE FROM stock_movements').run();
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM combo_items').run();
  db.prepare('DELETE FROM combos').run();
  db.prepare('DELETE FROM product_addons').run();
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM addons').run();
  db.prepare('DELETE FROM categories').run();
  db.prepare('DELETE FROM companies WHERE id != 1');

  const company = db.prepare("INSERT INTO companies (name, slug, status, created_at, updated_at) VALUES (?, ?, 'ativo', ?, ?)")
    .run('Loja Teste 2', 'loja-teste-2-' + Date.now(), TS, TS);
  company2Id = Number(company.lastInsertRowid);

  const insCat = db.prepare("INSERT INTO categories (name, active, company_id, created_at) VALUES (?, 1, ?, ?)");
  const cat1Id = Number(insCat.run('Cat Stock T1', 1, TS).lastInsertRowid);
  const catT2Id = Number(insCat.run('Cat Stock Loja 2', company2Id, TS).lastInsertRowid);

  const insProduct = db.prepare(
    "INSERT INTO products (name, description, category_id, sale_price_cents, image_url, active, company_id, created_at, stock, min_stock) VALUES (?, '', ?, ?, '', 1, ?, ?, 0, 0)"
  );
  const p1 = Number(insProduct.run('Produto A', cat1Id, 2000, 1, TS).lastInsertRowid);
  const p3 = Number(insProduct.run('Produto B', cat1Id, 1500, 1, TS).lastInsertRowid);
  const p4 = Number(insProduct.run('Produto C', cat1Id, 1000, 1, TS).lastInsertRowid);
  const pT2 = Number(insProduct.run('Produto Loja 2', catT2Id, 999, company2Id, TS).lastInsertRowid);

  const addonA = Number(db.prepare("INSERT INTO addons (name, price_cents, active, company_id, created_at) VALUES (?, ?, 1, ?, ?)").run('Adicional A', 300, 1, TS).lastInsertRowid);
  db.prepare("INSERT INTO product_addons (product_id, addon_id, company_id, created_at) VALUES (?, ?, ?, ?)").run(p1, addonA, 1, TS);

  const combo1 = Number(db.prepare("INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at) VALUES (?, '', 5000, 1, ?, ?)").run('Combo A', 1, TS).lastInsertRowid);
  const combo2 = Number(db.prepare("INSERT INTO combos (name, description, sale_price_cents, active, company_id, created_at) VALUES (?, '', 6000, 1, ?, ?)").run('Combo Loja 2', company2Id, TS).lastInsertRowid);

  db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, 1, ?, ?)").run(combo1, p1, 1, TS);
  db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, 1, ?, ?)").run(combo1, p3, 1, TS);
  db.prepare("INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, 1, ?, ?)").run(combo2, pT2, company2Id, TS);

  fx = { cat1Id, catT2Id, p1, p3, p4, pT2, addonA, combo1, combo2 };
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

function setStock(productId: number, qty: number) {
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(qty, productId);
}
function setMin(productId: number, m: number) {
  db.prepare('UPDATE products SET min_stock = ? WHERE id = ?').run(m, productId);
}
function stockOf(productId: number): number {
  return (db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as any).stock;
}
function countOrders(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM orders').get() as any).c;
}
function countMovements(opts?: { type?: string; product_id?: number; order_id?: number }): number {
  const conds: string[] = [];
  const params: any[] = [];
  if (opts?.type) { conds.push('type = ?'); params.push(opts.type); }
  if (opts?.product_id) { conds.push('product_id = ?'); params.push(opts.product_id); }
  if (opts?.order_id) { conds.push("reference_type = 'order' AND reference_id = ?"); params.push(opts.order_id); }
  const sql = `SELECT COUNT(*) AS c FROM stock_movements ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
  return (db.prepare(sql).get(...params) as any).c;
}
function lastMovement() {
  return db.prepare('SELECT * FROM stock_movements ORDER BY id DESC LIMIT 1').get() as any;
}

describe('FASE 4B — Backend de estoque por produto', () => {
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
    // Limpa primeiro as linhas dependentes (movimentações/pedidos referenciam users),
    // depois remove os usuários de teste e recria os fixtures.
    seedFixtures();
    cleanupTestData();
    adminUser = createTestUser({ name: 'Admin Loja 1', email: 'test-admin4b@bruceburguer.com', password: 'Admin@123', role: 'admin', company_id: 1 });
    adminUser2 = createTestUser({ name: 'Admin Loja 2', email: 'test-admin4b2@bruceburguer.com', password: 'Admin@123', role: 'admin', company_id: company2Id });
    sellerUser = createTestUser({ name: 'Vendedora 1', email: 'test-seller4b@bruceburguer.com', password: 'Admin@123', role: 'vendedora', company_id: 1 });
  });

  describe('Produtos e schema de estoque', () => {
    it('schema de estoque existe e a migração é idempotente', async () => {
      const prodCols = db.prepare('PRAGMA table_info(products)').all() as any[];
      expect(prodCols.filter((c) => c.name === 'stock').length).toBe(1);
      expect(prodCols.filter((c) => c.name === 'min_stock').length).toBe(1);

      const movCols = db.prepare('PRAGMA table_info(stock_movements)').all() as any[];
      const names = movCols.map((c) => c.name);
      for (const col of ['company_id', 'product_id', 'type', 'quantity', 'stock_before', 'stock_after', 'created_at']) {
        expect(names).toContain(col);
      }

      migrateSchema();
      migrateSchema();
      const prodColsAfter = db.prepare('PRAGMA table_info(products)').all() as any[];
      expect(prodColsAfter.filter((c) => c.name === 'stock').length).toBe(1);
      expect(prodColsAfter.filter((c) => c.name === 'min_stock').length).toBe(1);
    });

    it('produto criado sem campos de estoque tem stock e min_stock 0, sem histórico', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/products', {
        name: 'Sem Estoque', category_id: fx.cat1Id, sale_price_cents: 1000,
      }, token);
      expect(res.status).toBe(200);
      const detail = await apiRequest('GET', `/api/products/${res.data.id}`, undefined, token);
      expect(detail.data.stock).toBe(0);
      expect(detail.data.min_stock).toBe(0);
      expect(countMovements({ product_id: res.data.id })).toBe(0);
    });

    it('cria produto com estoque inicial e registra movimentação de entrada', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/products', {
        name: 'Com Estoque', category_id: fx.cat1Id, sale_price_cents: 1000, stock: 5, min_stock: 1,
      }, token);
      expect(res.status).toBe(200);
      const detail = await apiRequest('GET', `/api/products/${res.data.id}`, undefined, token);
      expect(detail.data.stock).toBe(5);
      expect(detail.data.min_stock).toBe(1);
      const mov = db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(res.data.id) as any;
      expect(mov.type).toBe('entrada');
      expect(mov.quantity).toBe(5);
      expect(mov.stock_before).toBe(0);
      expect(mov.stock_after).toBe(5);
      expect(mov.reason).toContain('Estoque inicial');
    });

    it('rejeita estoque inicial inválido (negativo, fracionado, texto)', async () => {
      const token = generateToken(adminUser);
      for (const stock of [-1, 2.5, 'abc']) {
        const res = await apiRequest('POST', '/api/products', {
          name: 'Invalido', category_id: fx.cat1Id, sale_price_cents: 1000, stock,
        }, token);
        expect(res.status).toBe(400);
      }
    });

    it('rejeita min_stock inválido', async () => {
      const token = generateToken(adminUser);
      for (const min of [-1, 1.5, 'abc']) {
        const res = await apiRequest('POST', '/api/products', {
          name: 'Min Invalido', category_id: fx.cat1Id, sale_price_cents: 1000, min_stock: min,
        }, token);
        expect(res.status).toBe(400);
      }
    });

    it('PUT atualiza min_stock mantendo o estoque atual', async () => {
      setStock(fx.p1, 7);
      const token = generateToken(adminUser);
      const res = await apiRequest('PUT', `/api/products/${fx.p1}`, {
        name: 'Produto A', category_id: fx.cat1Id, sale_price_cents: 2000, min_stock: 2,
      }, token);
      expect(res.status).toBe(200);
      const detail = await apiRequest('GET', `/api/products/${fx.p1}`, undefined, token);
      expect(detail.data.min_stock).toBe(2);
      expect(detail.data.stock).toBe(7);
    });

    it('PUT rejeita alteração direta de stock (deve usar movimentações)', async () => {
      setStock(fx.p1, 7);
      const token = generateToken(adminUser);
      const res = await apiRequest('PUT', `/api/products/${fx.p1}`, {
        name: 'Produto A', category_id: fx.cat1Id, sale_price_cents: 2000, stock: 999,
      }, token);
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('movimenta');
      expect(stockOf(fx.p1)).toBe(7);
    });

    it('lista e detalhe de produtos incluem stock e min_stock', async () => {
      setStock(fx.p1, 7);
      setMin(fx.p3, 3);
      const token = generateToken(adminUser);
      const list = await apiRequest('GET', '/api/products', undefined, token);
      expect(list.status).toBe(200);
      const p1 = list.data.find((p: any) => p.id === fx.p1);
      expect(p1.stock).toBe(7);
      expect(p1.min_stock).toBe(0);
      const detail = await apiRequest('GET', `/api/products/${fx.p3}`, undefined, token);
      expect(detail.data.stock).toBe(0);
      expect(detail.data.min_stock).toBe(3);
    });
  });

  describe('Movimentações manuais (POST /api/stock/movements)', () => {
    it('entrada aumenta o estoque com razão e histórico correto', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'entrada', quantity: 5, reason: 'reposição',
      }, token);
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(5);
      const mov = lastMovement();
      expect(mov.type).toBe('entrada');
      expect(mov.quantity).toBe(5);
      expect(mov.stock_before).toBe(0);
      expect(mov.stock_after).toBe(5);
      expect(mov.reason).toBe('reposição');
    });

    it('entrada rejeita quantidade inválida (0, negativa, fracionada, texto)', async () => {
      const token = generateToken(adminUser);
      for (const qty of [0, -3, 2.5, 'abc']) {
        const res = await apiRequest('POST', '/api/stock/movements', {
          product_id: fx.p1, type: 'entrada', quantity: qty,
        }, token);
        expect(res.status).toBe(400);
      }
      expect(stockOf(fx.p1)).toBe(0);
    });

    it('saída reduz o estoque quando há saldo', async () => {
      setStock(fx.p1, 10);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'saida', quantity: 3, reason: 'descarte',
      }, token);
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(7);
      const mov = lastMovement();
      expect(mov.type).toBe('saida');
      expect(mov.quantity).toBe(3);
      expect(mov.stock_before).toBe(10);
      expect(mov.stock_after).toBe(7);
    });

    it('saída insuficiente é rejeitada e o estoque nunca fica negativo', async () => {
      setStock(fx.p1, 2);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'saida', quantity: 5,
      }, token);
      expect(res.status).toBe(400);
      expect(stockOf(fx.p1)).toBe(2);
      expect(countMovements({ type: 'saida' })).toBe(0);
    });

    it('ajuste para estoque-alvo funciona (8 -> 5: quantity 3, before 8, after 5)', async () => {
      setStock(fx.p1, 8);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'ajuste', target_stock: 5, reason: 'conferência',
      }, token);
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(5);
      const mov = lastMovement();
      expect(mov.type).toBe('ajuste');
      expect(mov.quantity).toBe(3);
      expect(mov.stock_before).toBe(8);
      expect(mov.stock_after).toBe(5);
    });

    it('ajuste rejeita target_stock inválido ou ausente e mantém estoque', async () => {
      setStock(fx.p1, 8);
      const token = generateToken(adminUser);
      const neg = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'ajuste', target_stock: -1,
      }, token);
      expect(neg.status).toBe(400);
      const missing = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'ajuste', quantity: 5,
      }, token);
      expect(missing.status).toBe(400);
      expect(stockOf(fx.p1)).toBe(8);
    });

    it('venda e estorno não são aceitos pela API manual', async () => {
      const token = generateToken(adminUser);
      for (const type of ['venda', 'estorno']) {
        const res = await apiRequest('POST', '/api/stock/movements', {
          product_id: fx.p1, type, quantity: 1,
        }, token);
        expect(res.status).toBe(400);
      }
    });

    it('movimentação manual exige admin (vendedora recebe 403)', async () => {
      const token = generateToken(sellerUser);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'entrada', quantity: 5,
      }, token);
      expect(res.status).toBe(403);
    });

    it('rejeita movimentação de produto de outro tenant', async () => {
      const token = generateToken(adminUser2);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: fx.p1, type: 'entrada', quantity: 5,
      }, token);
      expect(res.status).toBe(400);
      expect(stockOf(fx.p1)).toBe(0);
    });

    it('rejeita movimentação de produto inexistente', async () => {
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/stock/movements', {
        product_id: 999999, type: 'entrada', quantity: 5,
      }, token);
      expect(res.status).toBe(400);
    });
  });

  describe('Resumo e histórico (GET /api/stock)', () => {
    it('calcula status out, low e ok por produto', async () => {
      setStock(fx.p1, 0);
      setStock(fx.p3, 5);
      setMin(fx.p3, 5);
      setStock(fx.p4, 10);
      setMin(fx.p4, 0);
      const token = generateToken(adminUser);
      const res = await apiRequest('GET', '/api/stock', undefined, token);
      expect(res.status).toBe(200);
      const byId = new Map(res.data.map((r: any) => [r.product_id, r.status]));
      expect(byId.get(fx.p1)).toBe('out');
      expect(byId.get(fx.p3)).toBe('low');
      expect(byId.get(fx.p4)).toBe('ok');
    });

    it('filtra o resumo por status', async () => {
      setStock(fx.p1, 0);
      setStock(fx.p3, 5);
      setMin(fx.p3, 5);
      setStock(fx.p4, 10);
      const token = generateToken(adminUser);
      const out = await apiRequest('GET', '/api/stock?status=out', undefined, token);
      expect(out.data.every((r: any) => r.status === 'out')).toBe(true);
      expect(out.data.some((r: any) => r.product_id === fx.p1)).toBe(true);
    });

    it('histórico devolve product_name e user_name', async () => {
      const token = generateToken(adminUser);
      await apiRequest('POST', '/api/stock/movements', { product_id: fx.p1, type: 'entrada', quantity: 5 }, token);
      const res = await apiRequest('GET', '/api/stock/movements', undefined, token);
      expect(res.status).toBe(200);
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data[0].product_name).toBe('Produto A');
      expect(res.data[0].user_name).toBe('Admin Loja 1');
    });

    it('histórico filtra por tipo e por produto', async () => {
      const token = generateToken(adminUser);
      await apiRequest('POST', '/api/stock/movements', { product_id: fx.p1, type: 'entrada', quantity: 5 }, token);
      await apiRequest('POST', '/api/stock/movements', { product_id: fx.p3, type: 'entrada', quantity: 2 }, token);
      setStock(fx.p1, 5);
      await apiRequest('POST', '/api/stock/movements', { product_id: fx.p1, type: 'saida', quantity: 1 }, token);
      const byP = await apiRequest('GET', `/api/stock/movements?product_id=${fx.p3}`, undefined, token);
      expect(byP.data).toHaveLength(1);
      expect(byP.data[0].product_id).toBe(fx.p3);
      const byT = await apiRequest('GET', '/api/stock/movements?type=saida', undefined, token);
      expect(byT.data).toHaveLength(1);
      expect(byT.data[0].type).toBe('saida');
    });

    it('rotas de estoque exigem autenticação (401)', async () => {
      const list = await apiRequest('GET', '/api/stock');
      expect(list.status).toBe(401);
      const mov = await apiRequest('GET', '/api/stock/movements');
      expect(mov.status).toBe(401);
      const post = await apiRequest('POST', '/api/stock/movements', { product_id: fx.p1, type: 'entrada', quantity: 1 });
      expect(post.status).toBe(401);
    });
  });

  describe('Venda presencial baixa estoque', () => {
    it('venda presencial baixa o estoque do produto', async () => {
      setStock(fx.p1, 10);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 3 }],
      }, token);
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(7);
      const mov = lastMovement();
      expect(mov.type).toBe('venda');
      expect(mov.quantity).toBe(3);
      expect(mov.reference_type).toBe('order');
      expect(mov.reference_id).toBe(res.data.order_id);
    });

    it('combo baixa componentes multiplicados pela quantidade', async () => {
      setStock(fx.p1, 50);
      setStock(fx.p3, 50);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ combo_id: fx.combo1, quantity: 2 }],
      }, token);
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(48);
      expect(stockOf(fx.p3)).toBe(48);
      const venda = db.prepare("SELECT * FROM stock_movements WHERE type = 'venda' AND reference_id = ? ORDER BY product_id").all(res.data.order_id) as any[];
      expect(venda).toHaveLength(2);
      for (const v of venda) expect(v.quantity).toBe(2);
    });

    it('adicionais não consomem estoque', async () => {
      setStock(fx.p1, 10);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999',
        items: [{ product_id: fx.p1, quantity: 1, addons: [{ addon_id: fx.addonA, quantity: 2 }] }],
      }, token);
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(9);
      expect(countMovements({ order_id: res.data.order_id })).toBe(1);
    });

    it('venda presencial com estoque insuficiente falha sem criar pedido nem movimento', async () => {
      setStock(fx.p1, 1);
      const token = generateToken(adminUser);
      const beforeOrders = countOrders();
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 5 }],
      }, token);
      expect(res.status).toBe(400);
      expect(res.data.error).toContain('Estoque insuficiente');
      expect(countOrders()).toBe(beforeOrders);
      expect(stockOf(fx.p1)).toBe(1);
      expect(countMovements({ type: 'venda' })).toBe(0);
    });

    it('combo com componente insuficiente reverte a venda inteira', async () => {
      setStock(fx.p1, 1);
      setStock(fx.p3, 100);
      const token = generateToken(adminUser);
      const beforeOrders = countOrders();
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ combo_id: fx.combo1, quantity: 2 }],
      }, token);
      expect(res.status).toBe(400);
      expect(countOrders()).toBe(beforeOrders);
      expect(stockOf(fx.p1)).toBe(1);
      expect(stockOf(fx.p3)).toBe(100);
      expect(countMovements({ type: 'venda' })).toBe(0);
    });
  });

  describe('Venda online e confirmação', () => {
    it('pedido online em novo não baixa estoque', async () => {
      setStock(fx.p1, 10);
      const res = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 2 }],
      });
      expect(res.status).toBe(201);
      expect(stockOf(fx.p1)).toBe(10);
      expect(countMovements({ order_id: res.data.order_id })).toBe(0);
    });

    it('confirmação novo -> confirmado baixa estoque do pedido', async () => {
      setStock(fx.p1, 10);
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 2 }],
      });
      expect(created.status).toBe(201);
      const token = generateToken(adminUser);
      const conf = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'confirmado' }, token);
      expect(conf.status).toBe(200);
      expect(stockOf(fx.p1)).toBe(8);
      const mov = lastMovement();
      expect(mov.type).toBe('venda');
      expect(mov.quantity).toBe(2);
      expect(mov.reference_id).toBe(created.data.order_id);
    });

    it('reconfirmar a mesma transição não baixa duas vezes', async () => {
      setStock(fx.p1, 10);
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 2 }],
      });
      const token = generateToken(adminUser);
      await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'confirmado' }, token);
      const again = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'confirmado' }, token);
      expect(again.status).toBe(200);
      expect(countMovements({ order_id: created.data.order_id, type: 'venda' })).toBe(1);
      expect(stockOf(fx.p1)).toBe(8);
    });

    it('confirmar sem estoque falha, permanece novo e sem movimentação', async () => {
      setStock(fx.p1, 0);
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 1 }],
      });
      expect(created.status).toBe(201);
      const token = generateToken(adminUser);
      const conf = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'confirmado' }, token);
      expect(conf.status).toBe(400);
      const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(created.data.order_id) as any;
      expect(order.status).toBe('novo');
      expect(countMovements({ order_id: created.data.order_id })).toBe(0);
      expect(stockOf(fx.p1)).toBe(0);
    });
  });

  describe('Cancelamento e estorno', () => {
    it('cancelar venda presencial estorna o estoque', async () => {
      setStock(fx.p1, 10);
      const token = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 3 }],
      }, token);
      expect(stockOf(fx.p1)).toBe(7);
      const canc = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(canc.status).toBe(200);
      expect(stockOf(fx.p1)).toBe(10);
      const est = lastMovement();
      expect(est.type).toBe('estorno');
      expect(est.quantity).toBe(3);
      expect(est.reference_id).toBe(created.data.order_id);
    });

    it('cancelar pedido online em novo (sem baixa) não gera estorno', async () => {
      setStock(fx.p1, 10);
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 2 }],
      });
      const token = generateToken(adminUser);
      const canc = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(canc.status).toBe(200);
      expect(countMovements({ order_id: created.data.order_id, type: 'estorno' })).toBe(0);
      expect(countMovements({ order_id: created.data.order_id })).toBe(0);
      expect(stockOf(fx.p1)).toBe(10);
    });

    it('cancelar pedido online confirmado estorna pelas quantidades originais', async () => {
      setStock(fx.p1, 10);
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 2 }],
      });
      const token = generateToken(adminUser);
      await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'confirmado' }, token);
      expect(stockOf(fx.p1)).toBe(8);
      await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(stockOf(fx.p1)).toBe(10);
      const est = lastMovement();
      expect(est.type).toBe('estorno');
      expect(est.quantity).toBe(2);
    });

    it('cancelar duas vezes não estorna duas vezes', async () => {
      setStock(fx.p1, 10);
      const token = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 3 }],
      }, token);
      await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      const again = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(again.status).toBe(200);
      expect(countMovements({ order_id: created.data.order_id, type: 'estorno' })).toBe(1);
      expect(stockOf(fx.p1)).toBe(10);
    });

    it('combo com receita alterada estorna usando as movimentações originais', async () => {
      setStock(fx.p1, 20);
      setStock(fx.p3, 20);
      setStock(fx.p4, 20);
      const token = generateToken(adminUser);
      const created = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ combo_id: fx.combo1, quantity: 1 }],
      }, token);
      expect(stockOf(fx.p1)).toBe(19);
      expect(stockOf(fx.p3)).toBe(19);
      // Troca a receita do combo ANTES do cancelamento
      db.prepare('DELETE FROM combo_items WHERE combo_id = ?').run(fx.combo1);
      db.prepare('INSERT INTO combo_items (combo_id, product_id, quantity, company_id, created_at) VALUES (?, ?, 1, ?, ?)')
        .run(fx.combo1, fx.p4, 1, TS);
      const canc = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(canc.status).toBe(200);
      expect(stockOf(fx.p1)).toBe(20);
      expect(stockOf(fx.p3)).toBe(20);
      expect(stockOf(fx.p4)).toBe(20);
      const estorno = db.prepare("SELECT product_id, quantity FROM stock_movements WHERE reference_id = ? AND type = 'estorno' ORDER BY product_id").all(created.data.order_id) as any[];
      expect(estorno.map((e) => e.product_id).sort((a: number, b: number) => a - b)).toEqual([fx.p1, fx.p3].sort((a: number, b: number) => a - b));
      expect(estorno.every((e) => e.quantity === 1)).toBe(true);
    });
  });

  describe('Transações, invariantes e concorrência', () => {
    it('estoque nunca fica negativo ao esgotar', async () => {
      setStock(fx.p1, 2);
      const token = generateToken(adminUser);
      await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 1 }],
      }, token);
      await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 1 }],
      }, token);
      expect(stockOf(fx.p1)).toBe(0);
      const fail = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 1 }],
      }, token);
      expect(fail.status).toBe(400);
      expect(stockOf(fx.p1)).toBe(0);
      expect(countOrders()).toBe(2);
    });

    it('venda multi-item é atômica: item 2 sem estoque reverte item 1 e o pedido', async () => {
      setStock(fx.p1, 5);
      setStock(fx.p3, 1);
      const token = generateToken(adminUser);
      const beforeOrders = countOrders();
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999',
        items: [{ product_id: fx.p1, quantity: 1 }, { product_id: fx.p3, quantity: 2 }],
      }, token);
      expect(res.status).toBe(400);
      expect(countOrders()).toBe(beforeOrders);
      expect(stockOf(fx.p1)).toBe(5);
      expect(stockOf(fx.p3)).toBe(1);
      expect(countMovements({ type: 'venda' })).toBe(0);
    });

    it('estorno de pedido sem baixa é no-op seguro (não quebra o cancelamento)', async () => {
      setStock(fx.p1, 4);
      const created = await apiRequest('POST', '/api/orders', {
        customer_name: 'Cliente Teste', customer_phone: '22999999999', items: [{ product_id: fx.p1, quantity: 1 }],
      });
      const token = generateToken(adminUser2);
      const canc = await apiRequest('PATCH', `/api/orders/${created.data.order_id}/status`, { status: 'cancelado' }, token);
      expect(canc.status).toBe(404);
      expect(countMovements({ type: 'estorno' })).toBe(0);
      expect(stockOf(fx.p1)).toBe(4);
    });
  });

  describe('Isolamento entre tenants', () => {
    it('resumo e histórico são isolados por tenant', async () => {
      setStock(fx.p1, 3);
      setStock(fx.pT2, 7);
      const token1 = generateToken(adminUser);
      const token2 = generateToken(adminUser2);
      const list1 = await apiRequest('GET', '/api/stock', undefined, token1);
      const list2 = await apiRequest('GET', '/api/stock', undefined, token2);
      expect(list1.data.some((r: any) => r.product_id === fx.p1)).toBe(true);
      expect(list1.data.some((r: any) => r.product_id === fx.pT2)).toBe(false);
      expect(list2.data.some((r: any) => r.product_id === fx.pT2)).toBe(true);
      expect(list2.data.some((r: any) => r.product_id === fx.p1)).toBe(false);
    });

    it('venda de um tenant não altera estoque de produto de outro tenant', async () => {
      setStock(fx.pT2, 10);
      setStock(fx.p1, 10);
      const token = generateToken(adminUser);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ product_id: fx.pT2, quantity: 1 }],
      }, token);
      expect(res.status).toBe(400);
      expect(stockOf(fx.pT2)).toBe(10);
      expect(countMovements({ type: 'venda' })).toBe(0);
    });

    it('combo de outro tenant não baixa estoque local', async () => {
      const token1 = generateToken(adminUser);
      const token2 = generateToken(adminUser2);
      const res = await apiRequest('POST', '/api/orders/presencial', {
        customer_name: 'Cliente Balcão', customer_phone: '22999999999', items: [{ combo_id: fx.combo2, quantity: 1 }],
      }, token1);
      expect(res.status).toBe(400);
      expect(countMovements({ type: 'venda' })).toBe(0);
    });
  });
});