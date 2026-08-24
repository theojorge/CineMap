import { createServerFn } from "@tanstack/react-start";
import { CINES } from "./seed";
import type { Cine } from "./types";

export const listCines = createServerFn({ method: "GET" }).handler(async () => {
  return CINES;
});

export const getCartelera = createServerFn({ method: "GET" })
  .validator((data: { date: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw new Error("Fecha inválida");
    }
    return data;
  })
  .handler(async ({ data }): Promise<Cine[]> => {
    const { fetchCartelera } = await import("./scrape.server");
    return fetchCartelera(data.date);
  });
