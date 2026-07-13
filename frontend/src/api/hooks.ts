import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

// ---------------------------------------------------------------- types
export type Model = {
  model_id: string;
  name: string;
  description: string;
  speed: string;
  quality: string;
  use_case: string;
  supported_settings: string[];
  badge: string;
  est_seconds: number;
};

export type GenStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type Generation = {
  id: string;
  prompt: string;
  negative_prompt: string;
  model: string;
  model_name: string;
  image_base64: string;
  thumbnail_base64: string;
  settings: Record<string, any>;
  status: GenStatus;
  progress: number;
  stage: string;
  video_url: string | null;
  error: string | null;
  is_favourite: boolean;
  est_seconds: number;
  created_at: string;
  updated_at: string;
};

export type Prompt = {
  id: string;
  text: string;
  negative_prompt: string;
  is_favourite: boolean;
  created_at: string;
};

export type GenFilters = {
  search?: string;
  model?: string;
  favourite?: boolean;
  sort?: "date" | "model";
};

// ---------------------------------------------------------------- models
export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: async () => (await api.get<Model[]>("/models")).data,
    staleTime: 1000 * 60 * 10,
  });
}

// ------------------------------------------------------- provider (AI engine)
export type ProviderConfig = {
  mode: "live" | "mock";
  has_key: boolean;
  key_source: "stored" | "env" | null;
  key_masked: string | null;
};

export function useProviderConfig() {
  return useQuery({
    queryKey: ["provider-config"],
    queryFn: async () =>
      (await api.get<ProviderConfig>("/settings/provider")).data,
    staleTime: 1000 * 30,
  });
}

export function useSetProviderKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fal_api_key: string) =>
      (await api.put<ProviderConfig>("/settings/provider", { fal_api_key })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["provider-config"] }),
  });
}

// ------------------------------------------------------------ generations
export function useGenerations(filters: GenFilters = {}, poll = false, enabled = true) {
  return useQuery({
    queryKey: ["generations", filters],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<Generation[]>("/generations", {
        params: {
          search: filters.search || "",
          model: filters.model || "",
          favourite: filters.favourite ? true : false,
          sort: filters.sort || "date",
        },
      });
      return data;
    },
    refetchInterval: (query) => {
      if (!poll) return false;
      const d = query.state.data as Generation[] | undefined;
      const active = d?.some((g) => g.status === "queued" || g.status === "processing");
      return active ? 1500 : false;
    },
  });
}

export function useGeneration(id: string | undefined, poll = false) {
  return useQuery({
    queryKey: ["generation", id],
    enabled: !!id,
    queryFn: async () => (await api.get<Generation>(`/generations/${id}`)).data,
    refetchInterval: (query) => {
      const d = query.state.data as Generation | undefined;
      if (poll && d && (d.status === "queued" || d.status === "processing")) {
        return 1200;
      }
      return false;
    },
  });
}

export function useCreateGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      prompt: string;
      negative_prompt: string;
      model: string;
      image_base64: string;
      settings: Record<string, any>;
    }) => (await api.post<Generation>("/generations", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generations"] }),
  });
}

function useGenAction(path: (id: string) => string, method: "post" | "delete") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const url = path(id);
      return method === "post"
        ? (await api.post(url)).data
        : (await api.delete(url)).data;
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["generation", id] });
    },
  });
}

export const useCancelGeneration = () =>
  useGenAction((id) => `/generations/${id}/cancel`, "post");
export const useRetryGeneration = () =>
  useGenAction((id) => `/generations/${id}/retry`, "post");
export const useDuplicateGeneration = () =>
  useGenAction((id) => `/generations/${id}/duplicate`, "post");
export const useToggleGenerationFav = () =>
  useGenAction((id) => `/generations/${id}/favourite`, "post");
export const useDeleteGeneration = () =>
  useGenAction((id) => `/generations/${id}`, "delete");

// -------------------------------------------------------------- prompts
export function usePrompts(favourite = false) {
  return useQuery({
    queryKey: ["prompts", favourite],
    queryFn: async () =>
      (await api.get<Prompt[]>("/prompts", { params: { favourite } })).data,
  });
}

export function useSavePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      text: string;
      negative_prompt: string;
      is_favourite: boolean;
    }) => (await api.post<Prompt>("/prompts", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
  });
}

export function useTogglePromptFav() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.put(`/prompts/${id}/favourite`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
  });
}

export function useDeletePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/prompts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
  });
}

// ------------------------------------------------------------------ studio
export type GpuState = "unconfigured" | "off" | "starting" | "ready" | "error" | "unknown";

export type GpuStatus = {
  state: GpuState;
  public_ip: string | null;
  gpu_name?: string;
  dph_total?: number;
  error?: string;
};

export type StudioGeneration = {
  id: string;
  prompt: string;
  negative_prompt: string;
  status: GenStatus;
  progress: number;
  stage: string;
  video_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioConfig = {
  configured: boolean;
  vastai_api_key: string;
  instance_id: string;
  gpu_port: number;
};

export type VastaiAccount = {
  balance: number;
  username: string;
  email: string;
};

export function useVastaiAccount(enabled = true) {
  return useQuery({
    queryKey: ["vastai-account"],
    enabled,
    queryFn: async () => (await api.get<VastaiAccount>("/studio/account")).data,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60, // refresh balance every minute while screen is open
  });
}

export function useGpuStatus(poll = false) {
  return useQuery({
    queryKey: ["gpu-status"],
    queryFn: async () => (await api.get<GpuStatus>("/studio/gpu/status")).data,
    refetchInterval: poll ? 5000 : false,
    staleTime: 4000,
  });
}

export function useGpuStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post("/studio/gpu/start")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gpu-status"] }),
  });
}

export function useGpuStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post("/studio/gpu/stop")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gpu-status"] }),
  });
}

export function useStudioConfig() {
  return useQuery({
    queryKey: ["studio-config"],
    queryFn: async () => (await api.get<StudioConfig>("/studio/config")).data,
    staleTime: 1000 * 60,
  });
}

export function useSetStudioConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { vastai_api_key?: string; instance_id?: string; gpu_port?: number }) =>
      (await api.put("/studio/config", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studio-config"] });
      qc.invalidateQueries({ queryKey: ["gpu-status"] });
    },
  });
}

export function useCreateStudioGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      prompt: string;
      negative_prompt: string;
      image_base64: string;
      settings: Record<string, any>;
    }) => (await api.post<StudioGeneration>("/studio/generate", payload)).data,
    onSuccess: () => {
      // Studio jobs are also merged into the main gallery (["generations"]),
      // so invalidate both — otherwise the gallery never refetches and the new
      // processing job stays invisible until a manual refresh.
      qc.invalidateQueries({ queryKey: ["studio-generations"] });
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export function useStudioGenerations() {
  return useQuery({
    queryKey: ["studio-generations"],
    queryFn: async () => (await api.get<StudioGeneration[]>("/studio/generations")).data,
    refetchInterval: (query) => {
      const d = query.state.data as StudioGeneration[] | undefined;
      const active = d?.some((g) => g.status === "queued" || g.status === "processing");
      return active ? 2000 : false;
    },
  });
}

export function useStudioGeneration(id: string | undefined) {
  return useQuery({
    queryKey: ["studio-generation", id],
    enabled: !!id,
    queryFn: async () => (await api.get<StudioGeneration>(`/studio/generations/${id}`)).data,
    refetchInterval: (query) => {
      const d = query.state.data as StudioGeneration | undefined;
      if (d && (d.status === "queued" || d.status === "processing")) return 2000;
      return false;
    },
  });
}
