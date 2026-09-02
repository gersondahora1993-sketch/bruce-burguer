import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

const DEFAULT_SETTINGS: Record<string, string> = {
  store_name: "Nyellen Fashion",
  store_logo_url: "/logo/nyellen-fashion.png",
  store_cnpj: "",
  store_phone: "",
  whatsapp_number: "",
  store_instagram: "",
  store_address: "",
  store_city: "",
  store_state: "",
  store_zip: "",
  opening_hours: "",
};

const MAX_LENGTH = 300;

router.get("/", requireAuth, (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const rows = db.prepare("SELECT key, value FROM settings WHERE company_id = ?").all(companyId) as { key: string; value: string }[];
  const settings: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) settings[r.key] = r.value;

  res.json({
    ...settings,
    whatsapp_digits_only: settings.whatsapp_number.replace(/\D/g, ""),
  });
});

router.put("/", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const companyId = (req.user as any).company_id;
  const body = req.body ?? {};
  const keys = Object.keys(DEFAULT_SETTINGS);
  const set = db.prepare("INSERT OR REPLACE INTO settings (company_id, key, value) VALUES (?, ?, ?)");
  const tx = db.transaction(() => {
    for (const k of keys) {
      const value = body[k];
      if (typeof value === "string" && value !== undefined) {
        const trimmed = value.trim();
        if (trimmed.length > MAX_LENGTH) {
          throw new Error(`O campo "${k}" excede ${MAX_LENGTH} caracteres.`);
        }
        set.run(companyId, k, trimmed);
      }
    }
  });
  try {
    tx();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Não foi possível salvar as configurações." });
  }
});

export default router;
