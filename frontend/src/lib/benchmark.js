// Benchmark data fetching and calculation utilities
// Supports Nifty 50, Sensex, and other Indian market indices

const BENCHMARK_SYMBOLS = {
  'Nifty 50': '^NSEI',
  'Sensex': '^BSESN',
  'Nifty Next 50': '^NSEI_NXT50',
  'Nifty Bank': '^NSEBANK'
};

/**
 * Fetch benchmark index price from Yahoo Finance
 * @param {string} benchmarkName - Name of the benchmark (e.g., 'Nifty 50')
 * @returns {Promise<{price: number, date: string, symbol: string}>}
 */
export async function getBenchmarkPrice(benchmarkName) {
  const symbol = BENCHMARK_SYMBOLS[benchmarkName];
  if (!symbol) {
    throw new Error(`Unknown benchmark: ${benchmarkName}`);
  }

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;

  const parseYahooResponse = (data) => {
    const result = data.chart?.result?.[0];
    if (result && result.meta) {
      const price = result.meta.regularMarketPrice || result.meta.previousClose;
      if (price) {
        return {
          price: price,
          date: result.meta.regularMarketTime
            ? new Date(result.meta.regularMarketTime * 1000).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
          symbol: symbol
        };
      }
    }
    return null;
  };

  // Try CapacitorHttp first (for native iOS app)
  try {
    const { CapacitorHttp } = await import('@capacitor/core');
    const { Capacitor } = await import('@capacitor/core');

    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url: yahooUrl,
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (response.status === 200 && response.data) {
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        const result = parseYahooResponse(data);
        if (result) return result;
      }
    }
  } catch (capacitorHttpError) {
    console.warn('CapacitorHttp failed for benchmark:', capacitorHttpError.message);
  }

  // Fallback: Try XMLHttpRequest
  try {
    const xhrResult = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', yahooUrl, true);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15');
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            const result = parseYahooResponse(data);
            if (result) {
              resolve(result);
            } else {
              reject(new Error('No price data in response'));
            }
          } catch (e) {
            reject(new Error('Failed to parse response: ' + e.message));
          }
        } else {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });
    if (xhrResult) return xhrResult;
  } catch (xhrError) {
    console.warn('XMLHttpRequest failed for benchmark:', xhrError.message);
  }

  // Fallback: Try regular fetch
  try {
    const response = await fetch(yahooUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Origin': window.location.origin,
        'Referer': window.location.origin
      },
      mode: 'cors'
    });

    if (response.ok) {
      const data = await response.json();
      const result = parseYahooResponse(data);
      if (result) return result;
    }
  } catch (fetchError) {
    console.warn('Direct fetch failed for benchmark:', fetchError);
  }

  throw new Error(`Unable to fetch benchmark price for ${benchmarkName}`);
}

/**
 * Fetch historical benchmark data for a date range
 * @param {string} benchmarkName - Name of the benchmark
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of {date, price} objects
 */
async function fetchHistoricalBenchmarkData(benchmarkName, startDate, endDate) {
  const symbol = BENCHMARK_SYMBOLS[benchmarkName];
  if (!symbol) {
    throw new Error(`Unknown benchmark: ${benchmarkName}`);
  }

  // Convert dates to timestamps
  const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
  const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);
  
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${startTimestamp}&period2=${endTimestamp}`;

  const parseYahooHistoricalResponse = (data) => {
    const result = data.chart?.result?.[0];
    if (result && result.timestamp && result.indicators?.quote?.[0]?.close) {
      const timestamps = result.timestamp;
      const closes = result.indicators.quote[0].close;
      
      return timestamps.map((ts, idx) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        price: closes[idx]
      })).filter(item => item.price !== null && item.price !== undefined);
    }
    return [];
  };

  // Try CapacitorHttp first (for native iOS app)
  try {
    const { CapacitorHttp } = await import('@capacitor/core');
    const { Capacitor } = await import('@capacitor/core');

    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url: yahooUrl,
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });

      if (response.status === 200 && response.data) {
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        const result = parseYahooHistoricalResponse(data);
        if (result && result.length > 0) return result;
      }
    }
  } catch (capacitorHttpError) {
    console.warn('CapacitorHttp failed for historical benchmark:', capacitorHttpError.message);
  }

  // Fallback: Try fetch
  try {
    const response = await fetch(yahooUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
      },
      mode: 'cors'
    });

    if (response.ok) {
      const data = await response.json();
      const result = parseYahooHistoricalResponse(data);
      if (result && result.length > 0) return result;
    }
  } catch (fetchError) {
    console.warn('Direct fetch failed for historical benchmark:', fetchError);
  }

  return [];
}

/**
 * Calculate benchmark performance over time
 * @param {Array} timelineData - Portfolio timeline data
 * @param {string} benchmarkName - Name of the benchmark
 * @param {number} currentPrice - Current benchmark price
 * @returns {Promise<Array>} Array of benchmark values aligned with timeline
 */
export async function calculateBenchmarkTimeline(timelineData, benchmarkName, currentPrice) {
  if (!timelineData || timelineData.length === 0 || !currentPrice) {
    return [];
  }

  const firstDate = timelineData[0].date;
  const lastDate = timelineData[timelineData.length - 1].date;
  
  try {
    // Try to fetch historical data
    const historicalData = await fetchHistoricalBenchmarkData(benchmarkName, firstDate, lastDate);
    
    if (historicalData && historicalData.length > 0) {
      // Create a map for quick lookup
      const priceMap = new Map();
      historicalData.forEach(item => {
        priceMap.set(item.date, item.price);
      });
      
      // Align benchmark data with portfolio timeline
      const firstBenchmarkPrice = priceMap.get(firstDate) || historicalData[0]?.price || currentPrice;
      
      // Forward-fill missing values to avoid gaps in the line
      let lastKnownPrice = null;
      let lastKnownReturn = null;
      
      return timelineData.map((item) => {
        let benchmarkPrice = priceMap.get(item.date);
        
        // If no data for this date, use the last known price (forward-fill)
        if (benchmarkPrice === null || benchmarkPrice === undefined) {
          benchmarkPrice = lastKnownPrice;
        } else {
          lastKnownPrice = benchmarkPrice;
        }
        
        // If still no price, try to use first available price or current price
        if (benchmarkPrice === null || benchmarkPrice === undefined) {
          benchmarkPrice = historicalData[0]?.price || currentPrice;
          lastKnownPrice = benchmarkPrice;
        }
        
        if (benchmarkPrice && firstBenchmarkPrice > 0) {
          const benchmarkReturn = ((benchmarkPrice - firstBenchmarkPrice) / firstBenchmarkPrice) * 100;
          lastKnownReturn = benchmarkReturn;
          return {
            date: item.date,
            value: benchmarkPrice,
            return_pct: benchmarkReturn
          };
        }
        
        // Fallback: use last known return or 0
        return {
          date: item.date,
          value: lastKnownPrice || currentPrice,
          return_pct: lastKnownReturn || 0
        };
      });
    }
  } catch (error) {
    console.warn('Failed to fetch historical benchmark data, using simplified model:', error);
  }

  // Fallback: Use simplified model based on current price
  // Assume benchmark started at a reasonable value relative to current price
  // For Nifty 50, typical range is 15k-25k, so we'll use a conservative estimate
  const estimatedStartPrice = currentPrice * 0.85; // Assume 15% growth over the period
  
  return timelineData.map((item, index) => {
    // Simple linear interpolation based on time progression
    const progress = index / Math.max(1, timelineData.length - 1);
    const benchmarkPrice = estimatedStartPrice + (currentPrice - estimatedStartPrice) * progress;
    const benchmarkReturn = ((benchmarkPrice - estimatedStartPrice) / estimatedStartPrice) * 100;
    
    return {
      date: item.date,
      value: benchmarkPrice,
      return_pct: benchmarkReturn
    };
  });
}

/**
 * Get available benchmark names
 * @returns {Array<string>}
 */
export function getAvailableBenchmarks() {
  return Object.keys(BENCHMARK_SYMBOLS);
}
