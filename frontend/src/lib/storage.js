/**
 * Local storage service using IndexedDB
 * Replaces backend API with client-side storage
 */

const DB_NAME = 'PortfolioTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'portfolio';

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('type', 'type', { unique: false });
      }
    };
  });
}

/**
 * Get portfolio data from IndexedDB
 */
export async function getPortfolio() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('portfolio');

    request.onsuccess = () => {
      const data = request.result;
      if (data) {
        resolve({
          accounts: data.accounts || [],
          funds: data.funds || [],
        });
      } else {
        // Return empty portfolio if not found
        resolve({
          accounts: [],
          funds: [],
        });
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Save portfolio data to IndexedDB
 */
export async function savePortfolio(portfolio) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const data = {
      id: 'portfolio',
      accounts: portfolio.accounts || [],
      funds: portfolio.funds || [],
      updated_at: new Date().toISOString(),
    };

    const request = store.put(data);

    request.onsuccess = () => resolve(data);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Export portfolio data as JSON (for backup)
 */
export async function exportPortfolio() {
  const portfolio = await getPortfolio();
  return JSON.stringify(portfolio, null, 2);
}

/**
 * Import portfolio data from JSON (for restore)
 */
export async function importPortfolio(jsonData) {
  try {
    const portfolio = JSON.parse(jsonData);
    await savePortfolio(portfolio);
    return true;
  } catch (e) {
    throw new Error('Invalid portfolio data: ' + e.message);
  }
}

/**
 * Clear all portfolio data
 */
export async function clearPortfolio() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete('portfolio');

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}


