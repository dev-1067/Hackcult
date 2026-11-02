import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Meta, Site } from "./types";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta"), staleTime: 5 * 60_000 });
}

export function useSites() {
  return useQuery({
    queryKey: ["sites"],
    queryFn: () => api.get<{ total: number; items: Site[] }>("/sites"),
    staleTime: 60_000,
  });
}

export function languageLabel(meta: Meta | undefined, code: string) {
  return meta?.languages.find((l) => l.code === code)?.label ?? code;
}

export function scriptLabel(meta: Meta | undefined, id: string) {
  return meta?.scripts.find((s) => s.id === id)?.label.split(" (")[0] ?? id;
}
