// Chunks on their way to disk, kept somewhere a Chrome crash cannot reach.
// Cleared the moment the download completes, so a stored session always means
// "this recording never made it out".

const DB_NAME = 'meet-recorder';
const STORE = 'chunks';
const META = 'meta';

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(store, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result ?? null);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function beginSession(meta) {
  await clearSession();
  await run(META, 'readwrite', (store) => store.put(meta, 'session'));
}

export const appendChunk = (blob) => run(STORE, 'readwrite', (store) => store.add(blob));

export async function readSession() {
  const meta = await run(META, 'readonly', (store) => store.get('session'));
  if (!meta) return null;
  const chunks = await run(STORE, 'readonly', (store) => store.getAll());
  return { meta, chunks: chunks ?? [] };
}

/** How many chunks are stored, without loading a byte of audio. */
export const countChunks = () => run(STORE, 'readonly', (store) => store.count());

export const readMeta = () => run(META, 'readonly', (store) => store.get('session'));

export async function clearSession() {
  await run(STORE, 'readwrite', (store) => store.clear());
  await run(META, 'readwrite', (store) => store.clear());
}
