(() => {
  const DEFAULT_KEY = 'finpet_mvp_state_v1';
  const BACKUP_SUFFIX = '_backup';
  let writeQueue = Promise.resolve();

  function isValidRaw(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    try {
      const parsed = JSON.parse(raw);
      return !!(parsed && typeof parsed === 'object' && parsed.wallet && parsed.pet);
    } catch (_) { return false; }
  }

  function nativeStore() { return window.FINPET_NATIVE_STORAGE || null; }
  function enqueue(task) {
    writeQueue = writeQueue.then(task, task).catch(err => console.warn('[KopiHvost storage]', err));
    return writeQueue;
  }

  async function ready(key = DEFAULT_KEY) {
    const native = nativeStore();
    if (!native) return { source: 'web' };
    const backupKey = key + BACKUP_SUFFIX;
    let current = null, backup = null;
    try { [current, backup] = await Promise.all([native.get(key), native.get(backupKey)]); }
    catch (err) { console.warn('[KopiHvost storage] native read failed', err); return { source: 'local-fallback' }; }
    const local = localStorage.getItem(key);
    if (isValidRaw(current)) {
      localStorage.setItem(key, current);
      if (isValidRaw(backup)) localStorage.setItem(backupKey, backup);
      return { source: 'native' };
    }
    if (isValidRaw(backup)) {
      localStorage.setItem(key, backup);
      localStorage.setItem(backupKey, backup);
      await native.set(key, backup);
      return { source: 'native-backup' };
    }
    if (isValidRaw(local)) {
      await native.set(key, local);
      await native.set(backupKey, local);
      localStorage.setItem(backupKey, local);
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
    const backupKey = key + BACKUP_SUFFIX;
    const previous = localStorage.getItem(key);
    if (isValidRaw(previous) && previous !== raw) localStorage.setItem(backupKey, previous);
    localStorage.setItem(key, raw);
    const native = nativeStore();
    if (!native) return Promise.resolve(true);
    return enqueue(async () => {
      if (isValidRaw(previous) && previous !== raw) await native.set(backupKey, previous);
      await native.set(key, raw);
      return true;
    });
  }

  function remove(key = DEFAULT_KEY) {
    const backupKey = key + BACKUP_SUFFIX;
    localStorage.removeItem(key); localStorage.removeItem(backupKey);
    const native = nativeStore();
    if (!native) return Promise.resolve(true);
    return enqueue(async () => { await native.remove(key); await native.remove(backupKey); return true; });
  }

  function flush() { return writeQueue; }
  window.FINPET_STORAGE = { ready, loadSync, saveState, remove, flush, isValidRaw };
})();
