import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Store, UserRound, MessageCircle, LogOut, KeyRound, Clock } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button, Card, Field, Input, PageHeader, PageLoader, PasswordInput } from "../components/ui";

interface BusinessSettingsForm {
  business_name: string;
  slogan: string;
  whatsapp: string;
  address: string;
  city: string;
  uf: string;
  cep: string;
  hours: string;
  logo_url: string;
}

interface BusinessSettingsResponse {
  business_name: string;
  slogan: string;
  whatsapp: string;
  address: string;
  city: string;
  uf: string;
  cep: string;
  hours: string;
  logo_url: string;
  whatsapp_digits_only: string;
  updated_at: string;
}

const EMPTY_FORM: BusinessSettingsForm = {
  business_name: "",
  slogan: "",
  whatsapp: "",
  address: "",
  city: "",
  uf: "",
  cep: "",
  hours: "",
  logo_url: "",
};

function formatWhatsAppForDisplay(whatsapp: string): string {
  const digits = whatsapp.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 13 && digits.startsWith("55")) {
    const rest = digits.slice(2);
    return `+55 (${rest.slice(0, 2)}) ${rest.slice(2, 7)}-${rest.slice(7)}`;
  }
  return whatsapp;
}

export default function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const { success, error: toastError } = useToast();

  const [settings, setSettings] = useState<BusinessSettingsResponse | null>(null);
  const [form, setForm] = useState<BusinessSettingsForm>(EMPTY_FORM);
  const [savingStore, setSavingStore] = useState(false);

  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    api
      .get<BusinessSettingsResponse>("/api/business-settings")
      .then((s) => {
        setSettings(s);
        setForm({
          business_name: s.business_name,
          slogan: s.slogan,
          whatsapp: s.whatsapp,
          address: s.address,
          city: s.city,
          uf: s.uf,
          cep: s.cep,
          hours: s.hours,
          logo_url: s.logo_url,
        });
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setProfileEmail(user.email);
    }
  }, [user]);

  const setField = useCallback((key: keyof BusinessSettingsForm) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
  }, []);

  async function saveStore(e: FormEvent) {
    e.preventDefault();
    if (!form.business_name.trim()) {
      toastError("Informe o nome da empresa.");
      return;
    }
    if (!form.whatsapp.trim()) {
      toastError("Informe o WhatsApp.");
      return;
    }
    if (!form.address.trim()) {
      toastError("Informe o endereço.");
      return;
    }
    if (!form.city.trim()) {
      toastError("Informe a cidade.");
      return;
    }
    if (!form.uf.trim() || form.uf.trim().length !== 2) {
      toastError("Informe a UF (ex: RJ).");
      return;
    }
    if (!form.hours.trim()) {
      toastError("Informe o horário de funcionamento.");
      return;
    }
    setSavingStore(true);
    try {
      await api.put("/api/business-settings", form);
      success("Configurações salvas!");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível salvar.");
    } finally {
      setSavingStore(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!profileName.trim() || !profileEmail.trim()) {
      toastError("Preencha nome e e-mail.");
      return;
    }
    setSavingProfile(true);
    try {
      await api.put("/api/auth/profile", { name: profileName.trim(), email: profileEmail.trim() });
      await refreshUser();
      success("Perfil atualizado!");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível atualizar o perfil.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!currentPwd || !newPwd) {
      toastError("Preencha a senha atual e a nova senha.");
      return;
    }
    if (newPwd.length < 6) {
      toastError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPwd !== confirmPwd) {
      toastError("A confirmação não confere com a nova senha.");
      return;
    }
    setSavingPwd(true);
    try {
      await api.put("/api/auth/password", { current: currentPwd, next: newPwd });
      success("Senha alterada com sucesso!");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível alterar a senha.");
    } finally {
      setSavingPwd(false);
    }
  }

  if (!settings || !user) return <PageLoader />;

  return (
    <div>
      <PageHeader title="Configurações da Empresa" subtitle="Dados da Bruce Burguer, perfil e integrações" />

      <Card className="p-4 mb-5 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🕐</span>
            <div>
              <p className="text-sm font-medium text-zinc-300">Horário de Funcionamento</p>
              <p className="text-lg font-bold text-amber-300">
                {settings.hours || "Não configurado"}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
            <span className="text-rose-600">🏪</span> Dados da Empresa
          </h2>
          <form onSubmit={saveStore} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da Empresa" required>
                <Input value={form.business_name} onChange={setField("business_name")} placeholder="Bruce Burguer" />
              </Field>

              <Field label="Slogan" hint="Frase de destaque exibida no cardápio e site.">
                <Input value={form.slogan} onChange={setField("slogan")} placeholder="Seu hambúrguer artesanal, do nosso jeito para você." />
              </Field>

              <Field label="Logo (URL da imagem)" hint="URL pública da imagem da logo oficial. Deixe vazio se ainda não houver arquivo.">
                <Input value={form.logo_url} onChange={setField("logo_url")} placeholder="https://..." />
              </Field>
              <div className="flex items-end pb-1 sm:col-span-2">
                {form.logo_url ? (
                  <img
                    src={form.logo_url}
                    alt="Logo da Bruce Burguer"
                    className="h-16 w-16 rounded-xl border border-zinc-200 bg-white object-contain p-1 shadow-sm"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 flex items-center justify-center">
                    <span className="text-xs text-zinc-400">Sem logo definida</span>
                  </div>
                )}
              </div>

              <Field label="WhatsApp (para pedidos)" required hint="Apenas números, com DDI. Ex: 5522981667509">
                <Input
                  value={form.whatsapp}
                  onChange={setField("whatsapp")}
                  placeholder="5522981667509"
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-zinc-500">Exibição: {(form.whatsapp.replace(/\D/g, '').length === 11 ? `(${form.whatsapp.replace(/\D/g, '').slice(0,2)}) ${form.whatsapp.replace(/\D/g, '').slice(2,7)}-${form.whatsapp.replace(/\D/g, '').slice(7)}` : form.whatsapp) || "Não informado"}</p>
              </Field>

              <Field label="Endereço" required>
                <Input value={form.address} onChange={setField("address")} placeholder="Loteamento Nova Macuco, em frente à Mercearia do Davi" />
              </Field>
              <Field label="Cidade" required>
                <Input value={form.city} onChange={setField("city")} placeholder="São Francisco de Itabapoana" />
              </Field>
              <Field label="Estado (UF)" required hint="Ex: RJ, SP, MG">
                <Input value={form.uf} onChange={setField("uf")} placeholder="RJ" maxLength={2} inputMode="text" />
              </Field>
              <Field label="CEP" hint="Opcional">
                <Input value={form.cep} onChange={setField("cep")} placeholder="00000-000" inputMode="numeric" maxLength={9} />
              </Field>
              <Field label="Horário de Funcionamento" required hint="Ex: Terça a sábado, das 18:30 às 23:00">
                <Input value={form.hours} onChange={setField("hours")} placeholder="Terça a sábado, das 18:30 às 23:00" />
              </Field>
            </div>
            <Button type="submit" loading={savingStore} className="w-full sm:w-auto">Salvar Configurações</Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
            <span className="text-rose-600">👤</span> Meu Perfil
          </h2>
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Nome">
              <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
            </Field>
            <Button type="submit" loading={savingProfile}>Salvar Perfil</Button>
          </form>

          <form onSubmit={savePassword} className="mt-6 space-y-4 border-t border-zinc-100 pt-5">
            <h3 className="flex items-center gap-2 font-medium text-zinc-800">
              <span className="text-rose-600">🔑</span> Alterar Senha
            </h3>
            <Field label="Senha Atual">
              <PasswordInput value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="Nova Senha">
              <PasswordInput value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirmar Nova Senha">
              <PasswordInput value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button type="submit" variant="secondary" loading={savingPwd}>Alterar Senha</Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
            <span className="text-emerald-600">💬</span> Integração WhatsApp
          </h2>
          <div className="space-y-2 text-sm text-zinc-600">
            <p>
              O botão <strong>"Enviar Pedido pelo WhatsApp"</strong> abre o WhatsApp com a mensagem do pedido montada
              automaticamente (cliente, produtos, adicionais, quantidades, valores e total), usando o número cadastrado
              no campo <strong>WhatsApp</strong> acima.
            </p>
<p>
              Número atual:{' '}
              <strong>
                {(settings.whatsapp && settings.whatsapp.replace(/\D/g, '').length === 11
                  ? `(${settings.whatsapp.replace(/\D/g, '').slice(0, 2)}) ${settings.whatsapp.replace(/\D/g, '').slice(2, 7)}-${settings.whatsapp.replace(/\D/g, '').slice(7)}`
                  : settings.whatsapp) || "Não configurado"}
              </strong>
            </p>
            <p className="mt-2">
              A arquitetura já está preparada para a integração oficial (API do WhatsApp Business ou provedores terceirizados).
              O ponto de integração está em{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-rose-700">web/src/lib/whatsapp.ts</code> —
              basta substituir a função <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-rose-700">sendOrderWhatsApp</code>{" "}
              pela chamada da API escolhida. As credenciais da API nunca devem ficar no frontend; guarde-as em variáveis de
              ambiente no servidor (<code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-rose-700">server/.env</code>).
            </p>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-zinc-900">
            <span className="text-rose-600">🚪</span> Sessão
          </h2>
          <p className="mb-4 text-sm text-zinc-600">Você está conectado como <strong>{user.name}</strong> ({user.role}).</p>
          <Button variant="danger" onClick={logout}>Sair do Sistema</Button>
        </Card>
      </div>
    </div>
  );
}