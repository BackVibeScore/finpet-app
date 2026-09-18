(() => {
  const DEFAULT_KEY = 'finpet_mvp_state_v1';
  const BACKUP_SUFFIX = '_backup';
  const META_SUFFIX = '_meta';
  let writeQueue = Promise.resolve();

  function isValidRaw(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    try {
      const parsed = JSON.parse(raw);
      return !!(parsed && typeof parsed === 'object' && parsed.wallet && parsed.pet);
    } catch (_) { return false; }
  }
  function revision(raw) { const n=Number(raw); return Number.isFinite(n)&&n>0?n:0; }
  function nextRevision(key) {
    const prev=revision(localStorage.getItem(key+META_SUFFIX));
    return Math.max(Date.now(),prev+1);
  }

  function nativeStore() { return window.FINPET_NATIVE_STORAGE || null; }
  function enqueue(task) {
    writeQueue = writeQueue.then(task, task).catch(err => console.warn('[KopiHvost storage]', err));
    return writeQueue;
  }

  async function ready(key = DEFAULT_KEY) {
    const native = nativeStore();
    if (!native) return { source: 'web' };
    const backupKey = key + BACKUP_SUFFIX, metaKey = key + META_SUFFIX;
    let current = null, backup = null, nativeMeta = 0;
    try {
      const values = await Promise.all([native.get(key), native.get(backupKey), native.get(metaKey)]);
      current=values[0]; backup=values[1]; nativeMeta=revision(values[2]);
    } catch (err) {
      console.warn('[KopiHvost storage] native read failed', err);
      return { source: 'local-fallback' };
    }
    const local = localStorage.getItem(key);
    const localMeta = revision(localStorage.getItem(metaKey));

    // localStorage is updated synchronously, so after a hard kill it may be one write
    // ahead of Preferences. A monotonic sidecar revision prevents losing that last save.
    if (isValidRaw(local) && localMeta > nativeMeta) {
      if (isValidRaw(current) && current !== local) {
        await native.set(backupKey, current);
        localStorage.setItem(backupKey, current);
      }
      await native.set(key, local);
      await native.set(metaKey, String(localMeta));
      return { source: 'local-newer' };
    }

    if (isValidRaw(current)) {
      localStorage.setItem(key, current);
      if (nativeMeta) localStorage.setItem(metaKey, String(nativeMeta));
      if (isValidRaw(backup)) localStorage.setItem(backupKey, backup);
      return { source: 'native' };
    }
    if (isValidRaw(backup)) {
      const rev=Math.max(nativeMeta,localMeta,Date.now());
      localStorage.setItem(key, backup);
      localStorage.setItem(backupKey, backup);
      localStorage.setItem(metaKey,String(rev));
      await native.set(key, backup);
      await native.set(metaKey,String(rev));
      return { source: 'native-backup' };
    }
    if (isValidRaw(local)) {
      const rev=localMeta||Date.now();
      await native.set(key, local);
      await native.set(backupKey, local);
      await native.set(metaKey,String(rev));
      localStorage.setItem(backupKey, local);
      localStorage.setItem(metaKey,String(rev));
      return { source: 'local-migrated' };
    }
    return { source: 'empty' };
  }

  function loadSync(key = DEFAULT_KEY) {
    let raw = localStorage.getItem(key);
    if (!isValidRaw(raw)) {
      const backup = localStorage.getItem(key + BACKUP_SUFFIX);
      if (!isValidRaw(backup)) return null;
      localStorage.setItem(key, backup); raw = backup;
    }
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function saveState(key = DEFAULT_KEY, value) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (!isValidRaw(raw)) return Promise.resolve(false);
    const backupKey = key + BACKUP_SUFFIX, metaKey = key + META_SUFFIX;
    const previous = localStorage.getItem(key);
    if (previous === raw) return Promise.resolve(true);
    const rev=nextRevision(key);
    if (isValidRaw(previous)) localStorage.setItem(backupKey, previous);
    localStorage.setItem(key, raw);
    localStorage.setItem(metaKey,String(rev));
    const native = nativeStore();
    if (!native) return Promise.resolve(true);
    return enqueue(async () => {
      if (isValidRaw(previous)) await native.set(backupKey, previous);
      await native.set(key, raw);
      await native.set(metaKey,String(rev));
      return true;
    });
  }

  function remove(key = DEFAULT_KEY) {
    const backupKey = key + BACKUP_SUFFIX, metaKey = key + META_SUFFIX;
    localStorage.removeItem(key); localStorage.removeItem(backupKey); localStorage.removeItem(metaKey);
    const native = nativeStore();
    if (!native) return Promise.resolve(true);
    return enqueue(async () => {
      await native.remove(key); await native.remove(backupKey); await native.remove(metaKey); return true;
    });
  }

  function flush() { return writeQueue; }
  window.FINPET_STORAGE = { ready, loadSync, saveState, remove, flush, isValidRaw };
})();
