const DB_NAME = 'devlog-admin';
const DB_VERSION = 1;
const STORES = ['kv', 'bodies', 'history', 'blobs'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        if (name === 'history') {
          const s = db.createObjectStore('history', { keyPath: 'key' });
          s.createIndex('doc', 'docId');
        } else {
          db.createObjectStore(name);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被其他标签页占用，请关闭其他后台标签页后刷新'));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('写入本地数据库失败'));
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, key, value) => tx(store, 'readwrite', s => (store === 'history' ? s.put(value) : s.put(value, key))),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  keys: store => tx(store, 'readonly', s => s.getAllKeys()),
  all: store => tx(store, 'readonly', s => s.getAll()),
  clear: store => tx(store, 'readwrite', s => s.clear()),
  byIndex: (store, index, value) => tx(store, 'readonly', s => s.index(index).getAll(value)),
  async putMany(store, entries) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      for (const [k, v] of entries) {
        if (v === undefined) s.delete(k);
        else s.put(v, k);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
};

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
