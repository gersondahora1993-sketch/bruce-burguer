import { code128ModuleCount } from "./barcode128";

export const LABEL_WIDTH_MM = 40;
export const LABEL_HEIGHT_MM = 40;
export const LABEL_PADDING_MM = 1.2;
export const LABEL_CONTENT_WIDTH_MM = LABEL_WIDTH_MM - LABEL_PADDING_MM * 2;
export const LABEL_CONTENT_HEIGHT_MM = LABEL_HEIGHT_MM - LABEL_PADDING_MM * 2;

export const BARCODE_WIDTH_MM = 36;
export const BARCODE_QUIET_MODULES = 12;
export const BARCODE_MODULE_WIDTH = 1.6;
export const BARCODE_HEIGHT_PX = 80;

export const MIN_BARCODE_MODULE_MM = 0.28;
export const GOOD_BARCODE_MODULE_MM = 0.375;

export const MAX_QUANTITY = 99;

export interface LabelEntry {
  productId: number;
  quantity: number;
}

export function parseLabelItems(raw: string | null): LabelEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [idStr, qtyStr] = part.split(":");
      const productId = Number(idStr);
      const quantity = Math.max(1, Math.min(MAX_QUANTITY, Number(qtyStr) || 1));
      return { productId: Number.isFinite(productId) ? productId : 0, quantity };
    })
    .filter((e) => e.productId > 0);
}

export function countLabelCopies(entries: LabelEntry[]): number {
  return entries.reduce((acc, e) => acc + e.quantity, 0);
}

export interface BarcodeLabelMetrics {
  code: string;
  totalModules: number;
  widthMm: number;
  activeWidthMm: number;
  quietMm: number;
  moduleWidthMm: number;
  heightMm: number;
}

export function barcodeLabelMetrics(code: string): BarcodeLabelMetrics {
  const totalModules = code128ModuleCount(code);
  const moduleWidthMm = BARCODE_WIDTH_MM / totalModules;
  const quietMm = BARCODE_QUIET_MODULES * moduleWidthMm;
  const heightMm = (BARCODE_WIDTH_MM * BARCODE_HEIGHT_PX) / (totalModules * BARCODE_MODULE_WIDTH);
  return {
    code,
    totalModules,
    widthMm: BARCODE_WIDTH_MM,
    activeWidthMm: BARCODE_WIDTH_MM - quietMm * 2,
    quietMm,
    moduleWidthMm,
    heightMm,
  };
}

export function labelFits40(code: string): boolean {
  const m = barcodeLabelMetrics(code);
  return (
    m.widthMm <= LABEL_CONTENT_WIDTH_MM &&
    m.heightMm <= LABEL_CONTENT_HEIGHT_MM &&
    m.moduleWidthMm >= MIN_BARCODE_MODULE_MM
  );
}