import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Receipt,
  Search,
  Eye,
  Printer,
  DollarSign,
  TrendingUp,
  RotateCcw,
  Ban,
  ScanLine,
  Trash2,
  ArchiveRestore,
  Archive,
  CreditCard,
  HandCoins,
  ArrowLeftRight,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import BarcodeScanner from '@/components/BarcodeScanner';
import { formatUgandaDateTime, formatUgandaDate } from '@/lib/utils';

interface Sale {
  id: string;
  receipt_number: string;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string;
  amount_paid: number;
  change_given: number;
  created_at: string;
  deleted_at: string | null;
  credit_balance?: number;
  credit_status?: string;
}

interface SaleItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface RefundItem {
  product_id: string;
  product_name: string;
  quantity: number;
  refund_qty: number;
  unit_price: number;
}

interface Refund {
  id: string;
  receipt_number: string;
  reason: string;
  amount: number;
  items_returned: any;
  created_at: string;
  deleted_at: string | null;
  sales: { customer_name: string | null } | null;
}

const Sales = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [deletedSales, setDeletedSales] = useState<Sale[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Day's net cash (simple: cash in minus cash out for the day)
  const [dayNetCash, setDayNetCash] = useState(0);

  const [creditPaymentsTotal, setCreditPaymentsTotal] = useState(0);
  const [creditPaymentsCount, setCreditPaymentsCount] = useState(0);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [exchangeTopUps, setExchangeTopUps] = useState(0);
  const [exchangeRefunds, setExchangeRefunds] = useState(0);
  const [exchangeCount, setExchangeCount] = useState(0);

  // Use local browser timezone for consistency with Dashboard
  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getLocalDayRangeIso = (dateStr: string) => {
    // dateStr format: YYYY-MM-DD - parse as local date
    const [y, m, d] = dateStr.split('-').map(Number);
    const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
    const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
    return { 
      startIso: startOfDay.toISOString(), 
      endIso: endOfDay.toISOString() 
    };
  };

  // Scanner state
  const [scannerOpen, setScannerOpen] = useState(false);

  // Refund state
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundSale, setRefundSale] = useState<Sale | null>(null);
  const [refundItems, setRefundItems] = useState<RefundItem[]>([]);
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [customAmount, setCustomAmount] = useState('');
  const [reason, setReason] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);

  useEffect(() => {
    fetchSales();
    fetchDeletedSales();
    fetchRefunds();
    fetchExpensesTotal();
    checkAdminStatus();
    fetchCreditPayments();
    fetchExchanges();
    fetchDayNetCash();
  }, [dateFilter]);

  // Real-time subscriptions for live updates
  useEffect(() => {
    const channel = supabase
      .channel('sales-page-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales' },
        () => {
          fetchSales();
          fetchDeletedSales();
          fetchDayNetCash();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'refunds' },
        () => {
          fetchRefunds();
          fetchDayNetCash();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          fetchExpensesTotal();
          fetchDayNetCash();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'credit_payments' },
        () => {
          fetchCreditPayments();
          fetchDayNetCash();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'credit_sales' },
        () => {
          fetchSales();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exchanges' },
        () => {
          fetchExchanges();
          fetchDayNetCash();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dateFilter]);

  const checkAdminStatus = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    setIsAdmin(!!data);
  };

  const fetchSales = async () => {
    setLoading(true);
    let query = supabase
      .from('sales')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (dateFilter) {
      const { startIso, endIso } = getLocalDayRangeIso(dateFilter);
      query = query.gte('created_at', startIso).lte('created_at', endIso);
    }

    const { data, error } = await query.limit(500);

    if (error) {
      toast({ title: 'Error', description: 'Failed to fetch sales', variant: 'destructive' });
    } else {
      // Fetch credit sale info for credit sales
      const salesData = data || [];
      const creditSaleIds = salesData.filter(s => s.payment_method === 'credit').map(s => s.id);
      
      if (creditSaleIds.length > 0) {
        const { data: creditData } = await supabase
          .from('credit_sales')
          .select('sale_id, balance, status')
          .in('sale_id', creditSaleIds);
        
        const creditMap = new Map(creditData?.map(c => [c.sale_id, { balance: c.balance, status: c.status }]) || []);
        
        const enrichedSales = salesData.map(sale => ({
          ...sale,
          credit_balance: creditMap.get(sale.id)?.balance,
          credit_status: creditMap.get(sale.id)?.status
        }));
        
        setSales(enrichedSales);
      } else {
        setSales(salesData);
      }
    }
    setLoading(false);
  };

  const fetchDeletedSales = async () => {
    const { data } = await supabase
      .from('sales')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(50);
    
    setDeletedSales(data || []);
  };

  const fetchRefunds = async () => {
    let query = supabase
      .from('refunds')
      .select('*, sales(customer_name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (dateFilter) {
      const { startIso, endIso } = getLocalDayRangeIso(dateFilter);
      query = query.gte('created_at', startIso).lte('created_at', endIso);
    }

    const { data, error } = await query;
    if (!error) setRefunds(data || []);
  };

  const fetchExpensesTotal = async () => {
    const day = dateFilter || getLocalDateString(new Date());
    const { data } = await supabase.from('expenses').select('amount').eq('expense_date', day);
    const total = data?.reduce((sum, e) => sum + e.amount, 0) || 0;
    setExpensesTotal(total);
  };

  const fetchCreditPayments = async () => {
    const day = dateFilter || getLocalDateString(new Date());
    const { startIso, endIso } = getLocalDayRangeIso(day);

    const { data } = await supabase
      .from('credit_payments')
      .select('amount')
      .gte('payment_date', startIso)
      .lte('payment_date', endIso);

    const total = data?.reduce((sum, p) => sum + p.amount, 0) || 0;
    setCreditPaymentsTotal(total);
    setCreditPaymentsCount(data?.length || 0);
  };

  const fetchExchanges = async () => {
    const day = dateFilter || getLocalDateString(new Date());
    const { data } = await supabase
      .from('exchanges')
      .select('id, amount_paid, refund_given')
      .eq('cash_date', day);

    const topUps = data?.reduce((sum, e) => sum + (e.amount_paid || 0), 0) || 0;
    const refunds = data?.reduce((sum, e) => sum + (e.refund_given || 0), 0) || 0;
    setExchangeTopUps(topUps);
    setExchangeRefunds(refunds);
    setExchangeCount(data?.length || 0);
  };

  // Simple day's net cash calculation
  const fetchDayNetCash = async () => {
    const day = dateFilter || getLocalDateString(new Date());
    const { startIso, endIso } = getLocalDayRangeIso(day);

    const [{ data: cashSalesData }, { data: refundsData }, { data: cashExpensesData }, { data: exchangesData }, { data: cashCreditPaymentsData }] =
      await Promise.all([
        supabase
          .from('sales')
          .select('total')
          .is('deleted_at', null)
          .eq('payment_method', 'cash')
          .gte('created_at', startIso)
          .lte('created_at', endIso),
        supabase
          .from('refunds')
          .select('amount')
          .is('deleted_at', null)
          .gte('created_at', startIso)
          .lte('created_at', endIso),
        supabase.from('expenses').select('amount').eq('expense_date', day).eq('payment_source', 'cash_register'),
        supabase.from('exchanges').select('amount_paid, refund_given').eq('cash_date', day),
        supabase
          .from('credit_payments')
          .select('amount')
          .eq('payment_method', 'cash')
          .gte('payment_date', startIso)
          .lte('payment_date', endIso),
      ]);

    const totalCashSales = cashSalesData?.reduce((sum, s) => sum + s.total, 0) || 0;
    const totalRefunds = refundsData?.reduce((sum, r) => sum + r.amount, 0) || 0;
    const totalCashExpenses = cashExpensesData?.reduce((sum, e) => sum + e.amount, 0) || 0;
    const totalExchangeTopUps = exchangesData?.reduce((sum, e) => sum + (e.amount_paid || 0), 0) || 0;
    const totalExchangeRefunds = exchangesData?.reduce((sum, e) => sum + (e.refund_given || 0), 0) || 0;
    const totalCashCreditPayments = cashCreditPaymentsData?.reduce((sum, p) => sum + p.amount, 0) || 0;

    // Simple: cash in minus cash out for the day
    const netCash =
      totalCashSales +
      totalCashCreditPayments +
      totalExchangeTopUps -
      totalRefunds -
      totalExchangeRefunds -
      totalCashExpenses;

    setDayNetCash(netCash);
  };

  const viewSaleDetails = async (sale: Sale) => {
    setSelectedSale(sale);
    
    const { data } = await supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', sale.id);

    setSaleItems(data || []);
  };

  const openRefundDialog = async (sale: Sale) => {
    setRefundSale(sale);
    
    const { data } = await supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', sale.id);

    const items = data || [];
    setRefundItems(items.map((item: SaleItem) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      refund_qty: item.quantity,
      unit_price: item.unit_price
    })));
    setRefundType('full');
    setCustomAmount('');
    setReason('');
    setRefundDialogOpen(true);
  };

  const calculateRefundAmount = (): number => {
    if (refundType === 'full' && refundSale) {
      return refundSale.total;
    }
    
    if (customAmount) {
      return parseFloat(customAmount);
    }
    
    return refundItems.reduce((sum, item) => sum + (item.refund_qty * item.unit_price), 0);
  };

  const updateItemRefundQty = (index: number, qty: number) => {
    const newItems = [...refundItems];
    newItems[index].refund_qty = Math.min(Math.max(0, qty), newItems[index].quantity);
    setRefundItems(newItems);
  };

  const processRefund = async () => {
    if (!refundSale || !reason) {
      toast({ title: 'Error', description: 'Please provide a reason', variant: 'destructive' });
      return;
    }

    const amount = calculateRefundAmount();
    if (amount <= 0 || amount > refundSale.total) {
      toast({ title: 'Error', description: 'Invalid refund amount', variant: 'destructive' });
      return;
    }

    setProcessingRefund(true);

    try {
      const itemsReturned = refundType === 'full' 
        ? refundItems.map(i => ({ product_id: i.product_id, product_name: i.product_name, quantity: i.quantity }))
        : refundItems.filter(i => i.refund_qty > 0).map(i => ({ 
            product_id: i.product_id, 
            product_name: i.product_name, 
            quantity: i.refund_qty 
          }));

      const { error } = await supabase
        .from('refunds')
        .insert({
          sale_id: refundSale.id,
          receipt_number: refundSale.receipt_number,
          reason,
          amount,
          items_returned: itemsReturned,
          refunded_by: user?.id
        });

      if (error) throw error;

      // Update inventory - add back refunded items
      for (const item of itemsReturned) {
        const { data: product } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .single();

        if (product) {
          const newStock = product.stock_quantity + item.quantity;
          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', item.product_id);

          await supabase.from('inventory_transactions').insert({
            product_id: item.product_id,
            transaction_type: 'return',
            quantity: item.quantity,
            previous_stock: product.stock_quantity,
            new_stock: newStock,
            notes: `Refund from ${refundSale.receipt_number}`,
            created_by: user?.id
          });
        }
      }

      toast({ title: 'Success', description: 'Refund processed successfully' });
      setRefundDialogOpen(false);
      setRefundSale(null);
      setReason('');
      setRefundItems([]);
      setCustomAmount('');
      fetchRefunds();

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingRefund(false);
    }
  };

  const voidReceipt = async (sale: Sale) => {
    if (!confirm(`Are you sure you want to void receipt ${sale.receipt_number}? This will process a full refund.`)) {
      return;
    }

    setProcessingRefund(true);

    try {
      const { data: items } = await supabase
        .from('sale_items')
        .select('*')
        .eq('sale_id', sale.id);

      const saleItemsList = items || [];
      const itemsReturned = saleItemsList.map((item: SaleItem) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity
      }));

      const { error } = await supabase
        .from('refunds')
        .insert({
          sale_id: sale.id,
          receipt_number: sale.receipt_number,
          reason: 'Receipt voided',
          amount: sale.total,
          items_returned: itemsReturned,
          refunded_by: user?.id
        });

      if (error) throw error;

      // Update inventory - add back all items
      for (const item of saleItemsList) {
        const { data: product } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .single();

        if (product) {
          const newStock = product.stock_quantity + item.quantity;
          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', item.product_id);

          await supabase.from('inventory_transactions').insert({
            product_id: item.product_id,
            transaction_type: 'return',
            quantity: item.quantity,
            previous_stock: product.stock_quantity,
            new_stock: newStock,
            notes: `Voided receipt ${sale.receipt_number}`,
            created_by: user?.id
          });
        }
      }

      toast({ title: 'Success', description: 'Receipt voided successfully' });
      fetchRefunds();

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingRefund(false);
    }
  };

  const deleteSale = async (sale: Sale) => {
    if (!confirm(`Are you sure you want to delete sale ${sale.receipt_number}? It can be recovered later.`)) {
      return;
    }

    try {
      // Soft delete the sale
      const { error } = await supabase
        .from('sales')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', sale.id);

      if (error) throw error;

      toast({ title: 'Success', description: `Sale ${sale.receipt_number} moved to trash` });
      fetchSales();
      fetchDeletedSales();
      setSelectedSale(null);

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const recoverSale = async (sale: Sale) => {
    try {
      const { error } = await supabase
        .from('sales')
        .update({ deleted_at: null })
        .eq('id', sale.id);

      if (error) throw error;

      toast({ title: 'Success', description: `Sale ${sale.receipt_number} recovered` });
      fetchSales();
      fetchDeletedSales();

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const permanentlyDeleteSale = async (sale: Sale) => {
    if (!confirm(`Are you sure you want to PERMANENTLY delete sale ${sale.receipt_number}? This cannot be undone.`)) {
      return;
    }

    try {
      // Delete associated refunds first
      await supabase
        .from('refunds')
        .delete()
        .eq('sale_id', sale.id);

      // Delete sale items
      await supabase
        .from('sale_items')
        .delete()
        .eq('sale_id', sale.id);

      // Delete the sale permanently
      const { error } = await supabase
        .from('sales')
        .delete()
        .eq('id', sale.id);

      if (error) throw error;

      toast({ title: 'Success', description: `Sale ${sale.receipt_number} permanently deleted` });
      fetchDeletedSales();

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const deleteRefund = async (refund: Refund) => {
    if (!confirm(`Are you sure you want to delete this refund record for ${refund.receipt_number}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('refunds')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', refund.id);

      if (error) throw error;

      toast({ title: 'Success', description: 'Refund record deleted' });
      fetchRefunds();

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleBarcodeScan = async (code: string) => {
    // Search for receipt by scanned code
    setSearchTerm(code);
    
    // Try to find exact match and open details
    const { data, error } = await supabase
      .from('sales')
      .select('*')
      .eq('receipt_number', code)
      .maybeSingle();
    
    if (data) {
      viewSaleDetails(data);
      toast({ title: 'Receipt Found', description: `Found receipt ${code}` });
    } else {
      toast({ 
        title: 'Not Found', 
        description: `No receipt found with number: ${code}`, 
        variant: 'destructive' 
      });
    }
  };

  const filteredSales = sales.filter(s => 
    s.receipt_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.customer_name?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const filteredRefunds = refunds.filter(r =>
    r.receipt_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statsDay = dateFilter || getLocalDateString(new Date());
  const { startIso: statsStartIso, endIso: statsEndIso } = getLocalDayRangeIso(statsDay);
  const statsStartMs = new Date(statsStartIso).getTime();
  const statsEndMs = new Date(statsEndIso).getTime();

  const daySales = sales.filter((s) => {
    const t = new Date(s.created_at).getTime();
    return t >= statsStartMs && t <= statsEndMs;
  });

  // Cash received for the day:
  // - all non-credit sales
  // - PLUS credit sales that are already fully paid (balance = 0)
  const dayPaidCreditSales = daySales.filter(
    (s) => s.payment_method === 'credit' && s.credit_balance !== undefined && s.credit_balance === 0,
  );
  const dayCashReceivedSales = daySales.filter((s) => s.payment_method !== 'credit').concat(dayPaidCreditSales);

  const dayCashReceivedTotal = dayCashReceivedSales.reduce((sum, s) => sum + s.total, 0);

  // Outstanding credit for sales on the selected day (sum of current balances)
  const dayCreditOutstandingTotal = daySales
    .filter((s) => s.payment_method === 'credit' && (s.credit_balance ?? 0) > 0)
    .reduce((sum, s) => sum + (s.credit_balance ?? 0), 0);

  const statsRefunds = refunds.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= statsStartMs && t <= statsEndMs;
  });
  const dayRefundsTotal = statsRefunds.reduce((sum, r) => sum + r.amount, 0);

  // Simple net cash for the day
  const dayNetCashTotal = dayNetCash;

  // For filtered view (table showing)
  const cashSales = sales.filter((s) => s.payment_method !== 'credit' || s.credit_balance === 0);
  const creditSales = sales.filter((s) => s.payment_method === 'credit' && (s.credit_balance ?? 0) > 0);
  const totalCashSales = cashSales.reduce((sum, s) => sum + s.total, 0);
  const totalCreditSales = creditSales.reduce((sum, s) => sum + s.total, 0);

  const totalRefunds = dateFilter ? dayRefundsTotal : refunds.reduce((sum, r) => sum + r.amount, 0);
  const refundAmount = calculateRefundAmount();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Sales & Refunds</h1>
        <p className="text-muted-foreground">View sales records, process refunds and void receipts</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-green-500/30 bg-green-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Cash Sales' : "Today's Cash Sales"}
            </CardTitle>
            <DollarSign className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(dayCashReceivedTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Sales paid by cash, card, mobile money</p>
          </CardContent>
        </Card>

        <Card className="border-yellow-500/30 bg-yellow-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Credit Outstanding' : "Today's Credit Outstanding"}
            </CardTitle>
            <CreditCard className="h-5 w-5 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{formatCurrency(dayCreditOutstandingTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Credit sales awaiting payment</p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/30 bg-blue-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Transactions' : "Today's Transactions"}
            </CardTitle>
            <Receipt className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{daySales.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Total transactions processed</p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/30 bg-purple-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? "Selected Day's Net Cash" : "Today's Net Cash"}
            </CardTitle>
            <TrendingUp className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${dayNetCashTotal >= 0 ? 'text-purple-600' : 'text-red-600'}`}>
              {formatCurrency(dayNetCashTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Cash sales + credit payments + top-ups − refunds − expenses
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500/30 bg-red-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Refunds</CardTitle>
            <RotateCcw className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totalRefunds)}</div>
            <p className="text-xs text-muted-foreground mt-1">Refunds processed</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Credit Payments' : "Today's Credit Payments"}
            </CardTitle>
            <HandCoins className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{formatCurrency(creditPaymentsTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">{creditPaymentsCount} payments collected</p>
          </CardContent>
        </Card>

        <Card className="border-orange-500/30 bg-orange-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Expenses' : "Today's Expenses"}
            </CardTitle>
            <Wallet className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(expensesTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Deducted from operations</p>
          </CardContent>
        </Card>

        <Card className="border-cyan-500/30 bg-cyan-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Exchange Top-ups' : "Today's Exchange Top-ups"}
            </CardTitle>
            <ArrowLeftRight className="h-5 w-5 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-600">{formatCurrency(exchangeTopUps)}</div>
            <p className="text-xs text-muted-foreground mt-1">{exchangeCount} exchanges processed</p>
          </CardContent>
        </Card>

        <Card className="border-pink-500/30 bg-pink-500/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dateFilter ? 'Selected Day Exchange Refunds' : "Today's Exchange Refunds"}
            </CardTitle>
            <RefreshCw className="h-5 w-5 text-pink-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-pink-600">{formatCurrency(exchangeRefunds)}</div>
            <p className="text-xs text-muted-foreground mt-1">Given back to customers</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by receipt number or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={() => setScannerOpen(true)} className="gap-2">
          <ScanLine className="h-4 w-4" />
          Scan Receipt
        </Button>
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="w-auto"
        />
        {dateFilter && (
          <Button variant="outline" onClick={() => setDateFilter('')}>
            Clear Date
          </Button>
        )}
      </div>

      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales" className="gap-2">
            <Receipt className="h-4 w-4" />
            Sales Records
          </TabsTrigger>
          <TabsTrigger value="refunds" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Refund History
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="deleted" className="gap-2">
              <Archive className="h-4 w-4" />
              Deleted ({deletedSales.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Sales Records
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSales.map(sale => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono">{sale.receipt_number}</TableCell>
                      <TableCell>{formatUgandaDateTime(sale.created_at)}</TableCell>
                      <TableCell>{sale.customer_name || 'Walk-in'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={sale.payment_method === 'credit' ? 'secondary' : 'outline'}>
                            {sale.payment_method.replace('_', ' ')}
                          </Badge>
                          {sale.payment_method === 'credit' && sale.credit_balance !== undefined && (
                            <Badge variant={sale.credit_balance > 0 ? 'destructive' : 'default'} className="text-xs">
                              {sale.credit_balance > 0 ? `Bal: ${formatCurrency(sale.credit_balance)}` : 'Paid'}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(sale.total)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => viewSaleDetails(sale)} title="View Details">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openRefundDialog(sale)} title="Process Refund">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => voidReceipt(sale)} title="Void Receipt" className="text-destructive hover:text-destructive">
                            <Ban className="h-4 w-4" />
                          </Button>
                          {isAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => deleteSale(sale)} title="Delete Sale (Admin)" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredSales.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No sales found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="refunds">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Refund History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRefunds.map(refund => (
                    <TableRow key={refund.id}>
                      <TableCell>{formatUgandaDate(refund.created_at)}</TableCell>
                      <TableCell className="font-mono">{refund.receipt_number}</TableCell>
                      <TableCell>{refund.sales?.customer_name || 'Walk-in'}</TableCell>
                      <TableCell>
                        <Badge variant={refund.items_returned?.length > 0 ? 'secondary' : 'outline'}>
                          {refund.items_returned?.length > 0 ? 'Items' : 'Amount'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{refund.reason}</TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        -{formatCurrency(refund.amount)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => deleteRefund(refund)} title="Delete Refund" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {filteredRefunds.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">
                        No refunds found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deleted Sales Tab - Admin Only */}
        {isAdmin && (
          <TabsContent value="deleted">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Archive className="h-5 w-5" />
                  Deleted Sales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Deleted At</TableHead>
                      <TableHead>Original Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deletedSales.map(sale => (
                      <TableRow key={sale.id}>
                        <TableCell className="font-mono">{sale.receipt_number}</TableCell>
                        <TableCell>{sale.deleted_at ? formatUgandaDateTime(sale.deleted_at) : '-'}</TableCell>
                        <TableCell>{formatUgandaDateTime(sale.created_at)}</TableCell>
                        <TableCell>{sale.customer_name || 'Walk-in'}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(sale.total)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => recoverSale(sale)} title="Recover Sale" className="text-green-600 hover:text-green-700">
                              <ArchiveRestore className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => permanentlyDeleteSale(sale)} title="Delete Permanently" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {deletedSales.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No deleted sales
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Sale Details Dialog */}
      <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              Sale Details
              <Button size="icon" variant="ghost" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4 text-sm">
              <div className="text-center border-b pb-4">
                <h2 className="font-bold text-lg">FADY TECHNOLOGIES</h2>
                <p className="text-muted-foreground">Receipt #{selectedSale.receipt_number}</p>
                <p className="text-xs text-muted-foreground">{formatUgandaDateTime(selectedSale.created_at)}</p>
              </div>

              <div className="space-y-2">
                <p><strong>Customer:</strong> {selectedSale.customer_name || 'Walk-in'}</p>
                
                <div className="border-t border-b py-2 space-y-1">
                  {saleItems.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.quantity}x {item.product_name}</span>
                      <span>{formatCurrency(item.total_price)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(selectedSale.subtotal)}</span>
                </div>
                {selectedSale.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(selectedSale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{formatCurrency(selectedSale.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payment Method</span>
                  <span className="capitalize">{selectedSale.payment_method.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Amount Paid</span>
                  <span>{formatCurrency(selectedSale.amount_paid)}</span>
                </div>
                {selectedSale.change_given > 0 && (
                  <div className="flex justify-between">
                    <span>Change</span>
                    <span>{formatCurrency(selectedSale.change_given)}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t">
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => { setSelectedSale(null); openRefundDialog(selectedSale); }}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Process Refund
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => { setSelectedSale(null); voidReceipt(selectedSale); }}>
                    <Ban className="h-4 w-4 mr-2" />
                    Void Receipt
                  </Button>
                </div>
                {isAdmin && (
                  <Button variant="destructive" className="w-full" onClick={() => deleteSale(selectedSale)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Sale Permanently
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog open={refundDialogOpen} onOpenChange={(open) => { 
        setRefundDialogOpen(open); 
        if (!open) {
          setRefundSale(null);
          setReason('');
          setRefundItems([]);
          setCustomAmount('');
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Process Refund</DialogTitle>
          </DialogHeader>
          {refundSale && (
            <div className="space-y-4">
              <Card className="bg-secondary/50">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Receipt:</span>
                    <span className="font-mono">{refundSale.receipt_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer:</span>
                    <span>{refundSale.customer_name || 'Walk-in'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date:</span>
                    <span>{formatUgandaDate(refundSale.created_at)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Sale Total:</span>
                    <span>{formatCurrency(refundSale.total)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Refund Type Selection */}
              <div>
                <Label>Refund Type</Label>
                <RadioGroup value={refundType} onValueChange={(v) => setRefundType(v as 'full' | 'partial')} className="mt-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="full" id="full" />
                    <Label htmlFor="full" className="cursor-pointer">Full Refund ({formatCurrency(refundSale.total)})</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="partial" id="partial" />
                    <Label htmlFor="partial" className="cursor-pointer">Partial Refund (Select items or enter amount)</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Partial Refund Options */}
              {refundType === 'partial' && (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Select Items to Refund</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Purchased</TableHead>
                            <TableHead className="text-right">Refund Qty</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {refundItems.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{item.product_name}</TableCell>
                              <TableCell className="text-right">{item.quantity}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  className="w-20 text-right"
                                  min={0}
                                  max={item.quantity}
                                  value={item.refund_qty}
                                  onChange={(e) => updateItemRefundQty(idx, parseInt(e.target.value) || 0)}
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(item.refund_qty * item.unit_price)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <div>
                    <Label>Or Enter Custom Amount (UGX)</Label>
                    <Input
                      type="number"
                      placeholder="Custom refund amount"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      max={refundSale.total}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Leave empty to use item-based calculation</p>
                  </div>
                </>
              )}

              <div className="p-4 bg-primary/10 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Refund Amount:</span>
                  <span className="text-2xl font-bold text-primary">{formatCurrency(refundAmount)}</span>
                </div>
                {refundType === 'partial' && (
                  <Badge variant="secondary" className="mt-2">Partial Refund</Badge>
                )}
              </div>

              <div>
                <Label>Reason for Refund *</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the reason for this refund"
                />
              </div>

              <Button onClick={processRefund} disabled={processingRefund || !reason} className="w-full">
                {processingRefund ? 'Processing...' : `Confirm Refund - ${formatCurrency(refundAmount)}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Barcode Scanner */}
      <BarcodeScanner 
        open={scannerOpen} 
        onClose={() => setScannerOpen(false)} 
        onScan={handleBarcodeScan}
      />
    </div>
  );
};

export default Sales;
