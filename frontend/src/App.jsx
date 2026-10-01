import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { Accounts } from './components/Accounts';
import { Investments } from './components/Investments';
import { Deposits } from './components/Deposits';
import { Charts } from './components/Charts';
import { RealizedGains } from './components/RealizedGains';
import { DayChange } from './components/DayChange';
import { FundInsights } from './components/FundInsights';
import { PortfolioXRay } from './components/PortfolioXRay';
import { ThemeToggle } from './components/ThemeToggle';
import { RefreshPortfolio } from './components/RefreshPortfolio';
import { QuickAddTransaction } from './components/QuickAddTransaction';
import { ExportReport } from './components/ExportReport';
import { Toaster } from './components/ui/Toast';
import { InstallPrompt } from './components/InstallPrompt';
import { AutoRefreshNAV } from './components/AutoRefreshNAV';
import { LayoutDashboard, Wallet, TrendingUp, BarChart3, Landmark, DollarSign, Activity, Lightbulb, Layers } from 'lucide-react';
import { cn } from './lib/utils';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  // Allow Dashboard summary cards to deep-link into Insights/X-Ray tabs.
  useEffect(() => {
    const handler = (e) => {
      if (e?.detail?.tab) setActiveTab(e.detail.tab);
    };
    window.addEventListener('navigate-tab', handler);
    return () => window.removeEventListener('navigate-tab', handler);
  }, []);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'accounts', label: 'Accounts', icon: Wallet },
    { id: 'investments', label: 'Investments', icon: TrendingUp },
    { id: 'deposits', label: 'Deposits', icon: Landmark },
    { id: 'day-change', label: 'Day Change', icon: Activity },
    { id: 'realized-gains', label: 'Realized Gains', icon: DollarSign },
    { id: 'charts', label: 'Charts', icon: BarChart3 },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
    { id: 'xray', label: 'X-Ray', icon: Layers },
  ];

  return (
    <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Portfolio Tracker
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <QuickAddTransaction />
              <ExportReport />
              <RefreshPortfolio />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Navigation */}
      <nav className="border-b bg-card/80 backdrop-blur sticky top-16 z-40">
        <div className="container mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-thin -mx-1 px-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
                  )}
                >
                  <Icon className={cn('h-4 w-4 transition-transform', isActive && 'scale-110')} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'accounts' && <Accounts />}
        {activeTab === 'investments' && <Investments />}
        {activeTab === 'deposits' && <Deposits />}
        {activeTab === 'day-change' && <DayChange />}
        {activeTab === 'realized-gains' && <RealizedGains />}
        {activeTab === 'charts' && <Charts />}
        {activeTab === 'insights' && <FundInsights />}
        {activeTab === 'xray' && <PortfolioXRay />}
      </main>

      {/* Footer */}
      <footer className="border-t bg-card/60 mt-12">
        <div className="container mx-auto px-4 py-5">
          <div className="text-center text-xs text-muted-foreground">
            All data stays on your device. No accounts, no servers, no tracking.
          </div>
        </div>
      </footer>
      <InstallPrompt />
      <AutoRefreshNAV />
      <Toaster />
    </div>
  );
}

export default App;
