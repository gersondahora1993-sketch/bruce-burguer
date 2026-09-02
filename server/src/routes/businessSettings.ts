import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

// Validadores
function validateWhatsApp(value: string): string | null {
  if (!value || !value.trim()) return "WhatsApp é obrigatório";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return "WhatsApp inválido";
  return null;
}

function validateUF(value: string): string | null {
  if (!value || !value.trim()) return "UF é obrigatória";
  const uf = value.trim().toUpperCase();
  if (uf.length !== 2) return "UF deve ter 2 caracteres (ex: RJ)";
  return null;
}

function validateHours(value: string): string | null {
  if (!value || !value.trim()) return "Horário de funcionamento é obrigatório";
  // Validação básica: deve conter dias e horários
  if (value.trim().length < 5) return "Horário inválido";
  return null;
}

function validateRequired(value: string, fieldName: string): string | null {
  if (!value || !value.trim()) return `${fieldName} é obrigatório`;
  return null;
}

// GET - Obter configurações da empresa
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const row = db
      .prepare(
        `SELECT business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url, updated_at
         FROM business_settings WHERE company_id = ?`
      )
      .get(companyId) as {
        business_name: string;
        slogan: string;
        whatsapp: string;
        address: string;
        city: string;
        uf: string;
        cep: string;
        hours: string;
        logo_url: string;
        updated_at: string;
      } | undefined;

    if (!row) {
      // Retorna valores padrão se não existir
      res.json({
        business_name: "Bruce Burguer",
        slogan: "Seu hambúrguer artesanal, do nosso jeito para você.",
        whatsapp: "5522981667509",
        address: "Loteamento Nova Macuco, em frente à Mercearia do Davi",
        city: "São Francisco de Itabapoana",
        uf: "RJ",
        cep: "",
        hours: "Terça a sábado, das 18:30 às 23:00",
        logo_url: "",
        whatsapp_digits_only: "5522981667509",
        updated_at: new Date().toISOString(),
      });
      return;
    }

    res.json({
      ...row,
      whatsapp_digits_only: row.whatsapp.replace(/\D/g, ""),
    });
  } catch (err: any) {
    console.error("[businessSettings] GET error:", err);
    res.status(500).json({ error: "Erro ao buscar configurações." });
  }
});

// PUT - Atualizar configurações da empresa (somente admin)
router.put("/", requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  try {
    const companyId = (req.user as any).company_id ?? 1;
    const body = req.body ?? {};

    // Validações
    const errors: string[] = [];
    
    const nameErr = validateRequired(body.business_name, "Nome da empresa");
    if (nameErr) errors.push(nameErr);

    const whatsappErr = validateWhatsApp(body.whatsapp);
    if (whatsappErr) errors.push(whatsappErr);

    const addressErr = validateRequired(body.address, "Endereço");
    if (addressErr) errors.push(addressErr);

    const cityErr = validateRequired(body.city, "Cidade");
    if (cityErr) errors.push(cityErr);

    const ufErr = validateUF(body.uf);
    if (ufErr) errors.push(ufErr);

    const hoursErr = validateHours(body.hours);
    if (hoursErr) errors.push(hoursErr);

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join("; ") });
      return;
    }

    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");

    // Verificar se já existe registro
    const existing = db
      .prepare("SELECT id FROM business_settings WHERE company_id = ?")
      .get(companyId);

    const whatsapp = String(body.whatsapp || "").trim();
    const address = String(body.address || "").trim();
    const city = String(body.city || "").trim();
    const uf = String(body.uf || "").trim().toUpperCase();
    const cep = String(body.cep || "").trim();
    const hours = String(body.hours || "").trim();
    const business_name = String(body.business_name || "").trim();
    const slogan = String(body.slogan || "").trim();
    const logo_url = String(body.logo_url || "").trim();

    if (existing) {
      // Atualizar
      db.prepare(
        `UPDATE business_settings SET
           business_name = ?, slogan = ?, whatsapp = ?, address = ?, city = ?, uf = ?, cep = ?, hours = ?, logo_url = ?, updated_at = ?
         WHERE company_id = ?`
      ).run(
        business_name,
        slogan,
        whatsapp,
        address,
        city,
        uf,
        String(body.cep || "").trim(),
        hours,
        logo_url,
        ts,
        companyId
      );
    } else {
      // Inserir
      db.prepare(
        `INSERT INTO business_settings (
           company_id, business_name, slogan, whatsapp, address, city, uf, cep, hours, logo_url, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        companyId,
        business_name,
        slogan,
        whatsapp,
        address,
        city,
        uf,
        String(body.cep || "").trim(),
        hours,
        logo_url,
        ts,
        ts
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[businessSettings] PUT error:", err);
    res.status(500).json({ error: "Erro ao salvar configurações." });
  }
});

export default router;