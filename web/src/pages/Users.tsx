import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, UserPlus } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, PasswordInput, Select, Skeleton, Toggle } from "../components/ui";
import type { User } from "../types";

interface NewUser {
  name: string;
  email: string;
  role: "admin" | "vendedora" | "funcionaria";
  password: string;
}

const EMPTY_NEW: NewUser = { name: "", email: "", role: "vendedora", password: "" };

export default function Users() {
  const { success, error: toastError } = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewUser>(EMPTY_NEW);
  const [saving, setSaving] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<User[]>("/api/users"));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar os usuários.");
    }
  }, [toastError]);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser() {
    setSaving(true);
    try {
      await api.post("/api/users", form);
      success("Usuário criado com sucesso.");
      setCreating(false);
      setForm(EMPTY_NEW);
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível criar o usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: User) {
    try {
      await api.patch(`/api/users/${user.id}`, { active: !user.active });
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível atualizar o usuário.");
    }
  }

  async function changeRole(user: User, role: "admin" | "vendedora" | "funcionaria") {
    try {
      await api.patch(`/api/users/${user.id}`, { role });
      await load();
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível alterar o perfil.");
    }
  }

  async function resetPassword() {
    if (!passwordTarget) return;
    setSaving(true);
    try {
      await api.post(`/api/users/${passwordTarget.id}/password`, { password: newPassword });
      success(`Senha de ${passwordTarget.name} redefinida.`);
      setPasswordTarget(null);
      setNewPassword("");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível redefinir a senha.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Gerencie os perfis de acesso da loja"
        action={
          <Button onClick={() => setCreating(true)}>
            <UserPlus size={16} /> Novo usuário
          </Button>
        }
      />

      {!users ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </Card>
      ) : users.length === 0 ? (
        <EmptyState title="Nenhum usuário" description="Cadastre o primeiro usuário da loja." />
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <Card key={user.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-sm font-bold text-rose-700 uppercase">
                {user.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-zinc-900">{user.name}</p>
                <p className="truncate text-sm text-zinc-500">{user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <Select
                  value={user.role}
                  onChange={(e) => changeRole(user, e.target.value as "admin" | "vendedora" | "funcionaria")}
                  className="w-40"
                >
                  <option value="admin">Administradora</option>
                  <option value="vendedora">Vendedora</option>
                  <option value="funcionaria">Funcionária</option>
                </Select>
                <Toggle checked={!!user.active} onChange={() => toggleActive(user)} label={user.active ? "Ativo" : "Inativo"} />
                <Button size="sm" variant="secondary" onClick={() => setPasswordTarget(user)}>
                  <KeyRound size={14} /> Senha
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Novo usuário"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button onClick={createUser} loading={saving}>
              <Plus size={15} /> Criar usuário
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome completo" />
          </Field>
          <Field label="E-mail de login" required>
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ex.: funcionaria@nyellen.local" />
          </Field>
          <Field label="Perfil" required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "vendedora" | "funcionaria" })}>
              <option value="vendedora">Vendedora</option>
              <option value="admin">Administradora</option>
            </Select>
          </Field>
          <Field label="Senha inicial" required hint="Mínimo de 6 caracteres.">
            <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!passwordTarget}
        onClose={() => { setPasswordTarget(null); setNewPassword(""); }}
        title={`Redefinir senha — ${passwordTarget?.name ?? ""}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setPasswordTarget(null); setNewPassword(""); }}>Cancelar</Button>
            <Button onClick={resetPassword} loading={saving}>Salvar senha</Button>
          </>
        }
      >
        <Field label="Nova senha" required hint="Mínimo de 6 caracteres.">
          <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
        </Field>
      </Modal>
    </div>
  );
}