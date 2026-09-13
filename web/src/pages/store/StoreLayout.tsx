import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { ShoppingBag, Sparkles, ArrowLeft, MessageCircle, Clock, CheckCircle, XCircle } from "lucide-react";
import { api } from "../../api/client";
import type { StoreInfo } from "../../types";
import { useStoreCart } from "./StoreCartContext";
import { isBusinessOpen } from "../../lib/businessHours";

function StoreHeader() {
  const { count } = useStoreCart();
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [status, setStatus] = useState<"ABERTO" | "FECHADO" | "ERRO_CONFIGURACAO" | "CARREGANDO">("CARREGANDO");

  useEffect(() => {
    api.get<StoreInfo>("/api/catalog/store").then(setStore).catch(() => null);
  }, []);

  // Verificar status a cada minuto
  useEffect(() => {
    const checkStatus = () => {
      if (store?.opening_hours) {
        setStatus(isBusinessOpen(store.opening_hours));
      } else {
        setStatus("ERRO_CONFIGURACAO");
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 60000);
    return () => clearInterval(interval);
  }, [store?.opening_hours]);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/loja" className="flex min-w-0 items-center gap-3">
          {store?.store_logo_url ? (
            <img src={store.store_logo_url} alt={store.store_name} className="h-12 w-12 rounded-xl object-cover shadow-sm" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 text-white shadow-md shadow-amber-600/30">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v12" />
              </svg>
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-lg font-bold text-zinc-900">{store?.store_name ?? "Bruce Burguer"}</p>
            <p className="truncate text-[11px] text-zinc-500">Hamburgueria Artesanal</p>
          </div>
        </Link>

        {/* Status ABERTO/FECHADO */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100">
          {status === "CARREGANDO" && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Verificando...
            </span>
          )}
          {status === "ABERTO" && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="bg-emerald-100 px-2 py-0.5 rounded-full">ABERTO</span>
            </span>
          )}
          {status === "FECHADO" && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
              <svg className="w-3 h-3 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              <span className="bg-rose-100 px-2 py-0.5 rounded-full">FECHADO</span>
            </span>
          )}
          {status === "ERRO_CONFIGURACAO" && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <svg className="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span className="bg-amber-100 px-2 py-0.5 rounded-full">Horário não configurado</span>
            </span>
          )}
        </div>

        {/* Carrinho */}
        <button
          onClick={() => navigate("/loja/carrinho")}
          className="relative rounded-xl border border-zinc-200 bg-white p-2.5 text-zinc-600 active:scale-95 transition-transform"
          aria-label="Ver carrinho"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a2 2 0 00-2-2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2v-5M5 7h14a1 1 0 010 2H5a1 1 0 010-2z" />
          </svg>
          {count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1 text-[11px] font-bold text-white">
              {count}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

export default function StoreLayout() {
  const [store, setStore] = useState<StoreInfo | null>(null);

  useEffect(() => {
    api.get<StoreInfo>("/api/catalog/store").then(setStore).catch(() => null);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 pb-16">
      <StoreHeader />
      <main className="mx-auto max-w-5xl px-4 pt-5">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-5xl px-4 pt-10 pb-6 text-center">
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
          {store?.store_address && <span>{[store.store_address, store.store_city, store.store_state].filter(Boolean).join(", ")}</span>}
          {store?.whatsapp_digits_only && (
            <a
              href={`https://wa.me/${store.whatsapp_digits_only.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Vim pelo cardápio da Bruce Burguer.")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-emerald-600 hover:underline"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67-.149-.198 0-.713.096-.94.444-.228.349-.56.948-.826 1.527-.314.679-.047 1.48.37 1.752.32.213 1.018.82 1.47.96.35.112.546.15.55.15.272 0 .88-.502 1.348-1.282.396-.66 1.405-1.608 1.683-1.95.277-.34.02-1.255-.377-1.581-.025-.025-.049-.05-.08-.08-.264-.232-.616-.558-.94-.894-.31-.31-.682-.665-.843-.742a3.53 3.53 0 0 0-.427-.132c-.17 0-.346-.01-.52-.04-.365-.06-1.258-.515-1.305-.52-.047-.006-.532-.022-1.15-.085-.457-.046-.985-.15-1.34-.302-.358-.151-.748-.36-.96-.447-.215-.087-.57-.218-.776-.3-.197-.085-.4-.193-.608-.277-.145-.052-.41-.134-.59-.184-.182-.05-.474-.182-.48-.186-.009 0-.23.04-.384.14-.167.1-.32.273-.467.398-.148.12-.383.358-.39.373-.012.013 1.563 1.873 3.492 4.233 1.028 1.31 1.772 2.5 2.085 3.047.286.49.366.68.354.785-.01.1-.05.19-.099.27-.045.082-.108.19-.196.29-.045.082-.108.19-.196.29-.088.1-.19.22-.295.322-.105.1-.23.233-.34.36-.11.13-.24.274-.35.42-.11.15-.23.3-.345.435-.113.137-.23.282-.33.418-.1.14-.2.286-.295.42-.107.14-.2.286-.31.416-.13.145-.25.29-.34.425-.096.128-.18.26-.26.384-.078.11-.15.226-.22.33-.07.1-.13.2-.18.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29" /></svg>
              <span>WhatsApp</span>
            </a>
          )}
        </div>
        <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-zinc-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          área administrativa
        </Link>
      </footer>
    </div>
  );
}