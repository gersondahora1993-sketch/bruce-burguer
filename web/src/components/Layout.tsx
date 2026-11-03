import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Shirt,
  Boxes,
  ShoppingCart,
  Users,
  ClipboardList,
  Settings,
  Menu,
  X,
  LogOut,
  Sparkles,
  Package,
  Store,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface MenuChild {
  label: string;
  to: string;
  adminOnly?: boolean;
}

interface MenuItem {
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  children: MenuChild[];
}

const MENU: MenuItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, children: [{ label: "Visão geral", to: "/" }] },
  {
    label: "Produtos",
    icon: Shirt,
    children: [
      { label: "Todos os produtos", to: "/products" },
      { label: "Cadastrar produto", to: "/products/new" },
      { label: "Categorias", to: "/categories" },
    ],
  },
  {
    label: "Estoque",
    icon: Boxes,
    children: [
      { label: "Estoque atual", to: "/stock" },
      { label: "Movimentações", to: "/stock/movements" },
      { label: "Estoque baixo", to: "/stock/low" },
    ],
  },
  {
    label: "Vendas",
    icon: ShoppingCart,
    children: [
      { label: "Nova venda", to: "/sales/new" },
      { label: "Histórico de vendas", to: "/sales" },
      { label: "Contas a receber", to: "/receivables", adminOnly: true },
      { label: "Documentos fiscais", to: "/fiscal", adminOnly: true },
      { label: "Caixa", to: "/cash" },
    ],
  },
  {
    label: "Pedidos online",
    icon: Package,
    children: [{ label: "Pedidos da loja", to: "/orders" }],
  },
  { label: "Clientes", icon: Users, children: [{ label: "Todos os clientes", to: "/customers" }] },
  { label: "Relatórios", icon: ClipboardList, adminOnly: true, children: [{ label: "Relatórios e análises", to: "/reports" }] },
  {
    label: "Configurações",
    icon: Settings,
    adminOnly: true,
    children: [
      { label: "Configurações do sistema", to: "/settings" },
      { label: "Usuários", to: "/users" },
      { label: "Assinatura", to: "/billing" },
    ],
  },
  { label: "Loja pública", icon: Store, children: [{ label: "Ver minha loja", to: "/loja" }] },
];

function visibleMenu(role?: string): MenuItem[] {
  const isAdmin = role === "admin";
  return MENU.map((item) => ({
    ...item,
    children: item.adminOnly
      ? isAdmin
        ? item.children
        : []
      : item.children.filter((child) => !child.adminOnly || isAdmin),
  })).filter((item) => item.children.length > 0);
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-md shadow-rose-600/30">
        <Sparkles size={20} />
      </div>
      <div className="leading-tight">
        <p className="font-display text-lg font-bold text-zinc-900">Bruce<span className="text-rose-600"> Burguer</span></p>
        <p className="text-[11px] tracking-wide text-zinc-400">Gestão da loja</p>
      </div>
    </div>
  );
}

function MenuTree({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const items = visibleMenu(user?.role);

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = item.children.some((c) => (c.to === "/" ? location.pathname === "/" : location.pathname.startsWith(c.to)));
        return (
          <div key={item.label}>
            <p className={`flex items-center gap-2.5 px-3 py-2 text-[11px] font-semibold tracking-widest uppercase ${active ? "text-rose-600" : "text-zinc-400"}`}>
              <item.icon size={16} />
              {item.label}
            </p>
            <div className="mb-1 space-y-0.5">
              {item.children.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  end={child.to === "/"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-rose-600 font-medium text-white shadow-sm shadow-rose-600/30"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                    }`
                  }
                >
                  {child.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

const BOTTOM_NAV = [
  { label: "Início", to: "/", icon: LayoutDashboard },
  { label: "Produtos", to: "/products", icon: Shirt },
  { label: "Vendas", to: "/sales/new", icon: ShoppingCart },
  { label: "Estoque", to: "/stock", icon: Boxes },
  { label: "Clientes", to: "/customers", icon: Users },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const currentTitle = visibleMenu(user?.role).flatMap((m) => m.children).find((c) => (c.to === "/" ? location.pathname === "/" : location.pathname.startsWith(c.to)))?.label ?? "";

  return (
    <div className="min-h-screen bg-zinc-100">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-zinc-200 bg-white lg:flex">
        <div className="border-b border-zinc-100 px-5 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <MenuTree />
        </div>
        <div className="border-t border-zinc-100 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-700 uppercase">
              {user?.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-zinc-800">{user?.name}</p>
              <p className="truncate text-xs capitalize text-zinc-400">{user?.role}</p>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-rose-600" title="Sair" aria-label="Sair">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      {/* Header mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-xl border border-zinc-200 p-2 text-zinc-600 active:scale-95"
          aria-label="Abrir menu"
        >
          <Menu size={21} />
        </button>
      </header>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[95] bg-zinc-950/50 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <Logo />
              <button onClick={() => setDrawerOpen(false)} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100" aria-label="Fechar menu">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <MenuTree onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="border-t border-zinc-100 p-4">
              <button
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 active:scale-[.98]"
              >
                <LogOut size={16} /> Sair ({user?.name.split(" ")[0] ?? ""})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo */}
      <div className="px-4 pt-4 pb-24 sm:px-6 md:px-8 lg:ml-64 lg:pb-8 lg:pt-8">
        <div className="main-content mx-auto max-w-6xl">
          {currentTitle && <p className="mb-4 text-xs font-medium tracking-wide text-zinc-400 uppercase lg:hidden">{currentTitle}</p>}
          <Outlet />
        </div>
      </div>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {BOTTOM_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                  isActive ? "text-rose-600" : "text-zinc-500"
                }`
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
