/**
 * Background analysis manager — survives React component mount/unmount cycles.
 * State is held at module level so it persists when navigating away from the Insights tab.
 */

const listeners = new Set();

// Module-level state
let state = {
  // Discover background task
  discoverRunning: false,
  discoverAborted: false,
  discoverType: null,       // 'mf' | 'stock'
  discoverProgress: { current: 0, total: 0, currentCat: '', catProgress: '', catIndex: 0, totalCats: 0 },
  discoverResults: {},      // accumulated results across all categories
  discoverDone: false,      // true when analyzeAll finishes
  discoverError: null,

  // Portfolio background task  
  portfolioRunning: false,
  portfolioAborted: false,
  portfolioProgress: { current: 0, total: 0, currentFund: '' },
  portfolioResults: {},
  portfolioDone: false,
  portfolioError: null,
};

function notify() {
  for (const fn of listeners) fn({ ...state });
}

export function subscribe(fn) {
  listeners.add(fn);
  // Immediately send current state
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getState() {
  return { ...state };
}

// ============================================================
// DISCOVER background runner
// ============================================================

export function startDiscoverAll(type, catList, analyzeCategoryFn) {
  // If already running, abort the previous run first
  if (state.discoverRunning) {
    state.discoverAborted = true;
  }
  state = {
    ...state,
    discoverRunning: true,
    discoverAborted: false,
    discoverType: type,
    discoverResults: {},
    discoverDone: false,
    discoverError: null,
    discoverProgress: { current: 0, total: 0, currentCat: '', catProgress: '', catIndex: 0, totalCats: catList.length },
  };
  notify();

  (async () => {
    const allResults = {};
    for (let ci = 0; ci < catList.length; ci++) {
      if (state.discoverAborted) break;
      const cat = catList[ci];
      state.discoverProgress = {
        ...state.discoverProgress,
        currentCat: cat,
        catProgress: `Category ${ci + 1}/${catList.length}`,
        catIndex: ci,
        totalCats: catList.length,
      };
      notify();

      try {
        const catResults = await analyzeCategoryFn(cat, allResults, (itemProgress) => {
          // Per-item progress callback
          state.discoverProgress = { ...state.discoverProgress, current: itemProgress.current, total: itemProgress.total };
          notify();
        });
        // Merge
        Object.assign(allResults, catResults || {});
        // Update accumulated results so UI can show them incrementally
        state.discoverResults = { ...allResults };
        notify();
      } catch (err) {
        console.error(`Error analyzing category ${cat}:`, err);
      }
    }

    state.discoverRunning = false;
    state.discoverDone = true;
    state.discoverResults = { ...allResults };
    notify();
  })();
}

export function abortDiscover() {
  state.discoverAborted = true;
  state.discoverRunning = false;
  notify();
}

export function clearDiscoverState() {
  state.discoverDone = false;
  state.discoverError = null;
  notify();
}

export function resetDiscoverResults() {
  state.discoverResults = {};
  state.discoverDone = false;
  notify();
}
