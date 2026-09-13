import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shirt, Search, Package, Coffee, UtensilsCrossed, Sparkles, Clock, CheckCircle, XCircle } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { Button, PageLoader, Skeleton } from "../../components/ui";
import { money } from "../../lib/format";
import { isBusinessOpen } from "../../lib/businessHours";
import type { StoreProduct, StoreInfo } from "../../types";

interface StoreCategory {
  id: number;
  name: string;
}

export default function StoreHome() {
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [cat, setCat] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ABERTO" | "FECHADO" | "ERRO_CONFIGURACAO" | "CARREGANDO">("CARREGANDO");
  const [store, setStore] = useState<StoreInfo | null>(null);

  useEffect(() => {
    api.get<StoreInfo>("/api/catalog/store")
      .then(setStore)
      .catch(() => null);
  }, []);

  // Status ABERTO/FECHADO
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

  useEffect(() => {
    api.get<StoreCategory[]>("/api/catalog/categories").then(setCategories).catch(() => null);
  }, []);

  // Mapear categoria para ícone
  const categoryIcons: Record<string, React.ReactNode> = {
    "Hambúrgueres": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.105 0 2-.895 2-2S13.532 8 12 8s-2 .895-2 2" /></svg>,
    "Combos": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v12" /></svg>,
    "Porções": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v12" /></svg>,
    "Bebidas": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6v12a2 2 0 002 2h8a2 2 0 002-2v-4M8 10h8M8 14h8M8 18h8M4 10v10a2 2 0 002 2h12a2 2 0 002-2V10M4 6h12v4" /></svg>,
    "Adicionais": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>,
    "Novidades": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
    "Mini Salgadinhos": <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>,
  };

  const categoryOrder = ["Hambúrgueres", "Combos", "Porções", "Bebidas", "Adicionais", "Novidades", "Mini Salgadinhos"];

  // Filtrar apenas categorias que existem no banco
  const availableCategories = categories.filter(c => categoryOrder.includes(c.name));
  const sortedCategories = availableCategories.sort((a, b) => categoryOrder.indexOf(a.name) - categoryOrder.indexOf(b.name));

  const loadProducts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (cat) params.set("category_id", String(cat));
      if (search.trim()) params.set("search", search.trim());
      setProducts(await api.get<StoreProduct[]>(`/api/catalog/products?${params.toString()}`));
    } catch (err: any) {
      toastError(err?.message ?? "Não foi possível carregar os produtos.");
    }
  }, [cat, search, toastError]);

  useEffect(() => {
    const t = window.setTimeout(loadProducts, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [loadProducts]);

  if (status === "CARREGANDO" && !products) return <PageLoader />;

  return (
    <div>
      {/* HERO SECTION */}
      <section className="mb-8 rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-orange-700 p-6 sm:p-8 text-white shadow-xl shadow-amber-600/30">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="text-center sm:text-left">
              <p className="font-display text-3xl sm:text-4xl font-bold mb-2">{store?.store_name ?? "Bruce Burguer"}</p>
              <p className="text-amber-100 text-lg sm:text-xl mb-4">Hamburgueria Artesanal</p>
              <p className="text-amber-200 text-base sm:text-lg mb-6 max-w-xl mx-auto sm:mx-0 italic">
                "{store?.slogan ?? "Seu hambúrguer artesanal, do nosso jeito para você."}"
              </p>
              
              {/* Status ABERTO/FECHADO */}
              <div className="inline-flex items-center gap-2">
                {status === "CARREGANDO" && (
                  <span className="flex items-center gap-1.5 text-amber-200 text-sm">
                    <span className="animate-pulse w-2 h-2 rounded-full bg-amber-400"></span>
                    Verificando status...
                  </span>
                )}
                {status === "ABERTO" && (
                  <span className="flex items-center gap-1.5 bg-emerald-600 px-3 py-1 rounded-full text-sm font-semibold">
                    🟢 ABERTO
                  </span>
                )}
                {status === "FECHADO" && (
                  <span className="flex items-center gap-1.5 bg-rose-600 px-3 py-1 rounded-full text-sm font-semibold">
                    🔴 FECHADO
                  </span>
                )}
                {status === "ERRO_CONFIGURACAO" && (
                  <span className="flex items-center gap-1.5 text-amber-200 text-sm">
                    Horário não configurado
                  </span>
                )}
              </div>
            </div>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center sm:justify-end gap-4">
              <div className="flex items-center gap-3 text-center sm:text-left">
                <svg className="w-6 h-6 text-amber-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <div>
                  <p className="text-amber-200 text-sm">Endereço</p>
                  <p className="font-medium">{store?.store_address ?? "Loteamento Nova Macuco, em frente à Mercearia do Davi"}</p>
                  <p className="text-amber-300 text-sm">{store?.store_city ?? "São Francisco de Itabapoana"} - {store?.store_state ?? "RJ"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-center sm:text-left">
                <svg className="w-6 h-6 text-amber-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <div>
                  <p className="text-amber-200 text-sm">Funcionamento</p>
                  <p className="font-medium">{store?.opening_hours ? store.opening_hours.split(",")[0] : "Terça a sábado"}</p>
                  <p className="text-amber-300 text-sm">{store?.opening_hours ? store.opening_hours.split("das ")[1]?.split(" às ")[0] ?? "18:30 às 23:00" : "18:30 às 23:00"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-center sm:text-left">
                <svg className="w-6 h-6 text-amber-200 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67-.149-.198 0-.713.096-.94.444-.228.349-.56.948-.826 1.527-.314.679-.047 1.48.37 1.752.32.213 1.018.82 1.47.96.35.112.546.15.55.15.272 0 .88-.502 1.348-1.282.396-.66 1.405-1.608 1.683-1.95.277-.34.02-1.255-.377-1.581-.025-.025-.049-.05-.08-.08-.264-.232-.616-.558-.94-.894-.31-.31-.682-.665-.843-.742a3.53 3.53 0 00-.427-.132c-.17 0-.346-.01-.52-.04-.365-.06-1.258-.515-1.305-.52-.047-.006-.532-.022-1.15-.085-.457-.046-.985-.15-1.34-.302-.358-.151-.748-.36-.96-.447-.215-.087-.57-.218-.776-.3-.197-.085-.4-.193-.608-.277-.145-.052-.41-.134-.59-.184-.182-.05-.474-.182-.48-.186-.009 0-.23.04-.384.14-.167.1-.32.273-.467.398-.148.12-.383.358-.39.373-.012.013 1.563 1.873 3.492 4.233 1.028 1.31 1.772 2.5 2.085 3.047.286.49.366.68.354.785-.01.1-.05.19-.099.27-.045.082-.108.19-.196.29-.045.082-.108.19-.196.29-.088.1-.19.22-.295.322-.105.1-.23.233-.34.36-.11.13-.24.274-.35.42-.11.15-.23.3-.345.435-.113.137-.23.282-.33.418-.1.14-.2.286-.295.42-.107.14-.2.286-.31.416-.13.145-.25.29-.34.425-.096.128-.18.26-.26.384-.078.11-.15.226-.22.33-.07.1-.13.2-.18.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29-.06.1-.11.18-.14.29" /></svg>
                <div>
                  <p className="text-amber-200 text-sm">WhatsApp</p>
                  <p className="font-medium">{store?.whatsapp_digits_only ? `(${store.whatsapp_digits_only.slice(0, 2)}) ${store.whatsapp_digits_only.slice(2, 6)}-${store.whatsapp_digits_only.slice(6)}` : "(22) 98166-7509"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIAS - NAVEGAÇÃO */}
      <nav className="mb-6" aria-label="Categorias do cardápio">
        <div className="flex gap-2 overflow-x-auto pb-2 pb-sm-0 scrollbar-hide">
          <button
            onClick={() => setCat(null)}
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-all ${
              cat === null
                ? "border-amber-600 bg-amber-600 text-white shadow-md shadow-amber-600/25"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-amber-400 hover:bg-amber-50"
            }`}
          >
            Todas
          </button>
          {sortedCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-all flex items-center gap-2 ${
                cat === c.id
                  ? "border-amber-600 bg-amber-600 text-white shadow-md shadow-amber-600/25"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-amber-400 hover:bg-amber-50"
              }`}
            >
              {categoryIcons[c.name]}
              {c.name}
            </button>
          ))}
        </div>
      </nav>

      {/* PRODUTOS POR CATEGORIA */}
      {!products ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16">
          <svg className="w-16 h-16 mx-auto text-zinc-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v12" />
          </svg>
          <p className="text-lg font-medium text-zinc-600 mb-2">Nenhum produto encontrado</p>
          <p className="text-zinc-400">Tente alterar os filtros ou busque por outro termo.</p>
        </div>
      ) : (
        <>
          {/* AGRUPAR PRODUTOS POR CATEGORIA */}
          {(() => {
            const productsByCategory = new Map<number, StoreProduct[]>();
            products.forEach(p => {
              const cid = p.category_id ?? 0;
              if (!productsByCategory.has(cid)) {
                productsByCategory.set(cid, []);
              }
              productsByCategory.get(cid)!.push(p);
            });

            return Array.from(productsByCategory.entries())
              .sort(([catA], [catB]) => {
                const nameA = categories.find(c => c.id === catA)?.name || "";
                const nameB = categories.find(c => c.id === catB)?.name || "";
                return categoryOrder.indexOf(nameA) - categoryOrder.indexOf(nameB);
              })
              .map(([catId, prods]) => {
                const catInfo = categories.find(c => c.id === catId);
                const catName = catInfo?.name || "Outros";
                const catIcon = categoryIcons[catName];

                return (
                  <section key={catId} className="mb-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        {catIcon}
                        <h2 className="font-display text-xl font-bold text-zinc-900">{catName}</h2>
                      </div>
                      <div className="flex-1 h-px bg-zinc-200"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                      {prods.map((p) => (
                        <Link
                          key={p.id}
                          to={`/loja/produto/${p.id}`}
                          className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
                        >
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name}
                              className="h-40 w-full object-cover sm:h-52 transition-transform group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className="flex h-40 w-full items-center justify-center bg-gradient-to-br from-amber-100 to-amber-200 text-amber-300 sm:h-52">
                              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.105 0 2-.895 2-2S13.532 8 12 8s-2 .895-2 2" />
                              </svg>
                            </div>
                          )}
                          <div className="p-4">
                            <p className="truncate text-sm font-semibold text-zinc-900 group-hover:text-amber-600 transition-colors">{p.name}</p>
                            <p className="mt-1 text-xs text-zinc-400 line-clamp-1">{p.description || "Sem descrição"}</p>
                            <div className="mt-3 flex items-center justify-between">
                              <span className="font-bold text-lg text-amber-600">
                                {p.sale_price_cents === 0 ? (
                                  <span className="text-amber-500">Consulte o preço</span>
                                ) : (
                                  money(p.sale_price_cents)
                                )}
                              </span>
                              {p.total_stock === 0 && (
                                <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-1 rounded-full">Esgotado</span>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                )
              });
            })()}
          </>
        )}
        <div className="mt-10 text-center">
        <Button variant="secondary" onClick={() => navigate("/loja/carrinho")}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a2 2 0 00-2-2H6a2 2 0 002 2v16a2 2 0 002 2h12a2 2 0 002-2v-5M5 7h14a1 1 0 010 2H5a1 1 0 010-2z" /></svg>
          Ver Carrinho
        </Button>
      </div>
    </div>
  );
}