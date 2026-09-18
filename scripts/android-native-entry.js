import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';

window.__FINPET_ANDROID__ = true;

window.FINPET_NATIVE_STORAGE = {
  async get(key) { const { value } = await Preferences.get({ key }); return value; },
  async set(key, value) { await Preferences.set({ key, value: String(value) }); },
  async remove(key) { await Preferences.remove({ key }); }
};

App.addListener('backButton', () => {
  let handled = false;
  try { handled = window.FINPET_HANDLE_ANDROID_BACK?.() === true; }
  catch (err) { console.warn('[KopiHvost back]', err); }
  if (!handled) App.exitApp();
});
