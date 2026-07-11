import { create } from "zustand";

import { storage } from "@/src/utils/storage";

export type User = {
  id: string;
  email: string;
  name: string;
  created_at?: string;
  settings?: any;
};

const TOKEN_KEY = "wanstudio.token";
const USER_KEY = "wanstudio.user";

type AuthStore = {
  token: string | null;
  user: User | null;
  status: "idle" | "authed" | "guest";
  signIn: (token: string, user: User) => Promise<void>;
  setUser: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set) => ({
  token: null,
  user: null,
  status: "idle",
  signIn: async (token, user) => {
    await storage.secureSet(TOKEN_KEY, token);
    await storage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user, status: "authed" });
  },
  setUser: async (user) => {
    await storage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },
  signOut: async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(USER_KEY);
    set({ token: null, user: null, status: "guest" });
  },
  hydrate: async () => {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    const rawUser = await storage.getItem<string>(USER_KEY, "");
    if (token) {
      let user: User | null = null;
      try {
        user = rawUser ? JSON.parse(rawUser) : null;
      } catch {
        user = null;
      }
      set({ token, user, status: "authed" });
    } else {
      set({ status: "guest" });
    }
  },
}));

export function getToken(): string | null {
  return useAuthStore.getState().token;
}
