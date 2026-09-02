import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import { PageLoader } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import ProductForm from "./pages/ProductForm";
import LabelsPage from "./pages/LabelsPage";
import Categories from "./pages/Categories";
import Addons from "./pages/Addons";
import Combos from "./pages/Combos";
import Colors from "./pages/Colors";
import Sizes from "./pages/Sizes";
import Stock from "./pages/Stock";
import SalesNew from "./pages/SalesNew";
import SalesHistory from "./pages/SalesHistory";
import SaleReceiptPage from "./pages/SaleReceipt";
import Customers from "./pages/Customers";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Receivables from "./pages/Receivables";
import Cash from "./pages/Cash";
import Orders from "./pages/Orders";
import FiscalDocuments from "./pages/FiscalDocuments";
import Onboarding from "./pages/Onboarding";
import Billing from "./pages/Billing";
import Users from "./pages/Users";

import { ShieldAlert } from "lucide-react";

import StoreLayout from "./pages/store/StoreLayout";
import StoreHome from "./pages/store/StoreHome";
import StoreProduct from "./pages/store/StoreProduct";
import StoreCart from "./pages/store/StoreCart";
import StoreSuccess from "./pages/store/StoreSuccess";
import { StoreCartProvider } from "./pages/store/StoreCartContext";

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
        <ShieldAlert size={26} />
      </div>
      <p className="mt-4 text-lg font-semibold text-zinc-900">Acesso restrito</p>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        Você não tem permissão para acessar esta área. Fale com a administradora da loja se precisar deste recurso.
      </p>
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <PageLoader />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <AccessDenied />;
  return <>{children}</>;
}

function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <PageLoader />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/adesao" element={user ? <Navigate to="/" replace /> : <Onboarding />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/labels" element={<LabelsPage />} />
        <Route path="/products/new" element={<ProductForm />} />
        <Route path="/products/:id/edit" element={<ProductForm />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/addons" element={<Addons />} />
        <Route path="/combos" element={<Combos />} />
        <Route path="/colors" element={<Colors />} />
        <Route path="/sizes" element={<Sizes />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/stock/movements" element={<Stock tab="movements" />} />
        <Route path="/stock/low" element={<Stock tab="low" />} />
        <Route path="/sales/new" element={<SalesNew />} />
        <Route path="/sales" element={<SalesHistory />} />
        <Route path="/sales/:id/comprovante" element={<SaleReceiptPage />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/receivables" element={<RequireAdmin><Receivables /></RequireAdmin>} />
        <Route path="/fiscal" element={<RequireAdmin><FiscalDocuments /></RequireAdmin>} />
        <Route path="/cash" element={<Cash />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/reports" element={<RequireAdmin><Reports /></RequireAdmin>} />
        <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
        <Route path="/billing" element={<RequireAdmin><Billing /></RequireAdmin>} />
        <Route path="/users" element={<RequireAdmin><Users /></RequireAdmin>} />
      </Route>
      <Route
        path="/loja"
        element={
          <StoreCartProvider>
            <StoreLayout />
          </StoreCartProvider>
        }
      >
        <Route index element={<StoreHome />} />
        <Route path="produto/:id" element={<StoreProduct />} />
        <Route path="carrinho" element={<StoreCart />} />
        <Route path="sucesso" element={<StoreSuccess />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
