/* Local-first storage. IndexedDB is the operational store on each device;
   an in-memory store is used automatically if the browser blocks IndexedDB. */

const DB_NAME = "buffet_access_supabase_db";
const DB_VERSION = 1;

export const STORE_DEFS = {
  participants: { key: "participant_id" },
  redemptions: { key: "dedupe_key" },
  audits: { key: "event_id" },
  tokens: { key: "token" },
  outbox: { key: "id", autoIncrement: true },
  meta: { key: "key" },
  staff: { key: "email" },
};

let dbPromise = null;
let idbAvailable = typeof indexedDB !== "undefined";
const memory = {};
let memSeq = 0;

function mem(store) {
  if (!memory[store]) memory[store] = new Map();
  return memory[store];
}

function memPut(store, rec) {
  const def = STORE_DEFS[store];
  const copy = { ...rec };
  if (def.autoIncrement && (copy[def.key] === undefined || copy[def.key] === null)) {
    copy[def.key] = ++memSeq;
  }
  mem(store).set(copy[def.key], copy);
  return copy;
}

function openDb() {
  if (!idbAvailable) return Promise.reject(new Error("indexeddb-unavailable"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        Object.entries(STORE_DEFS).forEach(([name, def]) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: def.key, autoIncrement: !!def.autoIncrement });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb-open-failed"));
    }).catch((err) => {
      idbAvailable = false;
      throw err;
    });
  }
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbAll(store) {
  if (!idbAvailable) return Array.from(mem(store).values());
  try {
    const db = await openDb();
    return await reqToPromise(db.transaction(store, "readonly").objectStore(store).getAll());
  } catch {
    return Array.from(mem(store).values());
  }
}

export async function dbGet(store, key) {
  if (!idbAvailable) return mem(store).get(key);
  try {
    const db = await openDb();
    return await reqToPromise(db.transaction(store, "readonly").objectStore(store).get(key));
  } catch {
    return mem(store).get(key);
  }
}

export async function dbPut(store, rec) {
  if (!idbAvailable) return memPut(store, rec);
  try {
    const db = await openDb();
    await reqToPromise(db.transaction(store, "readwrite").objectStore(store).put(rec));
    return rec;
  } catch (err) {
    if (idbAvailable) throw err;
    return memPut(store, rec);
  }
}

export async function dbPutMany(store, recs) {
  for (const rec of recs) await dbPut(store, rec);
  return recs.length;
}

export async function dbDelete(store, key) {
  if (!idbAvailable) {
    mem(store).delete(key);
    return;
  }
  try {
    const db = await openDb();
    await reqToPromise(db.transaction(store, "readwrite").objectStore(store).delete(key));
  } catch (err) {
    if (idbAvailable) throw err;
    mem(store).delete(key);
  }
}

export async function dbClear(store) {
  if (!idbAvailable) {
    mem(store).clear();
    return;
  }
  try {
    const db = await openDb();
    await reqToPromise(db.transaction(store, "readwrite").objectStore(store).clear());
  } catch (err) {
    if (idbAvailable) throw err;
    mem(store).clear();
  }
}

export async function dbClearAll() {
  for (const store of Object.keys(STORE_DEFS)) await dbClear(store);
}

/* Runs `work(tx)` inside one atomic IndexedDB transaction. Any throw aborts
   the whole transaction, so a redemption is either fully committed or not at all. */
export async function dbTransaction(names, mode, work) {
  if (!idbAvailable) return work(memoryTx());
  let db;
  try {
    db = await openDb();
  } catch {
    return work(memoryTx());
  }
  const tx = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transaction-aborted"));
  });
  done.catch(() => {});
  const handle = {
    get: (store, key) => reqToPromise(tx.objectStore(store).get(key)),
    put: (store, rec) => reqToPromise(tx.objectStore(store).put(rec)),
    delete: (store, key) => reqToPromise(tx.objectStore(store).delete(key)),
  };
  const result = await work(handle);
  await done;
  return result;
}

function memoryTx() {
  return {
    get: async (store, key) => mem(store).get(key),
    put: async (store, rec) => memPut(store, rec),
    delete: async (store, key) => {
      mem(store).delete(key);
    },
  };
}

export async function getMeta(key, fallback = null) {
  const rec = await dbGet("meta", key);
  return rec && rec.value !== undefined ? rec.value : fallback;
}

export async function setMeta(key, value) {
  await dbPut("meta", { key, value });
  return value;
}