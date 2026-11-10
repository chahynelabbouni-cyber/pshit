// Stockage local (IndexedDB) : toute la musique reste sur le téléphone.
const DB_NAME = 'onde';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
  });
}

export const db = {
  async all(store) {
    const d = await open();
    return wrap(d.transaction(store).objectStore(store).getAll());
  },
  async get(store, key) {
    const d = await open();
    return wrap(d.transaction(store).objectStore(store).get(key));
  },
  async put(store, value, key) {
    return tx([store], 'readwrite', t => { t.objectStore(store).put(value, key); });
  },
  async del(store, key) {
    return tx([store], 'readwrite', t => { t.objectStore(store).delete(key); });
  },
  async addTrack(track, audioBlob, coverBlob) {
    return tx(['tracks', 'audio', 'covers'], 'readwrite', t => {
      t.objectStore('tracks').put(track);
      t.objectStore('audio').put(audioBlob, track.id);
      if (coverBlob) t.objectStore('covers').put(coverBlob, track.coverId);
    });
  },
  async hasCover(id) {
    const d = await open();
    const k = await wrap(d.transaction('covers').objectStore('covers').getKey(id));
    return k !== undefined;
  },
  async clear() {
    return tx(['tracks', 'audio', 'covers', 'playlists'], 'readwrite', t => {
      for (const s of ['tracks', 'audio', 'covers', 'playlists']) t.objectStore(s).clear();
    });
  },
};
