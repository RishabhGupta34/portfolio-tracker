import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { portfolioApi } from './api';
import { getPortfolio } from './storage';
import { loadXRayCache } from './holdingsAnalysis';

// Brand palette (kept in-sync visually with app theme)
const COLOR = {
  primary: [37, 99, 235],
  primaryLight: [219, 234, 254],
  text: [17, 24, 39],
  muted: [107, 114, 128],
  border: [229, 231, 235],
  bgAlt: [249, 250, 251],
  green: [22, 163, 74],
  red: [220, 38, 38],
  amber: [217, 119, 6],
};

const TYPE_LABELS = {
  mutual_fund: 'Mutual Fund',
  stock: 'Stock',
  private_share: 'Private Share',
  esop: 'ESOP / RSU',
  fd: 'FD',
  ppf: 'PPF',
  epf: 'EPF',
  gold: 'Gold/Silver',
  other: 'Other',
};

function fmtINR(value) {
  if (value == null || isNaN(value)) return '-';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}Rs ${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}Rs ${(abs / 1e5).toFixed(2)} L`;
  return `${sign}Rs ${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtPct(value, digits = 2) {
  if (value == null || isNaN(value) || !isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

function fmtDate(d = new Date()) {
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function captureElement(selector, options = {}) {
  const el = document.querySelector(selector);
  if (!el) return null;
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      ...options,
    });
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('Failed to capture', selector, e);
    return null;
  }
}

function drawSectionHeader(doc, title, y) {
  doc.setFillColor(...COLOR.primary);
  doc.rect(40, y, 4, 14, 'F');
  doc.setFontSize(13);
  doc.setTextColor(...COLOR.text);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 52, y + 11);
  return y + 22;
}

function drawCoverPage(doc, dashboard) {
  const pageW = doc.internal.pageSize.getWidth();
  const pm = dashboard.portfolio_metrics || {};

  // Banner
  doc.setFillColor(...COLOR.primary);
  doc.rect(0, 0, pageW, 140, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text('Portfolio Report', 40, 70);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated ${fmtDate()}`, 40, 92);

  // Summary tiles
  const tiles = [
    { label: 'Current Value', value: fmtINR(pm.total_value), color: COLOR.text },
    { label: 'Total Invested', value: fmtINR(pm.total_invested), color: COLOR.text },
    {
      label: 'Absolute Return',
      value: `${fmtINR(pm.total_returns)} (${fmtPct(pm.total_returns_pct)})`,
      color: (pm.total_returns ?? 0) >= 0 ? COLOR.green : COLOR.red,
    },
    {
      label: 'XIRR',
      value: pm.xirr != null ? fmtPct(pm.xirr) : '-',
      color: (pm.xirr ?? 0) >= 0 ? COLOR.green : COLOR.red,
    },
  ];

  let y = 180;
  const tileW = (pageW - 80 - 20) / 2;
  tiles.forEach((tile, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 40 + col * (tileW + 20);
    const ty = y + row * 90;
    doc.setDrawColor(...COLOR.border);
    doc.setFillColor(...COLOR.bgAlt);
    doc.roundedRect(x, ty, tileW, 70, 8, 8, 'FD');
    doc.setFontSize(9);
    doc.setTextColor(...COLOR.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(tile.label.toUpperCase(), x + 14, ty + 22);
    doc.setFontSize(16);
    doc.setTextColor(...tile.color);
    doc.setFont('helvetica', 'bold');
    doc.text(tile.value, x + 14, ty + 48);
  });

  // Footer note
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.muted);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'All values are computed locally from your transaction history. No data leaves your device.',
    40,
    doc.internal.pageSize.getHeight() - 40
  );
}

function drawAllocationTable(doc, dashboard, startY) {
  const eligible = (dashboard.fund_metrics || []).filter((fm) => fm.metrics.current_value > 0);
  const byType = {};
  for (const fm of eligible) {
    const key = fm.fund.type || 'other';
    byType[key] = byType[key] || { value: 0, invested: 0, count: 0 };
    byType[key].value += fm.metrics.current_value;
    byType[key].invested += fm.metrics.total_invested;
    byType[key].count += 1;
  }
  const total = Object.values(byType).reduce((s, v) => s + v.value, 0);
  const rows = Object.entries(byType)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([type, v]) => [
      TYPE_LABELS[type] || type,
      String(v.count),
      fmtINR(v.invested),
      fmtINR(v.value),
      fmtPct(v.invested > 0 ? ((v.value - v.invested) / v.invested) * 100 : 0),
      total > 0 ? `${((v.value / total) * 100).toFixed(1)}%` : '-',
    ]);

  autoTable(doc, {
    startY,
    head: [['Asset Type', 'Funds', 'Invested', 'Current Value', 'Return', 'Weight']],
    body: rows,
    headStyles: {
      fillColor: COLOR.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9, textColor: COLOR.text },
    alternateRowStyles: { fillColor: COLOR.bgAlt },
    margin: { left: 40, right: 40 },
    theme: 'striped',
  });
  return doc.lastAutoTable.finalY + 18;
}

function drawHoldingsTable(doc, dashboard) {
  const accountMap = {};
  for (const am of dashboard.account_metrics || []) {
    accountMap[am.account.id] = am.account.name;
  }

  const holdings = (dashboard.fund_metrics || [])
    .filter((fm) => fm.metrics.current_value > 0 || fm.metrics.current_units > 0)
    .sort((a, b) => b.metrics.current_value - a.metrics.current_value);

  const rows = holdings.map(({ fund, metrics }) => [
    fund.name,
    TYPE_LABELS[fund.type] || fund.type,
    accountMap[fund.account_id] || '-',
    metrics.current_units?.toLocaleString('en-IN', { maximumFractionDigits: 4 }) || '0',
    fmtINR(metrics.total_invested),
    fmtINR(metrics.current_value),
    fmtPct(metrics.absolute_return_pct),
    metrics.xirr != null ? fmtPct(metrics.xirr) : '-',
  ]);

  autoTable(doc, {
    startY: 60,
    head: [['Fund', 'Type', 'Account', 'Units', 'Invested', 'Value', 'Return', 'XIRR']],
    body: rows,
    headStyles: {
      fillColor: COLOR.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 8, textColor: COLOR.text },
    alternateRowStyles: { fillColor: COLOR.bgAlt },
    columnStyles: {
      0: { cellWidth: 130 },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
    margin: { left: 40, right: 40 },
    didDrawCell: (data) => {
      if (data.section === 'body' && (data.column.index === 6 || data.column.index === 7)) {
        const txt = data.cell.text?.[0];
        if (typeof txt === 'string') {
          if (txt.startsWith('+')) data.cell.styles.textColor = COLOR.green;
          else if (txt.startsWith('-')) data.cell.styles.textColor = COLOR.red;
        }
      }
    },
    theme: 'striped',
  });
}

async function drawChartImages(doc, captures) {
  const pageW = doc.internal.pageSize.getWidth();
  for (const c of captures) {
    if (!c.dataUrl) continue;
    doc.addPage();
    let y = drawSectionHeader(doc, c.title, 40);
    const props = doc.getImageProperties(c.dataUrl);
    const maxW = pageW - 80;
    const aspect = props.height / props.width;
    let imgW = maxW;
    let imgH = imgW * aspect;
    const maxH = doc.internal.pageSize.getHeight() - y - 60;
    if (imgH > maxH) {
      imgH = maxH;
      imgW = imgH / aspect;
    }
    doc.addImage(c.dataUrl, 'PNG', 40, y, imgW, imgH);
  }
}

function drawXRaySection(doc) {
  const cached = loadXRayCache();
  if (!cached?.data?.xray) return;
  const xray = cached.data.xray;

  doc.addPage();
  let y = drawSectionHeader(doc, 'Portfolio X-Ray', 40);

  doc.setFontSize(9);
  doc.setTextColor(...COLOR.muted);
  doc.setFont('helvetica', 'normal');
  const summary = xray.summary || {};
  doc.text(
    `Coverage: ${summary.coveragePercent ?? '-'}% of portfolio  -  ${summary.totalCompanies ?? xray.companies?.length ?? 0} unique companies  -  ${summary.totalFunds ?? '-'} funds analysed`,
    40,
    y
  );
  y += 14;

  const top = (xray.companies || []).slice(0, 20);
  const rows = top.map((c, i) => [
    String(i + 1),
    c.name || c.symbol || 'Unknown',
    c.symbol || '-',
    String(c.fundCount || 0),
    `${(c.portfolioPercent || 0).toFixed(2)}%`,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['#', 'Company', 'Symbol', 'In funds', '% of portfolio']],
    body: rows,
    headStyles: {
      fillColor: COLOR.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9, textColor: COLOR.text },
    alternateRowStyles: { fillColor: COLOR.bgAlt },
    margin: { left: 40, right: 40 },
    theme: 'striped',
  });

  if (xray.sectors?.length) {
    let yy = doc.lastAutoTable.finalY + 18;
    yy = drawSectionHeader(doc, 'Top Sectors', yy);
    autoTable(doc, {
      startY: yy,
      head: [['Sector', '% of portfolio']],
      body: xray.sectors.slice(0, 10).map((s) => [s.sector, `${(s.portfolioPercent || 0).toFixed(2)}%`]),
      headStyles: {
        fillColor: COLOR.primary,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: COLOR.text },
      alternateRowStyles: { fillColor: COLOR.bgAlt },
      margin: { left: 40, right: 40 },
      theme: 'striped',
    });
  }
}

function drawInsightsSection(doc, dashboard) {
  const eligible = (dashboard.fund_metrics || []).filter((fm) => fm.metrics.current_value > 0);
  if (!eligible.length) return;

  const totalValue = eligible.reduce((s, fm) => s + fm.metrics.current_value, 0);
  const sorted = [...eligible].sort((a, b) => b.metrics.current_value - a.metrics.current_value);
  const topConcentrationPct = totalValue > 0 ? (sorted[0].metrics.current_value / totalValue) * 100 : 0;
  let hhi = 0;
  for (const fm of eligible) {
    const w = totalValue > 0 ? fm.metrics.current_value / totalValue : 0;
    hhi += w * w;
  }
  const effectiveFunds = hhi > 0 ? 1 / hhi : 0;
  const equityCount = eligible.filter((fm) =>
    ['mutual_fund', 'stock', 'private_share', 'esop'].includes(fm.fund.type)
  ).length;
  const underperformers = eligible.filter(
    (fm) => fm.metrics.absolute_return_pct != null && fm.metrics.absolute_return_pct < 0
  ).length;

  doc.addPage();
  let y = drawSectionHeader(doc, 'Insights Snapshot', 40);

  const stats = [
    ['Total funds (active)', String(eligible.length)],
    ['Equity holdings', String(equityCount)],
    ['Underperformers (absolute return < 0)', String(underperformers)],
    ['Top fund', `${sorted[0].fund.name}  -  ${topConcentrationPct.toFixed(1)}%`],
    ['Effective funds (HHI)', `${effectiveFunds.toFixed(2)} / ${eligible.length}`],
  ];

  autoTable(doc, {
    startY: y,
    body: stats,
    bodyStyles: { fontSize: 10, textColor: COLOR.text },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: COLOR.muted, cellWidth: 220 },
      1: { halign: 'right' },
    },
    margin: { left: 40, right: 40 },
    theme: 'plain',
  });

  // Top 5 concentration list
  let yy = doc.lastAutoTable.finalY + 18;
  yy = drawSectionHeader(doc, 'Top 5 Concentration', yy);
  autoTable(doc, {
    startY: yy,
    head: [['#', 'Fund', 'Value', '% of portfolio']],
    body: sorted.slice(0, 5).map((fm, i) => [
      String(i + 1),
      fm.fund.name,
      fmtINR(fm.metrics.current_value),
      `${((fm.metrics.current_value / totalValue) * 100).toFixed(1)}%`,
    ]),
    headStyles: {
      fillColor: COLOR.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9, textColor: COLOR.text },
    alternateRowStyles: { fillColor: COLOR.bgAlt },
    margin: { left: 40, right: 40 },
    theme: 'striped',
  });
}

function drawFooter(doc) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(`Portfolio Tracker  -  ${fmtDate()}`, 40, h - 20);
    doc.text(`Page ${i} / ${totalPages}`, w - 40, h - 20, { align: 'right' });
  }
}

async function shareOrDownload(doc, filename) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const base64 = doc.output('datauristring').split(',')[1];
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({
        title: 'Portfolio Report',
        url: result.uri,
        dialogTitle: 'Share portfolio report',
      });
      return;
    }
  } catch (e) {
    console.warn('Native share failed, falling back to download', e);
  }
  doc.save(filename);
}

export async function generatePortfolioReport({
  includeCharts = true,
  onProgress = () => {},
} = {}) {
  onProgress({ step: 'Loading portfolio data...', pct: 5 });
  const [dashboardRes, portfolio] = await Promise.all([
    portfolioApi.getDashboard(),
    getPortfolio(),
  ]);
  const dashboard = dashboardRes.data;

  let captures = [];
  if (includeCharts) {
    onProgress({ step: 'Capturing charts...', pct: 25 });
    // The user must currently be on a tab where these are visible, OR we capture nothing for missing ones.
    const targets = [
      { selector: '[data-report-capture="allocation"]', title: 'Asset Allocation' },
      { selector: '[data-report-capture="performance"]', title: 'Portfolio Performance' },
      { selector: '[data-report-capture="treemap"]', title: 'Holdings Treemap' },
    ];
    for (const t of targets) {
      const dataUrl = await captureElement(t.selector);
      if (dataUrl) captures.push({ ...t, dataUrl });
    }
  }

  onProgress({ step: 'Building report...', pct: 60 });
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Cover
  drawCoverPage(doc, dashboard);

  // Allocation table
  doc.addPage();
  let y = drawSectionHeader(doc, 'Allocation by Asset Type', 40);
  drawAllocationTable(doc, dashboard, y);

  // Holdings table (own page)
  doc.addPage();
  drawSectionHeader(doc, 'All Holdings', 40);
  drawHoldingsTable(doc, dashboard);

  // Insights
  drawInsightsSection(doc, dashboard);

  // X-Ray (optional, only if cached)
  drawXRaySection(doc);

  // Charts (last)
  if (captures.length) {
    onProgress({ step: 'Embedding chart images...', pct: 80 });
    await drawChartImages(doc, captures);
  }

  drawFooter(doc);

  onProgress({ step: 'Saving / sharing...', pct: 95 });
  const stamp = new Date().toISOString().slice(0, 10);
  await shareOrDownload(doc, `portfolio-report-${stamp}.pdf`);
  onProgress({ step: 'Done', pct: 100 });
  return { fundsCount: portfolio?.funds?.length || 0 };
}
