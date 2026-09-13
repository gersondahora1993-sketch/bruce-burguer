import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { db, initSchema, migrateSchema, ensureDefaultPlans } from '../src/db.js';
import { app } from '../src/index.js';
import {
  createTestUser,
  generateToken,
  generateExpiredToken,
  generateTamperedToken,
  cleanupTestData,
  type TestUser,
} from './helpers.js';

let baseUrl: string;
let server: http.Server;

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
      path: url.pathname,
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

describe('Authentication Tests', () => {
  let adminUser: TestUser;
  let sellerUser: TestUser;
  let staffUser: TestUser;

  beforeAll(async () => {
    initSchema();
    migrateSchema();
    ensureDefaultPlans();
    baseUrl = await startServer();
  });

  afterAll(async () => {
    await stopServer();
    db.close();
  });

  beforeEach(() => {
    cleanupTestData();
    adminUser = createTestUser({
      name: 'Admin Test',
      email: 'test-admin@bruceburguer.com',
      password: 'Admin@123',
      role: 'admin',
      company_id: 1,
    });
    sellerUser = createTestUser({
      name: 'Seller Test',
      email: 'test-seller@bruceburguer.com',
      password: 'Seller@123',
      role: 'vendedora',
      company_id: 1,
    });
    staffUser = createTestUser({
      name: 'Staff Test',
      email: 'test-staff@bruceburguer.com',
      password: 'Staff@123',
      role: 'funcionaria',
      company_id: 1,
    });
  });

  describe('TEST 1 - Valid Login', () => {
    it('should authenticate with valid admin credentials', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: adminUser.email,
        password: adminUser.password,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('token');
      expect(response.data).toHaveProperty('user');
      expect(response.data.user.email).toBe(adminUser.email);
      expect(response.data.user.role).toBe('admin');
    });

    it('should authenticate with valid seller credentials', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: sellerUser.email,
        password: sellerUser.password,
      });

      expect(response.status).toBe(200);
      expect(response.data.user.role).toBe('vendedora');
    });

    it('should authenticate with valid staff credentials', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: staffUser.email,
        password: staffUser.password,
      });

      expect(response.status).toBe(200);
      expect(response.data.user.role).toBe('funcionaria');
    });

    it('should return a valid JWT token format', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: adminUser.email,
        password: adminUser.password,
      });

      const token = response.data.token;
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
    });
  });

  describe('TEST 2 - Invalid Password', () => {
    it('should reject login with incorrect password', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: adminUser.email,
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
      expect(response.data.error).toContain('incorretos');
    });

    it('should reject login with empty password', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: adminUser.email,
        password: '',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('TEST 3 - Non-existent User', () => {
    it('should reject login with non-existent email', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: 'nonexistent@bruceburguer.com',
        password: 'SomePassword123',
      });

      expect(response.status).toBe(401);
      expect(response.data.error).toContain('incorretos');
    });

    it('should not reveal whether email exists', async () => {
      const response = await apiRequest('POST', '/api/auth/login', {
        email: 'nonexistent@bruceburguer.com',
        password: 'SomePassword123',
      });

      expect(response.data.error).not.toContain('não encontrado');
    });
  });

  describe('TEST 4 - Invalid Token', () => {
    it('should reject access with malformed token', async () => {
      const response = await apiRequest('GET', '/api/auth/me', undefined, 'invalid.token.here');
      expect(response.status).toBe(401);
    });

    it('should reject access with tampered token', async () => {
      const tamperedToken = generateTamperedToken();
      const response = await apiRequest('GET', '/api/auth/me', undefined, tamperedToken);
      expect(response.status).toBe(401);
    });
  });

  describe('TEST 5 - Missing Token', () => {
    it('should reject access without Authorization header', async () => {
      const response = await apiRequest('GET', '/api/auth/me');
      expect(response.status).toBe(401);
      expect(response.data.error).toContain('Não autenticado');
    });
  });

  describe('TEST 6 - Expired Token', () => {
    it('should reject access with expired token', async () => {
      const expiredToken = generateExpiredToken(adminUser);
      const response = await apiRequest('GET', '/api/auth/me', undefined, expiredToken);
      expect(response.status).toBe(401);
      expect(response.data.error).toContain('expirada');
    });
  });

  describe('TEST 7 - Token Revalidation', () => {
    it('should allow access with valid token', async () => {
      const token = generateToken(adminUser);
      const response = await apiRequest('GET', '/api/auth/me', undefined, token);
      expect(response.status).toBe(200);
      expect(response.data.id).toBe(adminUser.id);
      expect(response.data.email).toBe(adminUser.email);
      expect(response.data.role).toBe(adminUser.role);
    });
  });

  describe('TEST 8 - Multi-tenant Context', () => {
    it('should preserve company_id in authenticated context', async () => {
      const token = generateToken(adminUser);
      const response = await apiRequest('GET', '/api/auth/me', undefined, token);
      expect(response.status).toBe(200);
    });

    it('should maintain tenant isolation in token', async () => {
      const token = generateToken(adminUser);
      const { decode } = await import('jsonwebtoken');
      const decoded = decode(token) as { company_id: number };
      expect(decoded.company_id).toBe(adminUser.company_id);
    });
  });

  describe('TEST 9 - Role Identification', () => {
    it('should correctly identify admin role', async () => {
      const token = generateToken(adminUser);
      const response = await apiRequest('GET', '/api/auth/me', undefined, token);
      expect(response.data.role).toBe('admin');
    });

    it('should correctly identify vendedora role', async () => {
      const token = generateToken(sellerUser);
      const response = await apiRequest('GET', '/api/auth/me', undefined, token);
      expect(response.data.role).toBe('vendedora');
    });

    it('should correctly identify funcionaria role', async () => {
      const token = generateToken(staffUser);
      const response = await apiRequest('GET', '/api/auth/me', undefined, token);
      expect(response.data.role).toBe('funcionaria');
    });
  });
});
