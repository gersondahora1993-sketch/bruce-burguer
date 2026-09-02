import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface StoreCartItem {
  variationId: number;
  productId: number;
  name: string;
  colorName: string;
  sizeName: string;
  unitCents: number;
  quantity: number;
  maxStock: number;
  image: string;
}

interface StoreCartContextValue {
  items: StoreCartItem[];
  count: number;
  totalCents: number;
  add: (item: Omit<StoreCartItem, "quantity">) => void;
  setQuantity: (variationId: number, quantity: number) => void;
  remove: (variationId: number) => void;
  clear: () => void;
}

const StoreCartContext = createContext<StoreCartContextValue | null>(null);

const KEY = "nyellen_cart";

function loadCart(): StoreCartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
      count: items.reduce((a, i) => a + i.quantity, 0),
      totalCents: items.reduce((a, i) => a + i.unitCents * i.quantity, 0),
      add: (item) =>
        setItems((prev) => {
          const existing = prev.find((i) => i.variationId === item.variationId);
          if (existing) {
            return prev.map((i) =>
              i.variationId === item.variationId
                ? { ...i, quantity: Math.min(i.maxStock, i.quantity + 1) }
                : i
            );
          }
          return [...prev, { ...item, quantity: 1 }];
        }),
      setQuantity: (variationId, quantity) =>
        setItems((prev) =>
          prev.map((i) =>
            i.variationId === variationId ? { ...i, quantity: Math.max(1, Math.min(i.maxStock, quantity)) } : i
          )
        ),
      remove: (variationId) => setItems((prev) => prev.filter((i) => i.variationId !== variationId)),
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