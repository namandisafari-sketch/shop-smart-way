import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { FileText, TrendingUp, TrendingDown, DollarSign, Calendar as CalendarIcon, Download, Package } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { format, startOfMonth, endOfMonth, subMonths, addDays, subDays } from 'date-fns';
import { getUgandaDateString } from '@/lib/utils';

interface FinancialData {
  revenue: number;
  refunds: number;
  exchangeRefunds: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

interface MonthlyData {
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

const REPORT_QUERY_PAGE_SIZE = 1000;

const getTimestampFetchWindow = (startDate: Date, endDate: Date) => ({
  start: `${format(subDays(startDate, 1), 'yyyy-MM-dd')}T00:00:00Z`,
  end: `${format(addDays(endDate, 1), 'yyyy-MM-dd')}T23:59:59Z`,
});

const isWithinUgandaDateRange = (timestamp: string, startStr: string, endStr: string) => {
  const ugandaDate = getUgandaDateString(new Date(timestamp));
  return ugandaDate >= startStr && ugandaDate <= endStr;
};

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>,
) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + REPORT_QUERY_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);

    if (error) throw error;
    if (!data?.length) break;

    rows.push(...data);

    if (data.length < REPORT_QUERY_PAGE_SIZE) {
      break;
    }

    from += REPORT_QUERY_PAGE_SIZE;
  }

  return rows;
}

const Reports = () => {
  const [period, setPeriod] = useState('current');
  const [customStartDate, setCustomStartDate] = useState<Date>(startOfMonth(new Date()));
  const [customEndDate, setCustomEndDate] = useState<Date>(endOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [financialData, setFinancialData] = useState<FinancialData>({
    revenue: 0, refunds: 0, exchangeRefunds: 0, netRevenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0
  });
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [expensesByCategory, setExpensesByCategory] = useState<Record<string, number>>({});
  const [assets, setAssets] = useState({ cash: 0, inventory: 0, receivables: 0 });
  const [liabilities, setLiabilities] = useState({ payables: 0 });

  useEffect(() => {
    fetchReportData();
  }, [period, customStartDate, customEndDate]);

  const getDateRange = () => {
    const now = new Date();
    let startDate: Date, endDate: Date;

    switch (period) {
      case 'current':
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        break;
      case 'last':
        startDate = startOfMonth(subMonths(now, 1));
        endDate = endOfMonth(subMonths(now, 1));
        break;
      case 'quarter':
        startDate = startOfMonth(subMonths(now, 2));
        endDate = endOfMonth(now);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      case 'custom':
        startDate = customStartDate;
        endDate = customEndDate < customStartDate ? customStartDate : customEndDate;
        break;
      default:
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
    }

    return { startDate, endDate };
  };

  const fetchReportData = async () => {
    setLoading(true);
    const { startDate, endDate } = getDateRange();
    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');
    const { start: fetchStartUTC, end: fetchEndUTC } = getTimestampFetchWindow(startDate, endDate);

    try {
      // Fetch sales with sale_items for COGS calculation - exclude deleted and credit sales
      const salesData = (
        await fetchAllPages<any>((from, to) =>
          supabase
            .from('sales')
            .select('id, total, created_at, payment_method')
            .is('deleted_at', null)
            .neq('payment_method', 'credit')
            .gte('created_at', fetchStartUTC)
            .lte('created_at', fetchEndUTC)
            .order('created_at', { ascending: true })
            .range(from, to),
        )
      ).filter((sale) => isWithinUgandaDateRange(sale.created_at, startStr, endStr));

      const cashCardSales = salesData?.reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const saleIds = salesData?.map(s => s.id) || [];

      // Fetch sale items with product unit_cost for COGS
      // Use batched .in() queries with the already-fetched saleIds for reliability
      let cogs = 0;
      {
        let allSaleItems: any[] = [];
        const idBatchSize = 200; // batch sale IDs to avoid URL length limits
        for (let i = 0; i < saleIds.length; i += idBatchSize) {
          const idBatch = saleIds.slice(i, i + idBatchSize);
          let offset = 0;
          const rowBatchSize = 1000;
          while (true) {
            const { data: batch } = await supabase
              .from('sale_items')
              .select('quantity, products(unit_cost)')
              .in('sale_id', idBatch)
              .range(offset, offset + rowBatchSize - 1);
            if (!batch || batch.length === 0) break;
            allSaleItems = allSaleItems.concat(batch);
            if (batch.length < rowBatchSize) break;
            offset += rowBatchSize;
          }
        }

        cogs = allSaleItems.reduce((sum, item: any) => {
          const unitCost = Number(item.products?.unit_cost) || 0;
          return sum + (unitCost * item.quantity);
        }, 0);
      }

      // Fetch credit payments - these count as revenue when payment is made
      const creditPaymentsData = (
        await fetchAllPages<any>((from, to) =>
          supabase
            .from('credit_payments')
            .select('amount, payment_date, credit_sale_id')
            .gte('payment_date', fetchStartUTC)
            .lte('payment_date', fetchEndUTC)
            .order('payment_date', { ascending: true })
            .range(from, to),
        )
      ).filter((payment) => isWithinUgandaDateRange(payment.payment_date, startStr, endStr));

      const creditPaymentsRevenue = creditPaymentsData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      // For credit payments, also calculate COGS (proportional to payment amount)
      if (creditPaymentsData && creditPaymentsData.length > 0) {
        const creditSaleIds = [...new Set(creditPaymentsData.map(p => p.credit_sale_id))];
        const { data: creditSalesInfo } = await supabase
          .from('credit_sales')
          .select('id, sale_id, total_amount')
          .in('id', creditSaleIds);

        if (creditSalesInfo && creditSalesInfo.length > 0) {
          const creditSaleIdToSaleId = new Map(creditSalesInfo.map(cs => [cs.id, { saleId: cs.sale_id, total: cs.total_amount }]));
          const originalSaleIds = creditSalesInfo.map(cs => cs.sale_id);

          // Fetch ALL credit sale items with pagination
          let allCreditSaleItems: any[] = [];
          let creditOffset = 0;
          const creditBatchSize = 1000;
          
          while (true) {
            const { data: batch } = await supabase
              .from('sale_items')
              .select('sale_id, quantity, products(unit_cost)')
              .in('sale_id', originalSaleIds)
              .range(creditOffset, creditOffset + creditBatchSize - 1);
            
            if (!batch || batch.length === 0) break;
            allCreditSaleItems = allCreditSaleItems.concat(batch);
            if (batch.length < creditBatchSize) break;
            creditOffset += creditBatchSize;
          }

          // Calculate total COGS per original sale
          const saleCogs = new Map<string, number>();
          allCreditSaleItems.forEach((item: any) => {
            const unitCost = Number(item.products?.unit_cost) || 0;
            const itemCogs = unitCost * item.quantity;
            saleCogs.set(item.sale_id, (saleCogs.get(item.sale_id) || 0) + itemCogs);
          });

          // Allocate COGS proportionally based on payment amount / total sale amount
          creditPaymentsData.forEach(payment => {
            const creditSaleInfo = creditSaleIdToSaleId.get(payment.credit_sale_id);
            if (creditSaleInfo) {
              const totalSaleCogs = saleCogs.get(creditSaleInfo.saleId) || 0;
              const paymentRatio = creditSaleInfo.total > 0 ? Number(payment.amount) / creditSaleInfo.total : 0;
              cogs += totalSaleCogs * paymentRatio;
            }
          });
        }
      }

      // Total revenue = cash/card sales + credit payments received
      const totalRevenue = cashCardSales + creditPaymentsRevenue;

      // Fetch refunds - exclude deleted
      const refundsData = (
        await fetchAllPages<any>((from, to) =>
          supabase
            .from('refunds')
            .select('amount, created_at')
            .is('deleted_at', null)
            .gte('created_at', fetchStartUTC)
            .lte('created_at', fetchEndUTC)
            .order('created_at', { ascending: true })
            .range(from, to),
        )
      ).filter((refund) => isWithinUgandaDateRange(refund.created_at, startStr, endStr));

      const totalRefunds = refundsData?.reduce((sum, r) => sum + Number(r.amount), 0) || 0;

      // Fetch exchange refunds
      const { data: exchangesData } = await supabase
        .from('exchanges')
        .select('refund_given, cash_date')
        .gte('cash_date', startStr)
        .lte('cash_date', endStr);

      const exchangeRefunds = exchangesData?.reduce((sum, e) => sum + Number(e.refund_given || 0), 0) || 0;

      // Fetch expenses
      const { data: expensesData } = await supabase
        .from('expenses')
        .select('amount, category, expense_date')
        .gte('expense_date', startStr)
        .lte('expense_date', endStr);

      const totalExpenses = expensesData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

      // Calculate expenses by category
      const expCat: Record<string, number> = {};
      expensesData?.forEach(e => {
        expCat[e.category] = (expCat[e.category] || 0) + Number(e.amount);
      });
      setExpensesByCategory(expCat);

      // Calculate financial metrics
      const netRevenue = totalRevenue - totalRefunds - exchangeRefunds;
      const grossProfit = netRevenue - cogs;
      const netProfit = grossProfit - totalExpenses;

      setFinancialData({
        revenue: totalRevenue,
        refunds: totalRefunds,
        exchangeRefunds,
        netRevenue,
        cogs,
        grossProfit,
        expenses: totalExpenses,
        netProfit
      });

      // Calculate assets
      // Cash from bank deposits
      const { data: depositsData } = await supabase
        .from('bank_deposits')
        .select('amount');
      const cashInBank = depositsData?.reduce((sum, d) => sum + Number(d.amount), 0) || 0;

      // Inventory value using unit_cost (COGS-based valuation)
      const { data: inventoryData } = await supabase
        .from('products')
        .select('unit_cost, stock_quantity');
      const inventoryValue = inventoryData?.reduce((sum, p) => sum + (Number(p.unit_cost || 0) * Number(p.stock_quantity)), 0) || 0;

      // Accounts receivable - outstanding credit balances
      const { data: creditSalesData } = await supabase
        .from('credit_sales')
        .select('balance')
        .neq('status', 'paid');
      const receivables = creditSalesData?.reduce((sum, c) => sum + Number(c.balance), 0) || 0;

      setAssets({
        cash: cashInBank,
        inventory: inventoryValue,
        receivables
      });

      // Liabilities (pending purchase orders)
      const { data: pendingPO } = await supabase
        .from('purchase_orders')
        .select('total_amount')
        .in('status', ['pending', 'ordered']);
      const payables = pendingPO?.reduce((sum, p) => sum + Number(p.total_amount), 0) || 0;

      setLiabilities({ payables });

      // Monthly trend data with COGS calculation
      const months: MonthlyData[] = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = startOfMonth(subMonths(new Date(), i));
        const monthEnd = endOfMonth(subMonths(new Date(), i));
        const monthStartStr = format(monthStart, 'yyyy-MM-dd');
        const monthEndStr = format(monthEnd, 'yyyy-MM-dd');
        const { start: monthFetchStartUTC, end: monthFetchEndUTC } = getTimestampFetchWindow(monthStart, monthEnd);

        // Get sales for the month
        const mSales = (
          await fetchAllPages<any>((from, to) =>
            supabase
              .from('sales')
              .select('id, total, created_at')
              .is('deleted_at', null)
              .neq('payment_method', 'credit')
              .gte('created_at', monthFetchStartUTC)
              .lte('created_at', monthFetchEndUTC)
              .order('created_at', { ascending: true })
              .range(from, to),
          )
        ).filter((sale) => isWithinUgandaDateRange(sale.created_at, monthStartStr, monthEndStr));

        const cashCardSales = mSales?.reduce((sum, s) => sum + Number(s.total), 0) || 0;
        const monthSaleIds = mSales?.map(s => s.id) || [];

        // Calculate COGS for the month using batched sale IDs
        let monthCogs = 0;
        {
          let allMonthSaleItems: any[] = [];
          const idBatchSize = 200;
          for (let i = 0; i < monthSaleIds.length; i += idBatchSize) {
            const idBatch = monthSaleIds.slice(i, i + idBatchSize);
            let monthOffset = 0;
            const monthBatchSize = 1000;
            while (true) {
              const { data: batch } = await supabase
                .from('sale_items')
                .select('quantity, products(unit_cost)')
                .in('sale_id', idBatch)
                .range(monthOffset, monthOffset + monthBatchSize - 1);
              if (!batch || batch.length === 0) break;
              allMonthSaleItems = allMonthSaleItems.concat(batch);
              if (batch.length < monthBatchSize) break;
              monthOffset += monthBatchSize;
            }
          }

          monthCogs = allMonthSaleItems.reduce((sum, item: any) => {
            const unitCost = Number(item.products?.unit_cost) || 0;
            return sum + (unitCost * item.quantity);
          }, 0);
        }

        // Credit payments for the month
        const mCreditPayments = (
          await fetchAllPages<any>((from, to) =>
            supabase
              .from('credit_payments')
              .select('amount, credit_sale_id, payment_date')
              .gte('payment_date', monthFetchStartUTC)
              .lte('payment_date', monthFetchEndUTC)
              .order('payment_date', { ascending: true })
              .range(from, to),
          )
        ).filter((payment) => isWithinUgandaDateRange(payment.payment_date, monthStartStr, monthEndStr));

        const creditPayments = mCreditPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

        // Proportional COGS for credit payments in this month
        if (mCreditPayments && mCreditPayments.length > 0) {
          const mcCreditSaleIds = [...new Set(mCreditPayments.map(p => p.credit_sale_id))];
          const { data: mcCreditSalesInfo } = await supabase
            .from('credit_sales')
            .select('id, sale_id, total_amount')
            .in('id', mcCreditSaleIds);

          if (mcCreditSalesInfo && mcCreditSalesInfo.length > 0) {
            const mcSaleIds = mcCreditSalesInfo.map(cs => cs.sale_id);
            let allMcItems: any[] = [];
            let mcOffset = 0;
            while (true) {
              const { data: batch } = await supabase
                .from('sale_items')
                .select('sale_id, quantity, products(unit_cost)')
                .in('sale_id', mcSaleIds)
                .range(mcOffset, mcOffset + 1000 - 1);
              if (!batch || batch.length === 0) break;
              allMcItems = allMcItems.concat(batch);
              if (batch.length < 1000) break;
              mcOffset += 1000;
            }
            const mcSaleCogs = new Map<string, number>();
            allMcItems.forEach((item: any) => {
              const unitCost = Number(item.products?.unit_cost) || 0;
              mcSaleCogs.set(item.sale_id, (mcSaleCogs.get(item.sale_id) || 0) + unitCost * item.quantity);
            });
            const mcIdMap = new Map(mcCreditSalesInfo.map(cs => [cs.id, { saleId: cs.sale_id, total: cs.total_amount }]));
            mCreditPayments.forEach(payment => {
              const info = mcIdMap.get(payment.credit_sale_id);
              if (info) {
                const ratio = info.total > 0 ? Number(payment.amount) / info.total : 0;
                monthCogs += (mcSaleCogs.get(info.saleId) || 0) * ratio;
              }
            });
          }
        }

        // Refunds for the month
        const mRefunds = (
          await fetchAllPages<any>((from, to) =>
            supabase
              .from('refunds')
              .select('amount, created_at')
              .is('deleted_at', null)
              .gte('created_at', monthFetchStartUTC)
              .lte('created_at', monthFetchEndUTC)
              .order('created_at', { ascending: true })
              .range(from, to),
          )
        ).filter((refund) => isWithinUgandaDateRange(refund.created_at, monthStartStr, monthEndStr));

        const monthRefunds = mRefunds?.reduce((sum, r) => sum + Number(r.amount), 0) || 0;

        // Exchange refunds for the month
        const { data: mExchanges } = await supabase
          .from('exchanges')
          .select('refund_given')
          .gte('cash_date', monthStartStr)
          .lte('cash_date', monthEndStr);
        const monthExchangeRefunds = mExchanges?.reduce((sum, e) => sum + Number(e.refund_given || 0), 0) || 0;

        const { data: mExpenses } = await supabase
          .from('expenses')
          .select('amount')
          .gte('expense_date', monthStartStr)
          .lte('expense_date', monthEndStr);

        const revenue = cashCardSales + creditPayments;
        const expenses = mExpenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
        const netRevenue = revenue - monthRefunds - monthExchangeRefunds;
        const grossProfit = netRevenue - monthCogs;
        const netProfit = grossProfit - expenses;

        months.push({
          month: format(monthStart, 'MMM yyyy'),
          revenue: netRevenue,
          cogs: monthCogs,
          grossProfit,
          expenses,
          netProfit
        });
      }
      setMonthlyData(months);

    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalAssets = assets.cash + assets.inventory + assets.receivables;
  const totalLiabilities = liabilities.payables;
  const equity = totalAssets - totalLiabilities;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Financial Reports</h1>
          <p className="text-muted-foreground">Balance sheets, income statements, and financial analysis</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-full sm:w-48">
              <CalendarIcon className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">This Month</SelectItem>
              <SelectItem value="last">Last Month</SelectItem>
              <SelectItem value="quarter">Last 3 Months</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {period === 'custom' && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal sm:w-[180px]">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(customStartDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={customStartDate}
                    onSelect={(date) => date && setCustomStartDate(date)}
                    disabled={(date) => date > customEndDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal sm:w-[180px]">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(customEndDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={customEndDate}
                    onSelect={(date) => date && setCustomEndDate(date)}
                    disabled={(date) => date < customStartDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="income" className="space-y-6">
        <TabsList>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        {/* Income Statement */}
        <TabsContent value="income" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg flex-shrink-0">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">Revenue</p>
                    <p className="text-xl font-bold text-green-600 truncate">{formatCurrency(financialData.revenue)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
                    <Package className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">Cost of Goods Sold</p>
                    <p className="text-xl font-bold text-blue-600 truncate">-{formatCurrency(financialData.cogs)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${financialData.grossProfit >= 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                    <TrendingUp className={`h-5 w-5 ${financialData.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">Gross Profit</p>
                    <p className={`text-xl font-bold truncate ${financialData.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(financialData.grossProfit)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className={`overflow-hidden ${financialData.netProfit >= 0 ? 'border-green-500' : 'border-red-500'}`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${financialData.netProfit >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                    <FileText className={`h-5 w-5 ${financialData.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">Net Profit</p>
                    <p className={`text-xl font-bold truncate ${financialData.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(financialData.netProfit)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Income Statement</CardTitle>
              <CardDescription>Profit and Loss Report</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow className="font-medium bg-muted/50">
                    <TableCell colSpan={2}>Revenue</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8">Sales Revenue</TableCell>
                    <TableCell className="text-right">{formatCurrency(financialData.revenue)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8">Less: Sales Returns & Refunds</TableCell>
                    <TableCell className="text-right text-red-600">({formatCurrency(financialData.refunds)})</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8">Less: Exchange Refunds</TableCell>
                    <TableCell className="text-right text-red-600">({formatCurrency(financialData.exchangeRefunds)})</TableCell>
                  </TableRow>
                  <TableRow className="font-medium border-t">
                    <TableCell>Net Revenue</TableCell>
                    <TableCell className="text-right">{formatCurrency(financialData.netRevenue)}</TableCell>
                  </TableRow>

                  <TableRow className="font-medium bg-muted/50 mt-4">
                    <TableCell colSpan={2}>Cost of Goods Sold</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8">Product Costs (COGS)</TableCell>
                    <TableCell className="text-right text-red-600">({formatCurrency(financialData.cogs)})</TableCell>
                  </TableRow>
                  <TableRow className="font-bold border-t bg-emerald-50">
                    <TableCell>Gross Profit</TableCell>
                    <TableCell className={`text-right ${financialData.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(financialData.grossProfit)}
                    </TableCell>
                  </TableRow>

                  <TableRow className="font-medium bg-muted/50 mt-4">
                    <TableCell colSpan={2}>Operating Expenses</TableCell>
                  </TableRow>
                  {Object.entries(expensesByCategory).map(([category, amount]) => (
                    <TableRow key={category}>
                      <TableCell className="pl-8 capitalize">{category}</TableCell>
                      <TableCell className="text-right">({formatCurrency(amount)})</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium border-t">
                    <TableCell>Total Expenses</TableCell>
                    <TableCell className="text-right text-red-600">({formatCurrency(financialData.expenses)})</TableCell>
                  </TableRow>

                  <TableRow className="font-bold text-lg border-t-2 bg-muted">
                    <TableCell>Net Profit</TableCell>
                    <TableCell className={`text-right ${financialData.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(financialData.netProfit)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Balance Sheet */}
        <TabsContent value="balance" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Assets</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow className="font-medium bg-muted/50">
                      <TableCell>Current Assets</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Cash in Bank</TableCell>
                      <TableCell className="text-right">{formatCurrency(assets.cash)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Inventory</TableCell>
                      <TableCell className="text-right">{formatCurrency(assets.inventory)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Accounts Receivable</TableCell>
                      <TableCell className="text-right">{formatCurrency(assets.receivables)}</TableCell>
                    </TableRow>
                    <TableRow className="font-bold border-t-2 bg-muted">
                      <TableCell>Total Assets</TableCell>
                      <TableCell className="text-right">{formatCurrency(totalAssets)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Liabilities & Equity</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow className="font-medium bg-muted/50">
                      <TableCell>Current Liabilities</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Accounts Payable (Pending POs)</TableCell>
                      <TableCell className="text-right">{formatCurrency(liabilities.payables)}</TableCell>
                    </TableRow>
                    <TableRow className="font-medium border-t">
                      <TableCell>Total Liabilities</TableCell>
                      <TableCell className="text-right">{formatCurrency(totalLiabilities)}</TableCell>
                    </TableRow>

                    <TableRow className="font-medium bg-muted/50 mt-4">
                      <TableCell>Owner's Equity</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Retained Earnings</TableCell>
                      <TableCell className="text-right">{formatCurrency(equity)}</TableCell>
                    </TableRow>

                    <TableRow className="font-bold border-t-2 bg-muted">
                      <TableCell>Total Liabilities & Equity</TableCell>
                      <TableCell className="text-right">{formatCurrency(totalAssets)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Trends */}
        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Performance (Last 6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Gross Profit</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Net Profit</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyData.map((data, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{data.month}</TableCell>
                      <TableCell className="text-right">{formatCurrency(data.revenue)}</TableCell>
                      <TableCell className="text-right text-blue-600">({formatCurrency(data.cogs)})</TableCell>
                      <TableCell className={`text-right ${data.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatCurrency(data.grossProfit)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">({formatCurrency(data.expenses)})</TableCell>
                      <TableCell className={`text-right font-medium ${data.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(data.netProfit)}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.revenue > 0 ? ((data.netProfit / data.revenue) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2 bg-muted">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthlyData.reduce((s, d) => s + d.revenue, 0))}</TableCell>
                    <TableCell className="text-right text-blue-600">({formatCurrency(monthlyData.reduce((s, d) => s + d.cogs, 0))})</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthlyData.reduce((s, d) => s + d.grossProfit, 0))}</TableCell>
                    <TableCell className="text-right text-red-600">({formatCurrency(monthlyData.reduce((s, d) => s + d.expenses, 0))})</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthlyData.reduce((s, d) => s + d.netProfit, 0))}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reports;