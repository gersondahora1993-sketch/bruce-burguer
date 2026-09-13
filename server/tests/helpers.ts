import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../src/db.js';
import { signToken } from '../src/auth.js';

export interface TestUser {
  id: number;
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'vendedora' | 'funcionaria';
  company_id: number;
}

export function createTestUser(params: {
  name?: string;
  email: string;
  password: string;
  role?: 'admin' | 'vendedora' | 'funcionaria';
  company_id?: number;
}): TestUser {
  const name = params.name ?? 'Test User';
  const role = params.role ?? 'admin';
  const company_id = params.company_id ?? 1;
  const password_hash = bcrypt.hashSync(params.password, 10);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, active, company_id, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).run(name, params.email.toLowerCase(), password_hash, role, company_id, now);

  return {
    id: Number(info.lastInsertRowid),
    name,
    email: params.email.toLowerCase(),
    password: params.password,
    role,
    company_id,
  };
}

export function generateToken(user: TestUser): string {
  return signToken({
    id: user.id,
    role: user.role,
    company_id: user.company_id,
  });
}

export function generateExpiredToken(user: TestUser): string {
  return jwt.sign(
    { id: user.id, role: user.role, company_id: user.company_id },
    process.env.JWT_SECRET!,
    { expiresIn: -1 }
  );
}

export function generateTamperedToken(): string {
  return jwt.sign(
    { id: 999999, role: 'admin', company_id: 1 },
    'wrong-secret-key-for-tampered-token-1234567890',
    { expiresIn: '1h' }
  );
}

export function cleanupTestData(): void {
  db.prepare('DELETE FROM users WHERE email LIKE ?').run('test-%@%');
}
