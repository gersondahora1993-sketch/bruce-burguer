import { useEffect, useMemo, useState } from "react";
import { Color, Size } from "../types";
import { Button } from "./ui";

export interface VariationRow {
  color_id: number;
  size_id: number;
  stock: number;
  min_stock: number;
}

interface EditingVariation extends VariationRow {
  editing: boolean;
}

export default function VariationsEditor({
  colors,
  sizes,
  variations,
  onChange,
  onlySizesWithStock,
}: {
  colors: Color[];
  sizes: Size[];
  variations: VariationRow[];
  onChange: (v: VariationRow[]) => void;
  onlySizesWithStock?: boolean;
}) {
  const [selectedColors, setSelectedColors] = useState<Set<number>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (variations.length === 0) return;
    setSelectedColors(new Set(variations.map((v) => v.color_id)));
    setSelectedSizes(new Set(variations.map((v) => v.size_id)));
  }, []);

  const rows: EditingVariation[] = useMemo(() => {
    const existing = new Set(variations.map((v) => `${v.color_id}-${v.size_id}`));
    const list: EditingVariation[] = [...variations].map((v) => ({ ...v, editing: false }));
    const colorOrder = new Map(colors.map((c, i) => [c.id, i]));
    const sizeOrder = new Map(sizes.map((s, i) => [s.id, i]));

    for (const colorId of selectedColors) {
      for (const sizeId of selectedSizes) {
        const key = `${colorId}-${sizeId}`;
        if (!existing.has(key)) {
          list.push({ color_id: colorId, size_id: sizeId, stock: 0, min_stock: 0, editing: true });
        }
      }
    }

    const withOrder = list.map((r) => ({
      r,
      key: `${r.color_id}-${r.size_id}`,
      colorPos: colorOrder.get(r.color_id) ?? 9999,
      sizePos: sizeOrder.get(r.size_id) ?? 9999,
    }));
    return withOrder
      .sort((a, b) => a.colorPos - b.colorPos || a.sizePos - b.sizePos)
      .map((x) => x.r);
  }, [variations, selectedColors, selectedSizes, colors, sizes]);

  function toggleColor(id: number) {
    setSelectedColors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(variations.filter((v) => next.has(v.color_id) && selectedSizes.has(v.size_id)));
      return next;
    });
  }

  function toggleSize(id: number) {
    setSelectedSizes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(variations.filter((v) => selectedColors.has(v.color_id) && next.has(v.size_id)));
      return next;
    });
  }

  function updateRow(i: number, patch: Partial<VariationRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    const cleaned = next.filter((r) => !r.editing || r.stock > 0 || r.min_stock > 0);
    if (cleaned.length !== next.length) {
      onChange(cleaned.map(({ editing: _e, ...rest }) => rest));
    } else {
      onChange(next.map(({ editing: _e, ...rest }) => rest));
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700">Cores disponíveis</p>
          <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            {colors.length === 0 && <p className="text-sm text-zinc-400">Nenhuma cor cadastrada.</p>}
            {colors.map((c) => {
              const active = selectedColors.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleColor(c.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    active ? "border-rose-600 bg-rose-600 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600 hover:border-rose-300"
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-black/10"
                    style={{ backgroundColor: c.hex }}
                  />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700">Tamanhos disponíveis</p>
          <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            {sizes.length === 0 && <p className="text-sm text-zinc-400">Nenhum tamanho cadastrado.</p>}
            {sizes.map((s) => {
              const active = selectedSizes.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSize(s.id)}
                  className={`min-w-10 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    active ? "border-rose-600 bg-rose-600 text-white shadow-sm" : "border-zinc-300 bg-white text-zinc-600 hover:border-rose-300"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-xs tracking-wide text-zinc-500 uppercase">
                <th className="px-3 py-2.5">Cor</th>
                <th className="px-3 py-2.5">Tamanho</th>
                <th className="px-3 py-2.5 w-28">Estoque</th>
                <th className="px-3 py-2.5 w-28">Estoque mín.</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row, i) => {
                const color = colors.find((c) => c.id === row.color_id);
                const size = sizes.find((s) => s.id === row.size_id);
                return (
                  <tr key={`${row.color_id}-${row.size_id}`} className={row.editing ? "bg-rose-50/50" : ""}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800">
                        <span className="h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: color?.hex }} />
                        {color?.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-zinc-800">{size?.name}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={row.stock}
                        onChange={(e) => updateRow(i, { stock: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={row.min_stock}
                        onChange={(e) => updateRow(i, { min_stock: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = rows.filter((_, idx) => idx !== i);
                          onChange(next.map(({ editing: _e, ...rest }) => rest));
                        }}
                      >
                        Remover
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {onlySizesWithStock && <p className="mt-2 text-xs text-zinc-400">As linhas marcadas com fundo rosa são novas combinações.</p>}
    </div>
  );
}