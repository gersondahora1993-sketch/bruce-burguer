const VARIATION_CODE_WIDTH = 4;

export function skuDigits(sku: string): string {
  return String(sku ?? "").replace(/\D/g, "") || "0";
}

export function sanitizeSkuForCode(sku: string): string {
  return String(sku ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Za-z-]/g, "")
    .slice(0, 20);
}

export function generateBarcode(sku: string, variationId: number): string {
  const base = sanitizeSkuForCode(sku) || skuDigits(sku) || "0";
  const varPart = String(variationId).padStart(VARIATION_CODE_WIDTH, "0").slice(-VARIATION_CODE_WIDTH);
  return `${base}${varPart}`;
}

export function normalizeBarcode(value: string): string {
  return String(value ?? "").trim().replace(/\D/g, "");
}

export function isValidBarcode(value: string): boolean {
  const v = String(value ?? "").trim();
  return /^[0-9A-Za-z-]{4,40}$/.test(v);
}