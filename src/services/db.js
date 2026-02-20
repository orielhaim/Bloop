const DB_NAME = 'VaultDB';
const DB_VERSION = 3;

const STORES = Object.freeze({
  keys: 'keys',
  meta: 'meta',
  history: 'history',
  contacts: 'contacts',
});

const ALL_STORES = Object.freeze(Object.values(STORES));

let dbInstance = null;
let dbOpenPromise = null;

function getDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = ({ target }) => {
      const database = target.result;
      for (const name of ALL_STORES) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name);
        }
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      dbInstance.onclose = () => {
        dbInstance = null;
        dbOpenPromise = null;
      };

      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
        dbOpenPromise = null;
      };

      resolve(dbInstance);
    };

    request.onerror = () => {
      dbOpenPromise = null;
      reject(request.error);
    };
  });

  return dbOpenPromise;
}

function exec(storeName, mode, operation) {
  return getDB().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = operation(store);

        if (request instanceof IDBRequest) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } else {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }
      }),
  );
}

const get    = (store, key)        => exec(store, 'readonly',  (s) => s.get(key));
const getAll = (store)             => exec(store, 'readonly',  (s) => s.getAll());
const put    = (store, key, value) => exec(store, 'readwrite', (s) => s.put(value, key));
const remove = (store, key)        => exec(store, 'readwrite', (s) => s.delete(key));

function clear() {
  return getDB().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(ALL_STORES, 'readwrite');
        for (const name of ALL_STORES) tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function batch(storeName, operations) {
  return getDB().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite');
        for (const { type, key, value } of operations) {
          const store = tx.objectStore(storeName);
          if (type === 'put') store.put(value, key);
          else if (type === 'delete') store.delete(key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function createStoreAccessor(storeName) {
  return Object.freeze({
    get:    (key)        => get(storeName, key),
    getAll: ()           => getAll(storeName),
    put:    (key, value) => put(storeName, key, value),
    remove: (key)        => remove(storeName, key),
    batch:  (ops)        => batch(storeName, ops),
  });
}

export const db = Object.freeze({
  ...Object.fromEntries(ALL_STORES.map((name) => [name, createStoreAccessor(name)])),
  clear,
  destroy() {
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
      dbOpenPromise = null;
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
});
