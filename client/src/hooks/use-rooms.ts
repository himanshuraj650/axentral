import { useQuery, useMutation } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";

export function useCreateRoom() {
  return useMutation({
    mutationFn: async (id?: string) => {
      const res = await fetch(api.rooms.create.path, {
        method: api.rooms.create.method,
        headers: { "Content-Type": "application/json" },
        body: id ? JSON.stringify({ id }) : undefined,
      });
      
      if (!res.ok) {
        throw new Error("Failed to create room");
      }
      return api.rooms.create.responses[201].parse(await res.json());
    },
  });
}

export function useRoom(id: string | null) {
  return useQuery({
    queryKey: [api.rooms.get.path, id],
    queryFn: async () => {
      if (!id) return null;
      const url = buildUrl(api.rooms.get.path, { id });
      const res = await fetch(url);
      
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch room");
      
      return api.rooms.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
    retry: false,
  });
}
