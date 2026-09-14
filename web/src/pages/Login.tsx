import { useState } from "react";
import { Link } from "react-router-dom";
import type { FormEvent } from "react";
import { Sparkles, LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button, Field, Input, PasswordInput } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const { error: toastError } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState<{ email?: boolean; password?: boolean }>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = { email: !email.trim(), password: !password };
    setInvalid(errs);
    if (errs.email || errs.password) {
      toastError("Preencha e-mail e senha para entrar.");
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível entrar.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-x-hidden bg-gradient-to-br from-rose-50 via-zinc-50 to-rose-100 p-4">
      <div className="min-w-0 max-w-full sm:max-w-md" style={{ width: "calc(100vw - 2rem)" }}>
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-xl shadow-rose-600/30">
            <Sparkles size={30} />
          </div>
          <h1 className="font-display text-3xl font-bold text-zinc-900">
            Bruce<span className="text-rose-600"> Burguer</span>
          </h1>
          <p className="text-sm text-zinc-500">Sistema de gestão da sua loja</p>
        </div>

        <form onSubmit={handleSubmit} className="w-full min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-900/5 sm:p-8">
          <Field label="E-mail" required>
            <Input
              type="email"
              autoComplete="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={invalid.email}
            />
          </Field>
          <Field label="Senha" required>
            <PasswordInput
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={invalid.password}
            />
          </Field>
          <Button type="submit" size="lg" loading={loading} className="w-full">
            {!loading && <LogIn size={18} />}
            Entrar
          </Button>
          <p className="break-words rounded-lg bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-500">
            Acesso de demonstração: <span className="font-medium text-zinc-700">admin@bruceburguer.com</span> · senha{" "}
            <span className="font-medium text-zinc-700">admin123</span>
          </p>
          <p className="text-center text-sm text-zinc-500">
            Nova empresa? <Link className="font-medium text-rose-600 hover:text-rose-700" to="/adesao">Começar trial</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
