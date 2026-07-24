import { create } from "zustand";

import { storage } from "@/src/utils/storage";

// Local app-entry PIN lock. Biometrics (Face/fingerprint) need a native module
// and a fresh build; this is the JS-only, OTA-shippable equivalent. The PIN is
// held in the OS secure store (Keychain / EncryptedSharedPreferences).
//
// Fail-open by design: if no PIN is set — or anything errors — `locked` stays
// false so the app is never accidentally bricked behind the lock.
const PIN_KEY = "app_lock_pin";

type LockState = {
  hasPin: boolean;
  locked: boolean;
  hydrate: () => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
};

export const useLockStore = create<LockState>((set, get) => ({
  hasPin: false,
  locked: false,

  hydrate: async () => {
    const pin = await storage.secureGet(PIN_KEY, "");
    const has = typeof pin === "string" && pin.length > 0;
    set({ hasPin: has, locked: has }); // lock immediately on launch if a PIN exists
  },

  setPin: async (pin) => {
    const ok = await storage.secureSet(PIN_KEY, pin);
    if (ok) set({ hasPin: true, locked: false });
  },

  clearPin: async () => {
    await storage.secureRemove(PIN_KEY);
    set({ hasPin: false, locked: false });
  },

  unlock: async (pin) => {
    const stored = await storage.secureGet(PIN_KEY, "");
    if (typeof stored === "string" && stored.length > 0 && stored === pin) {
      set({ locked: false });
      return true;
    }
    return false;
  },

  lock: () => {
    if (get().hasPin) set({ locked: true });
  },
}));
