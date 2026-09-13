import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface StoreCartAddon {
  id: number;
  name: string;
  price_cents: number;
  quantity: number;
}

export interface StoreCartItem {
  key: string;
  productId: number | null;
  comboId: number | null;
  name: string;
  image?: string;
  unitCents: number;
  addons: StoreCartAddon[];
  quantity: number;
}

interface StoreNewItem {
  productId: number | null;
  comboId: number | null;
  name: string;
  image?: string;
  unitCents: number;
  addons: { id: number; name: string; price_cents: number }[];
}

interface StoreCartContextValue {
  items: StoreCartItem[];
  count: number;
  totalCents: number;
  add: (item: StoreNewItem) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const StoreCartContext = createContext<StoreCartContextValue | null>(null);

const KEY = "bruce_burger_cart";

function buildKey(item: StoreNewItem): string {
  const addonIds = item.addons.map((a) => a.id).sort((a, b) => a - b);
  if (item.comboId != null) return `combo:${item.comboId}`;
  return `product:${item.productId}:${addonIds.join("+")}`;
}

function itemSubtotal(item: StoreCartItem): number {
  const addonPerUnit = item.addons.reduce((sum, a) => sum + a.price_cents * a.quantity, 0);
  return (item.unitCents + addonPerUnit) * item.quantity;
}

function isValidStoredItem(value: unknown): value is StoreCartItem {
  if (!value || typeof value !== "object") return false;
  const it = value as Record<string, unknown>;
  if (typeof it.key !== "string" || !it.key) return false;
  if (it.productId != null && (typeof it.productId !== "number" || it.productId <= 0)) return false;
  if (it.comboId != null && (typeof it.comboId !== "number" || it.comboId <= 0)) return false;
  if (it.productId == null && it.comboId == null) return false;
  if (typeof it.name !== "string" || !it.name) return false;
  if (typeof it.unitCents !== "number" || it.unitCents < 0) return false;
  if (!Array.isArray(it.addons)) return false;
  for (const a of it.addons) {
    if (!a || typeof a !== "object") return false;
    const addon = a as Record<string, unknown>;
    if (typeof addon.id !== "number" || addon.id <= 0) return false;
    if (typeof addon.name !== "string") return false;
    if (typeof addon.price_cents !== "number" || addon.price_cents < 0) return false;
    if (typeof addon.quantity !== "number" || addon.quantity <= 0) return false;
  }
  if (typeof it.quantity !== "number" || it.quantity <= 0) return false;
  return true;
}

function loadCart(): StoreCartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const legacyRaw = localStorage.getItem("nyellen_cart");
      if (legacyRaw) localStorage.removeItem("nyellen_cart");
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidStoredItem);
  } catch {
    return [];
  }
}

export function StoreCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<StoreCartItem[]>(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* armazenamento indisponível */
    }
  }, [items]);

  const value = useMemo<StoreCartContextValue>(() => {
    return {
      items,
      count: items.reduce((sum, i) => sum + i.quantity, 0),
      totalCents: items.reduce((sum, i) => sum + itemSubtotal(i), 0),
      add: (newItem) =>
        setItems((prev) => {
          const key = buildKey(newItem);
          const addons: StoreCartAddon[] = newItem.addons
            .filter((a) => a.id > 0)
            .map((a) => ({ id: a.id, name: a.name, price_cents: a.price_cents, quantity: 1 }));
          const existing = prev.find((i) => i.key === key);
          if (existing) {
            return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
          }
          return [
            ...prev,
            {
              key,
              productId: newItem.productId,
              comboId: newItem.comboId,
              name: newItem.name,
              image: newItem.image,
              unitCents: newItem.unitCents,
              addons,
              quantity: 1,
            },
          ];
        }),
      setQuantity: (key, quantity) =>
        setItems((prev) =>
          prev.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, quantity) } : i))
        ),
      remove: (key) => setItems((prev) => prev.filter((i) => i.key !== key)),
      clear: () => setItems([]),
    };
  }, [items]);

  return <StoreCartContext.Provider value={value}>{children}</StoreCartContext.Provider>;
}

export function useStoreCart(): StoreCartContextValue {
  const ctx = useContext(StoreCartContext);
  if (!ctx) throw new Error("useStoreCart deve ser usado dentro de StoreCartProvider");
  return ctx;
}