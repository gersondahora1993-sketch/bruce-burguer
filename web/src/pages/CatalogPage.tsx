import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Plus, Pencil, Trash2, Check } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Skeleton, Toggle } from "../components/ui";

interface CatalogRow {
  id: number;
  name: string;
  active: number;
  hex?: string;
  sort_order?: number;
}

export default function CatalogPage({
  title,
  subtitle,
  endpoint,
  placeholder,
  colorPicker,
  hint,
}: {
  title: string;
  subtitle: string;
  endpoint: string;
  placeholder: string;
  colorPicker?: boolean;
  hint?: ReactNode;
}) {
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newHex, setNewHex] = useState("#e11d48");
  const [editing, setEditing] = useState<{ id: number; name: string; hex: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<CatalogRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<CatalogRow[]>(`${endpoint}?includeInactive=1`);
      setRows(data);
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar os registros.");
    }
  }, [endpoint, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!newName.trim()) {
      toastError("Informe um nome.");
      return;
    }
    setSaving(true);
    try {
      await api.post(endpoint, colorPicker ? { name: newName.trim(), hex: newHex } : { name: newName.trim() });
      success("Registro criado com sucesso!");
      setNewName("");
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível criar o registro.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing || !editing.name.trim()) {
      toastError("O nome não pode ficar vazio.");
      return;
    }
    setSaving(true);
    try {
      await api.put(`${endpoint}/${editing.id}`, colorPicker ? { name: editing.name.trim(), hex: editing.hex } : { name: editing.name.trim() });
      success("Registro atualizado!");
      setEditing(null);
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível atualizar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: CatalogRow) {
    try {
      await api.patch(`${endpoint}/${row.id}/status`, { active: !row.active });
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, active: row.active ? 0 : 1 } : r)) ?? null);
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível alterar o status.");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.del(`${endpoint}/${deleting.id}`);
      success("Registro excluído.");
      setDeleting(null);
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível excluir.");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />

      {hint && <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{hint}</div>}

      <Card className="mb-5 p-4">
        <p className="mb-2 text-sm font-medium text-zinc-700">Adicionar nova</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {colorPicker && (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border border-zinc-300 bg-white p-1"
                title="Selecionar cor"
              />
              <span className="hidden w-6 text-xs text-zinc-400 sm:block">{newHex}</span>
            </div>
          )}
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={placeholder}
            className="flex-1"
          />
          <Button onClick={add} loading={saving}>
            <Plus size={16} /> Adicionar
          </Button>
        </div>
      </Card>

      {!rows ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum registro cadastrado" description={`Crie o primeiro acima.`} />
      ) : (
        <Card className="divide-y divide-zinc-100 overflow-hidden">
          {rows.map((row) => {
            const isEditing = editing?.id === row.id;
            return (
              <div key={row.id} className={`flex items-center gap-3 px-4 py-3 ${!row.active ? "opacity-60" : ""}`}>
                {colorPicker ? (
                  <span className="h-9 w-9 shrink-0 rounded-lg border border-black/10" style={{ backgroundColor: row.hex }} title={row.hex} />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs font-bold text-zinc-500 uppercase">
                    {row.name.slice(0, 2)}
                  </span>
                )}

                {isEditing ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    {colorPicker && (
                      <input
                        type="color"
                        value={editing.hex}
                        onChange={(e) => setEditing({ ...editing, hex: e.target.value })}
                        className="h-10 w-14 cursor-pointer rounded-lg border border-zinc-300 bg-white p-1"
                      />
                    )}
                    <Input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                      className="flex-1"
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-900">
                      {row.name} {!row.active && <Badge tone="zinc">inativo</Badge>}
                    </p>
                    {colorPicker && <p className="text-xs text-zinc-400">{row.hex}</p>}
                  </div>
                )}

                <div className="flex shrink-0 items-center gap-1.5">
                  <Toggle checked={!!row.active} onChange={() => toggleActive(row)} />
                  {isEditing ? (
                    <Button size="sm" onClick={saveEdit} loading={saving} aria-label="Salvar">
                      <Check size={15} />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ id: row.id, name: row.name, hex: row.hex ?? "#e11d48" })} aria-label="Editar">
                      <Pencil size={15} />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(row)} aria-label="Excluir" className="hover:text-rose-600">
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Excluir registro"
        message={`Tem certeza que deseja excluir "${deleting?.name}"? Registros em uso não podem ser excluídos.`}
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}