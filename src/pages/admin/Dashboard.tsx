import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, MessageSquare, Users, Banknote, CreditCard, CalendarIcon, Receipt, Wallet, ArrowLeftRight, RefreshCw, HandCoins } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Stats {
  totalProducts: number;
  activeProducts: number;
  totalInquiries: number;
  newInquiries: number;
  totalCustomers: number;
  todayCashSales: number;
  todayCreditSales: number;
  todayTransactions: number;
  todayExpenses: number;
  outstandingCredit: number;
  creditCustomers: number;
  exchangeTopUps: number;
  exchangeRefunds: number;
  exchangeCount: number;
  creditPaymentsCollected: number;
  creditPaymentsCount: number;
  cashDrawerBalance: number;
}

interface CreditCustomer {
  customer_id: string;
  customer_name: string;
  total_balance: number;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
   const [stats, setStats] = useState<Stats>({
     totalProducts: 0,
     activeProducts: 0,
     totalInquiries: 0,
     newInquiries: 0,
     totalCustomers: 0,
     todayCashSales: 0,
     todayCreditSales: 0,
     todayTransactions: 0,
     todayExpenses: 0,
     outstandingCredit: 0,
     creditCustomers: 0,
     exchangeTopUps: 0,
     exchangeRefunds: 0,
     exchangeCount: 0,
     creditPaymentsCollected: 0,
     creditPaymentsCount: 0,
     cashDrawerBalance: 0,
   });
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      
      // Create start and end of day in local timezone
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      
      const [productsRes, inquiriesRes, customersRes, salesRes, expensesRes, exchangesRes, creditPaymentsRes] = await Promise.all([
        supabase.from('products').select('id, is_active'),
        supabase.from('inquiries').select('id, status'),
        supabase.from('customers').select('id'),
        supabase.from('sales').select('id, total, payment_method, created_at')
          .is('deleted_at', null)
          .gte('created_at', startOfDay.toISOString())
          .lte('created_at', endOfDay.toISOString()),
        supabase.from('expenses')
          .select('amount')
          .eq('expense_date', dateStr),
        supabase.from('exchanges')
          .select('id, amount_paid, refund_given, exchange_type, cash_date')
          .eq('cash_date', dateStr),
        supabase.from('credit_payments')
          .select('id, amount, payment_method, payment_date')
          .gte('payment_date', startOfDay.toISOString())
          .lte('payment_date', endOfDay.toISOString())
      ]);

      // Get sale IDs for credit sales on the selected date
      const creditSaleIds = salesRes.data?.filter(s => s.payment_method === 'credit').map(s => s.id) || [];
      
      // Fetch credit sales data only for the selected date's sales
      const creditSalesForDate = creditSaleIds.length > 0 
        ? await supabase
            .from('credit_sales')
            .select('sale_id, customer_id, balance, customers(name)')
            .in('sale_id', creditSaleIds)
        : { data: [] };

      // Build a map of sale_id -> credit balance for the selected date
      const creditBalanceMap = new Map<string, number>();
      creditSalesForDate.data?.forEach((c: any) => {
        creditBalanceMap.set(c.sale_id, c.balance);
      });

      // Cash sales: non-credit OR credit with balance = 0 (fully paid)
      const todayCashSales = salesRes.data?.filter(s => {
        if (s.payment_method !== 'credit') return true;
        const balance = creditBalanceMap.get(s.id);
        return balance !== undefined && balance === 0;
      }).reduce((sum, s) => sum + s.total, 0) || 0;
      
      // Credit sales: sum of current balances for sales that still have outstanding amounts
      const todayCreditSales = salesRes.data?.filter(s => {
        if (s.payment_method !== 'credit') return false;
        const balance = creditBalanceMap.get(s.id);
        return balance !== undefined && balance > 0;
      }).reduce((sum, s) => {
        const balance = creditBalanceMap.get(s.id) || 0;
        return sum + balance;
      }, 0) || 0;
      
      // Total expenses for the day
      const todayExpenses = expensesRes.data?.reduce((sum, e) => sum + e.amount, 0) || 0;
      
      // Exchange top-ups and refunds for the day
      const exchangeTopUps = exchangesRes.data?.reduce((sum, e) => sum + (e.amount_paid || 0), 0) || 0;
      const exchangeRefunds = exchangesRes.data?.reduce((sum, e) => sum + (e.refund_given || 0), 0) || 0;
      const exchangeCount = exchangesRes.data?.length || 0;

      // Credit payments collected for the day
      const creditPaymentsCollected = creditPaymentsRes.data?.reduce((sum, p) => sum + p.amount, 0) || 0;
      const creditPaymentsCount = creditPaymentsRes.data?.length || 0;

      // Depositable cash approximation for the day (matches shift cash logic excluding outstanding credit):
      // cash sales + credit payments + exchange top-ups - expenses - exchange refunds
      // NOTE: refunds are not included here because Dashboard doesn't load refunds.
      const cashDrawerBalance =
        todayCashSales + creditPaymentsCollected + exchangeTopUps - todayExpenses - exchangeRefunds;
      
      // Outstanding credit for the selected date (uncollected balances with balance > 0)
      const outstandingCreditData = creditSalesForDate.data?.filter((c: any) => c.balance > 0) || [];
      const outstandingCredit = outstandingCreditData.reduce((sum: number, c: any) => sum + c.balance, 0);
      
      // Group by customer for top balances (only those with balance > 0)
      const customerBalances: Record<string, CreditCustomer> = {};
      outstandingCreditData.forEach((c: any) => {
        if (!customerBalances[c.customer_id]) {
          customerBalances[c.customer_id] = {
            customer_id: c.customer_id,
            customer_name: c.customers?.name || 'Unknown',
            total_balance: 0
          };
        }
        customerBalances[c.customer_id].total_balance += c.balance;
      });
      
      const creditCustomersList = Object.values(customerBalances)
        .sort((a, b) => b.total_balance - a.total_balance)
        .slice(0, 5);

      setCreditCustomers(creditCustomersList);

      setStats({
        totalProducts: productsRes.data?.length || 0,
        activeProducts: productsRes.data?.filter(p => p.is_active).length || 0,
        totalInquiries: inquiriesRes.data?.length || 0,
        newInquiries: inquiriesRes.data?.filter(i => i.status === 'new').length || 0,
        totalCustomers: customersRes.data?.length || 0,
        todayCashSales,
        todayCreditSales,
        todayTransactions: salesRes.data?.length || 0,
        todayExpenses,
        outstandingCredit,
        creditCustomers: Object.keys(customerBalances).length,
        exchangeTopUps,
        exchangeRefunds,
        exchangeCount,
        creditPaymentsCollected,
        creditPaymentsCount,
        cashDrawerBalance,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Real-time subscription for credit and exchange updates
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'credit_sales' },
        () => {
          console.log('Credit sale updated, refreshing dashboard...');
          fetchStats();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'credit_payments' },
        () => {
          console.log('Credit payment made, refreshing dashboard...');
          fetchStats();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exchanges' },
        () => {
          console.log('Exchange processed, refreshing dashboard...');
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStats]);

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const dateLabel = isToday ? "Today's" : format(selectedDate, 'MMM d');

  const financialCards = [
    {
      title: `${dateLabel} Cash Sales`,
      description: 'Sales paid by cash, card, mobile money, bank transfer',
      value: formatCurrency(stats.todayCashSales),
      subtitle: `${stats.todayTransactions - (stats.todayCreditSales > 0 ? 1 : 0)} cash transactions`,
      icon: Banknote,
      color: 'text-green-600',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/30'
    },
    {
      title: `${dateLabel} Credit Outstanding`,
      description: 'Credit sales still awaiting payment',
      value: formatCurrency(stats.todayCreditSales),
      subtitle: stats.todayCreditSales > 0 ? 'Awaiting payment collection' : 'All collected',
      icon: CreditCard,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30'
    },
    {
      title: `${dateLabel} Expenses`,
      description: 'Total business expenses for the day',
      value: formatCurrency(stats.todayExpenses),
      subtitle: 'Deducted from operations',
      icon: Receipt,
      color: 'text-red-600',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30'
    },
    {
      title: 'Uncollected Balances',
      description: 'Total outstanding credit from all customers',
      value: formatCurrency(stats.outstandingCredit),
      subtitle: `${stats.creditCustomers} customers owe`,
      icon: Wallet,
      color: 'text-orange-600',
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/30'
    },
    {
      title: `${dateLabel} Exchange Top-ups`,
      description: 'Extra payments collected from product exchanges',
      value: formatCurrency(stats.exchangeTopUps),
      subtitle: `${stats.exchangeCount} exchanges processed`,
      icon: ArrowLeftRight,
      color: 'text-cyan-600',
      bgColor: 'bg-cyan-500/10',
      borderColor: 'border-cyan-500/30'
    },
    {
      title: `${dateLabel} Exchange Refunds`,
      description: 'Refunds given for exchanges/returns',
      value: formatCurrency(stats.exchangeRefunds),
      subtitle: 'Given back to customers',
      icon: RefreshCw,
      color: 'text-pink-600',
      bgColor: 'bg-pink-500/10',
      borderColor: 'border-pink-500/30'
    },
    {
      title: `${dateLabel} Credit Payments`,
      description: 'Payments collected from credit customers',
      value: formatCurrency(stats.creditPaymentsCollected),
      subtitle: `${stats.creditPaymentsCount} payments received`,
      icon: HandCoins,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/30'
    }
  ];

  const otherCards = [
    {
      title: 'Total Products',
      value: stats.totalProducts,
      subtitle: `${stats.activeProducts} active`,
      icon: Package,
      color: 'text-blue-500'
    },
    {
      title: 'Inquiries',
      value: stats.totalInquiries,
      subtitle: `${stats.newInquiries} new`,
      icon: MessageSquare,
      color: 'text-orange-500'
    },
    {
      title: 'Customers',
      value: stats.totalCustomers,
      subtitle: 'Total registered',
      icon: Users,
      color: 'text-purple-500'
    }
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome to Fady Technologies Admin</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {!isToday && (
            <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Financial Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {financialCards.map((card) => (
          <Card key={card.title} className={cn("border", card.borderColor, card.bgColor)}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className={cn("h-5 w-5", card.color)} />
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-bold", card.color)}>
                {loading ? '...' : card.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {card.subtitle}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-2">
                {card.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Credit Balances */}
      {stats.outstandingCredit > 0 && creditCustomers.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-orange-600">
              <Wallet className="h-5 w-5" />
              Top Uncollected Balances
            </CardTitle>
            <Badge variant="outline" className="border-orange-500 text-orange-600">
              {stats.creditCustomers} customers
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {creditCustomers.map((c) => (
                <div key={c.customer_id} className="flex items-center justify-between p-2 bg-background rounded-lg">
                  <span className="font-medium">{c.customer_name}</span>
                  <span className="text-orange-600 font-bold">{formatCurrency(c.total_balance)}</span>
                </div>
              ))}
              <Button 
                variant="outline" 
                className="w-full mt-2 border-orange-500 text-orange-600 hover:bg-orange-500/10"
                onClick={() => navigate('/admin/customers')}
              >
                View All Credit Sales
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {otherCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={cn("h-5 w-5", stat.color)} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? '...' : stat.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.subtitle}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground text-sm">
              Use the sidebar to access Point of Sale, manage products, track inventory, and handle finances.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-green-600 text-sm font-medium">All systems operational</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;