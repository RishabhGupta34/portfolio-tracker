import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from './ui/Button';
import { toast } from './ui/Toast';

export function ExportReport() {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setStep('Starting...');
    try {
      const { generatePortfolioReport } = await import('../lib/pdfReport');
      await generatePortfolioReport({
        onProgress: ({ step }) => setStep(step),
      });
      toast.success?.('Report ready');
    } catch (e) {
      console.error(e);
      toast.error?.('Failed to generate report');
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={run}
      disabled={busy}
      className="rounded-full relative"
      aria-label="Export PDF report"
      title={busy ? step || 'Generating report...' : 'Export PDF report'}
    >
      <FileText className={`h-5 w-5 ${busy ? 'animate-pulse' : ''}`} />
    </Button>
  );
}
