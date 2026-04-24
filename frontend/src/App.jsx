import React, { useState } from 'react';
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
import { Toaster } from './components/ui/Toast';
import { InstallPrompt } from './components/InstallPrompt';
import { AutoRefreshNAV } from './components/AutoRefreshNAV';
import { LayoutDashboard, Wallet, TrendingUp, BarChart3, Landmark, DollarSign, Activity, Lightbulb, Layers } from 'lucide-react';
import { cn } from './lib/utils';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

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
              <RefreshPortfolio />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Navigation */}
      <nav className="border-b bg-card">
        <div className="container mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2',
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
                  )}
                >
                  <Icon className="h-4 w-4" />
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
      <footer className="border-t bg-card mt-12">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center text-sm text-muted-foreground">
            <p>All data is stored locally on your machine. No external API calls are made.</p>
            <p className="mt-1">Built with React, TailwindCSS, and FastAPI</p>
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
