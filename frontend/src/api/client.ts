import axios from "axios";

import { getToken, useAuthStore } from "@/src/store/auth";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const api = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      const status = useAuthStore.getState().status;
      if (status === "authed") {
        useAuthStore.getState().signOut();
      }
    }
    return Promise.reject(error);
  },
);

export function apiError(e: any, fallback = "Something went wrong"): string {
  return e?.response?.data?.detail || e?.message || fallback;
}
