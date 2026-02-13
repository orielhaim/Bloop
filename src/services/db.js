const DB_NAME = 'VaultDB';
const DB_VERSION = 3;
const STORE_KEYS = 'keys';
const STORE_META = 'meta';
const STORE_HISTORY = 'history';
const STORE_CONTACTS = 'contacts';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_KEYS)) {
        db.createObjectStore(STORE_KEYS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY);
      }
      if (!db.objectStoreNames.contains(STORE_CONTACTS)) {
        db.createObjectStore(STORE_CONTACTS);
      }
    };
  });
}

async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function put(storeName, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value, key);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function remove(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function clear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_KEYS, STORE_META, STORE_HISTORY, STORE_CONTACTS], 'readwrite');
    const keysStore = transaction.objectStore(STORE_KEYS);
    const metaStore = transaction.objectStore(STORE_META);
    const historyStore = transaction.objectStore(STORE_HISTORY);
    const contactsStore = transaction.objectStore(STORE_CONTACTS);
    
    keysStore.clear();
    metaStore.clear();
    historyStore.clear();
    contactsStore.clear();
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export const db = {
  keys: {
    get: (key) => get(STORE_KEYS, key),
    put: (key, value) => put(STORE_KEYS, key, value),
    remove: (key) => remove(STORE_KEYS, key),
  },
  meta: {
    get: (key) => get(STORE_META, key),
    put: (key, value) => put(STORE_META, key, value),
    remove: (key) => remove(STORE_META, key),
  },
  history: {
    get: (key) => get(STORE_HISTORY, key),
    put: (key, value) => put(STORE_HISTORY, key, value),
    remove: (key) => remove(STORE_HISTORY, key),
  },
  contacts: {
    get: (key) => get(STORE_CONTACTS, key),
    put: (key, value) => put(STORE_CONTACTS, key, value),
    remove: (key) => remove(STORE_CONTACTS, key),
  },
  clear,
};
