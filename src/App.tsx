import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { usePWA } from "@/hooks/usePWA";
import PWASplashScreen from "@/components/PWASplashScreen";
import Maintenance from "./pages/Maintenance";
import Index from "./pages/Index";
import ProductDetail from "./pages/ProductDetail";
import Install from "./pages/Install";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Products from "./pages/admin/Products";
import Inquiries from "./pages/admin/Inquiries";
import Customers from "./pages/admin/Customers";
import Settings from "./pages/admin/Settings";
import PointOfSale from "./pages/admin/PointOfSale";
import Inventory from "./pages/admin/Inventory";
import Sales from "./pages/admin/Sales";
import Expenses from "./pages/admin/Expenses";
import Suppliers from "./pages/admin/Suppliers";
import Exchanges from "./pages/admin/Exchanges";
import Banking from "./pages/admin/Banking";
import PurchaseOrders from "./pages/admin/PurchaseOrders";
import Reports from "./pages/admin/Reports";
import Barcodes from "./pages/admin/Barcodes";
import StockReceiving from "./pages/admin/StockReceiving";
import DataBackup from "./pages/admin/DataBackup";
import StaffManagement from "./pages/admin/StaffManagement";
import SiteAppearance from "./pages/admin/SiteAppearance";
import CustomerWallets from "./pages/admin/CustomerWallets";
import PrintableGuide from "./pages/PrintableGuide";

const queryClient = new QueryClient();

function AppContent() {
  const { isLoading, isStandalone } = usePWA();

  if (isLoading && isStandalone) {
    return <PWASplashScreen />;
  }

  return (
    <>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/install" element={<Install />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/guide" element={<PrintableGuide />} />
          
          {/* Admin Routes */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="pos" element={<PointOfSale />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="sales" element={<Sales />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="exchanges" element={<Exchanges />} />
            <Route path="banking" element={<Banking />} />
            <Route path="reports" element={<Reports />} />
            <Route path="barcodes" element={<Barcodes />} />
            <Route path="stock-receiving" element={<StockReceiving />} />
            <Route path="backup" element={<DataBackup />} />
            <Route path="customers" element={<Customers />} />
            <Route path="wallets" element={<CustomerWallets />} />
            <Route path="inquiries" element={<Inquiries />} />
            <Route path="settings" element={<Settings />} />
            <Route path="site-appearance" element={<SiteAppearance />} />
            <Route path="staff" element={<StaffManagement />} />
          </Route>
          
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <AppContent />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
