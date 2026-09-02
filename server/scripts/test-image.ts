import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

type ApiResponse = { status: number; data: any };

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const testSecret = "image-test-secret-only-not-production-123456";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(base: string, method: string, route: string, body?: unknown, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Keep non-JSON error bodies out of the test output.
  }
  return { status: response.status, data };
}

async function requestRaw(base: string, route: string, body: Buffer, contentType: string, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": contentType,
    },
    body,
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Keep non-JSON error bodies out of the test output.
  }
  return { status: response.status, data };
}

async function fetchBytes(base: string, route: string): Promise<{ status: number; contentType: string; bytes: Buffer }> {
  const response = await fetch(`${base}${route}`);
  const buf = Buffer.from(await response.arrayBuffer());
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", bytes: buf };
}

function openDb(dbPath: string, readonly = false): Database.Database {
  const db = new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : {});
  db.pragma("busy_timeout = 5000");
  return db;
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  await wait(300);
}

function onboardingBody(slug: string, email: string, planId: number) {
  return {
    company: { name: `Image ${slug}`, slug, cnpj: "", phone: "11999990001" },
    admin: { name: "Administrador Image", email, password: "image123" },
    plan_id: planId,
  };
}

function jpegBytes(marker: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, marker & 0xff, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
}

function pngBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("PNGDATA123")]);
}

function webpBytes(): Buffer {
  return Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0x00, 0x00, 0x00]), Buffer.from("WEBP"), Buffer.from("VP8DATA")]);
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nyellen-image-test-"));
  const dbPath = path.join(tempDir, "image-test.db");
  const uploadsDir = path.join(tempDir, "uploads");
  let checks = 0;
  const pass = (condition: unknown, message: string) => {
    checks += 1;
    assert.ok(condition, message);
  };
  const equal = (actual: unknown, expected: unknown, message: string) => {
    checks += 1;
    assert.deepEqual(actual, expected, message);
  };
  const gone = async (file: string): Promise<boolean> => (await fs.stat(file).then(() => false).catch(() => true));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tsx = path.join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_INIT: "demo",
      DB_PATH: dbPath,
      LEGACY_COMPANY_ID: "1",
      PUBLIC_COMPANY_ID: "1",
      PORT: String(port),
      HOST: "127.0.0.1",
      JWT_SECRET: testSecret,
      UPLOADS_DIR: uploadsDir,
    },
    stdio: "ignore",
  });

  const fileFor = (imageUrl: string): string => path.join(uploadsDir, imageUrl.slice("/uploads/".length));
  const imageUrlOf = (productId: number, ext: string): string => `/uploads/products/company-1/${productId}.${ext}`;

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const health = await request(base, "GET", "/api/health");
        if (health.status === 200 && health.data?.ok) {
          healthy = true;
          break;
        }
      } catch {
        // still starting
      }
      await wait(500);
    }
    pass(healthy, "API não iniciou no banco temporário com seed demo");

    // ------------------------------ Logins ------------------------------
    const rayaneLogin = await request(base, "POST", "/api/auth/login", { email: "raiani@nyellen.local", password: "Rayane@123" });
    const amandaLogin = await request(base, "POST", "/api/auth/login", { email: "amanda@nyellen.local", password: "Amanda@123" });
    const alanaLogin = await request(base, "POST", "/api/auth/login", { email: "alana@nyellen.local", password: "Alana@123" });
    equal(rayaneLogin.status, 200, "login Rayane");
    equal(amandaLogin.status, 200, "login Amanda");
    equal(alanaLogin.status, 200, "login Alana");
    const rayaneToken = rayaneLogin.data.token as string;
    const amandaToken = amandaLogin.data.token as string;
    const alanaToken = alanaLogin.data.token as string;

    // ----------------------- Catálogo para o produto -----------------------
    const category = await request(base, "POST", "/api/categories", { name: "Categoria Foto" }, amandaToken);
    const color = await request(base, "POST", "/api/colors", { name: "Cor Foto", hex: "#aabbcc" }, amandaToken);
    const size = await request(base, "POST", "/api/sizes", { name: "Tamanho Foto" }, amandaToken);
    equal(category.status, 201, "categoria criada");
    equal(color.status, 201, "cor criada");
    equal(size.status, 201, "tamanho criado");

    // 1. Funcionária cadastra produto sem foto
    const create = await request(base, "POST", "/api/products", {
      name: "Produto Foto",
      sku: "FOTO-001",
      description: "",
      category_id: category.data.id,
      cost_price_cents: 1000,
      sale_price_cents: 1500,
      image_url: "",
      variations: [{ color_id: color.data.id, size_id: size.data.id, stock: 5, min_stock: 1 }],
    }, amandaToken);
    equal(create.status, 201, "1. funcionária cadastra produto");
    const productId = create.data.id as number;
    {
      const dbv = openDb(dbPath, true);
      equal((dbv.prepare("SELECT image_url FROM products WHERE id = ?").get(productId) as { image_url: string }).image_url, "", "1b. produto criado sem foto");
      dbv.close();
    }

    // 2-4. Upload JPG / PNG / WEBP
    const jpg = jpegBytes(0x01);
    const upJpg = await requestRaw(base, `/api/products/${productId}/image`, jpg, "image/jpeg", amandaToken);
    equal(upJpg.status, 200, "2. upload de foto JPG aceito");
    equal(upJpg.data.image_url, imageUrlOf(productId, "jpeg"), "2b. URL da foto segue o padrão com tenant");
    const png = pngBytes();
    const upPng = await requestRaw(base, `/api/products/${productId}/image`, png, "image/png", amandaToken);
    equal(upPng.status, 200, "3. upload de foto PNG aceito");
    equal(upPng.data.image_url, imageUrlOf(productId, "png"), "3b. extensão PNG aplicada");
    const webp = webpBytes();
    const upWebp = await requestRaw(base, `/api/products/${productId}/image`, webp, "image/webp", amandaToken);
    equal(upWebp.status, 200, "4. upload de foto WEBP aceito");
    equal(upWebp.data.image_url, imageUrlOf(productId, "webp"), "4b. extensão WEBP aplicada");

    // 5. GET /:id reflete a foto
    const getProduct = await request(base, "GET", `/api/products/${productId}`, undefined, amandaToken);
    equal(getProduct.status, 200, "5. produto consultado");
    equal(getProduct.data.image_url, upWebp.data.image_url, "5b. GET /:id retorna a foto persistida");

    // 6. Arquivo gravado no disco idêntico ao enviado
    equal(Buffer.compare(await fs.readFile(fileFor(upWebp.data.image_url)), webp), 0, "6. bytes gravados no disco idênticos ao enviado");

    // 7. Foto servida publicamente (sem token)
    const served = await fetchBytes(base, upWebp.data.image_url);
    equal(served.status, 200, "7. foto servida via /uploads");
    equal(served.contentType, "image/webp", "7b. Content-Type da foto servida correto");
    equal(Buffer.compare(served.bytes, webp), 0, "7c. bytes servidos idênticos ao enviado");

    // 8-14. Validações
    equal((await requestRaw(base, `/api/products/${productId}/image`, jpg, "text/plain", amandaToken)).status, 415, "8. tipo de conteúdo não suportado rejeitado");
    equal((await request(base, "POST", `/api/products/${productId}/image`, { foo: "bar" }, amandaToken)).status, 415, "9. corpo JSON rejeitado no endpoint de imagem");
    equal((await requestRaw(base, `/api/products/${productId}/image`, Buffer.from("nao sou imagem"), "image/png", amandaToken)).status, 415, "10. conteúdo não-imagem rejeitado (magic bytes)");
    equal((await requestRaw(base, `/api/products/${productId}/image`, jpegBytes(0x02), "image/png", amandaToken)).status, 415, "11. magic bytes divergentes do content-type rejeitados");
    equal((await requestRaw(base, `/api/products/${productId}/image`, jpg, "image/jpeg")).status, 401, "12. upload sem token rejeitado");
    equal((await requestRaw(base, `/api/products/999999/image`, jpg, "image/jpeg", amandaToken)).status, 404, "13. upload para produto inexistente retorna 404");
    const big = Buffer.concat([jpegBytes(0x03), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    equal((await requestRaw(base, `/api/products/${productId}/image`, big, "image/jpeg", amandaToken)).status, 413, "14. foto acima de 5 MB rejeitada (413)");

    // 15. Funcionária da mesma loja atualiza a foto
    equal((await requestRaw(base, `/api/products/${productId}/image`, pngBytes(), "image/png", alanaToken)).status, 200, "15. outra funcionária da mesma loja pode atualizar a foto");

    // 16. Tenant B não acessa produto do tenant A
    const plans = await request(base, "GET", "/api/onboarding/plans");
    const planId = plans.data[0].id as number;
    const tenantB = await request(base, "POST", "/api/onboarding", onboardingBody("image-beta", "beta@image.test", planId));
    equal(tenantB.status, 201, "tenant B criado");
    const tenantBLogin = await request(base, "POST", "/api/auth/login", { email: "beta@image.test", password: "image123" });
    const tenantBToken = tenantBLogin.data.token as string;
    equal((await requestRaw(base, `/api/products/${productId}/image`, jpegBytes(0x04), "image/jpeg", tenantBToken)).status, 404, "16. Tenant B NÃO envia foto no produto do tenant A");
    equal((await request(base, "DELETE", `/api/products/${productId}/image`, undefined, tenantBToken)).status, 404, "16b. Tenant B NÃO remove foto do tenant A");

    // 17. Substituição remove o arquivo antigo (sem órfãos)
    {
      const dbv = openDb(dbPath, true);
      const beforeUrl = (dbv.prepare("SELECT image_url FROM products WHERE id = ?").get(productId) as { image_url: string }).image_url;
      dbv.close();
      const replace = await requestRaw(base, `/api/products/${productId}/image`, jpegBytes(0x05), "image/jpeg", rayaneToken);
      equal(replace.status, 200, "17. foto substituída pela Rayane");
      equal(replace.data.image_url, imageUrlOf(productId, "jpeg"), "17b. nova URL após substituição");
      pass(await gone(fileFor(beforeUrl)), "17c. arquivo antigo removido do disco após substituição");
      const dbv2 = openDb(dbPath, true);
      equal((dbv2.prepare("SELECT image_url FROM products WHERE id = ?").get(productId) as { image_url: string }).image_url, replace.data.image_url, "17d. banco aponta para a nova foto");
      dbv2.close();
    }

    // 18. Remoção da foto
    const del = await request(base, "DELETE", `/api/products/${productId}/image`, undefined, alanaToken);
    equal(del.status, 200, "18. foto removida");
    {
      const dbv = openDb(dbPath, true);
      equal((dbv.prepare("SELECT image_url FROM products WHERE id = ?").get(productId) as { image_url: string }).image_url, "", "18b. image_url limpo no banco");
      dbv.close();
    }
    pass(await gone(fileFor(imageUrlOf(productId, "jpeg"))), "18c. arquivo da foto removida excluído do disco");

    // 19. Remover foto de produto sem foto é idempotente
    equal((await request(base, "DELETE", `/api/products/${productId}/image`, undefined, amandaToken)).status, 200, "19. remover foto de produto sem foto retorna ok");

    // 20. PUT com URL externa limpa foto local
    const upAgain = await requestRaw(base, `/api/products/${productId}/image`, pngBytes(), "image/png", amandaToken);
    equal(upAgain.status, 200, "produto com foto novamente");
    const putExt = await request(base, "PUT", `/api/products/${productId}`, {
      name: "Produto Foto",
      sku: "FOTO-001",
      description: "",
      category_id: category.data.id,
      cost_price_cents: 1000,
      sale_price_cents: 1500,
      image_url: "https://cdn.example.com/foto.png",
      active: true,
      variations: [{ color_id: color.data.id, size_id: size.data.id, stock: 5, min_stock: 1 }],
    }, amandaToken);
    equal(putExt.status, 200, "20. PUT com URL externa aceito");
    pass(await gone(fileFor(upAgain.data.image_url)), "20b. arquivo local removido ao trocar por URL externa");

    // 21. Tenant B cria produto e foto própria (isolamento positivo)
    const bCategory = await request(base, "POST", "/api/categories", { name: "Categoria B" }, tenantBToken);
    const bColor = await request(base, "POST", "/api/colors", { name: "Cor B", hex: "#010203" }, tenantBToken);
    const bSize = await request(base, "POST", "/api/sizes", { name: "Tamanho B" }, tenantBToken);
    const bProduct = await request(base, "POST", "/api/products", {
      name: "Produto B",
      sku: "B-FOTO-001",
      description: "",
      category_id: bCategory.data.id,
      cost_price_cents: 1000,
      sale_price_cents: 1200,
      variations: [{ color_id: bColor.data.id, size_id: bSize.data.id, stock: 3, min_stock: 0 }],
    }, tenantBToken);
    const bUp = await requestRaw(base, `/api/products/${bProduct.data.id}/image`, webpBytes(), "image/webp", tenantBToken);
    equal(bUp.status, 200, "21. tenant B envia foto no próprio produto");
    pass(!(await gone(fileFor(bUp.data.image_url))), "21b. arquivo do tenant B gravado em diretório separado");
    equal((await fetchBytes(base, bUp.data.image_url)).status, 200, "21c. foto do tenant B servida");

    // 22. Produto continua no tenant correto e nenhum documento fiscal
    {
      const dbv = openDb(dbPath, true);
      equal((dbv.prepare("SELECT company_id FROM products WHERE id = ?").get(productId) as { company_id: number }).company_id, 1, "22. produto permanece no tenant 1");
      equal((dbv.prepare("SELECT COUNT(*) AS c FROM fiscal_documents").get() as { c: number }).c, 0, "22b. nenhum documento fiscal gerado");
      dbv.close();
    }

    // 23-24. Integridade
    const integrity = (() => {
      const dbi = openDb(dbPath, true);
      const result = {
        integrity: dbi.pragma("integrity_check", { simple: true }),
        foreign_keys: dbi.pragma("foreign_key_check").length,
      };
      dbi.close();
      return result;
    })();
    equal(integrity.integrity, "ok", "23. integrity_check = ok");
    equal(integrity.foreign_keys, 0, "24. foreign_key_check = 0");

    console.log(JSON.stringify({ status: "PASS", checks, integrity: integrity.integrity, foreign_keys: integrity.foreign_keys }));
  } finally {
    await stopProcess(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});