(function attachPrices(global) {
  // Observed-price log. The app's biggest data gap is real local pricing — most
  // catalog bottles only carry MSRP or a stale source price. Letting you log
  // what you actually see on shelves turns Buy/Pass into real, local guidance.
  //
  // state.prices[bottleId] = [{ price, ts, store }]  (newest first)

  function ensure(state) {
    if (!state.prices || typeof state.prices !== "object") state.prices = {};
    return state.prices;
  }

  function list(state, bottleId) {
    return (state && state.prices && state.prices[bottleId]) || [];
  }

  function add(state, bottleId, price, store, ts) {
    const value = Number(price);
    if (!bottleId || !Number.isFinite(value) || value <= 0) return false;
    const prices = ensure(state);
    const arr = prices[bottleId] || (prices[bottleId] = []);
    arr.unshift({ price: Math.round(value * 100) / 100, ts: ts || Date.now(), store: String(store || "").trim() });
    if (arr.length > 25) arr.length = 25;
    return true;
  }

  function removeAt(state, bottleId, index) {
    const arr = list(state, bottleId);
    if (index < 0 || index >= arr.length) return;
    arr.splice(index, 1);
    if (!arr.length && state.prices) delete state.prices[bottleId];
  }

  function stats(state, bottleId) {
    const arr = list(state, bottleId);
    const values = arr.map((o) => o.price).filter((p) => Number.isFinite(p)).sort((a, b) => a - b);
    if (!values.length) return null;
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return {
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      median: Math.round(median * 100) / 100,
      latest: arr[0].price
    };
  }

  global.BarrelPrices = { list, add, removeAt, stats };
})(typeof window !== "undefined" ? window : globalThis);
