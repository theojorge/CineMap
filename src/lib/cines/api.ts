import { CINES } from "./seed";
import type { Cine } from "./types";

type StaticFuncion = {
  horario: string;
  formato: string;
  precio_general?: number;
  precio_jubilado?: number;
  precio_menor?: number;
};

type StaticPelicula = {
  titulo: string;
  url: string;
  imagen?: string;
  funciones: StaticFuncion[];
};

type StaticCine = {
  slug: string;
  peliculas: StaticPelicula[];
};

export async function listCines() {
  return CINES;
}

export async function getCartelera(date: string): Promise<Cine[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Fecha inválida");
  }

  const response = await fetch(`/cartelera/${date}.json`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return CINES.map((seed) => ({ ...seed, peliculas: [] }));
  }

  const carteleraStatic = (await response.json()) as StaticCine[];
  const bySlug = new Map(carteleraStatic.map((cine) => [cine.slug, cine]));

  return CINES.map((seed) => {
    const staticCine = bySlug.get(seed.slug);
    if (!staticCine) return { ...seed, peliculas: [] };

    return {
      ...seed,
      peliculas: staticCine.peliculas.map((pelicula) => ({
        titulo: pelicula.titulo,
        url: pelicula.url,
        imagen: pelicula.imagen,
        funciones: pelicula.funciones.map((funcion) => ({
          horario: funcion.horario,
          formato: funcion.formato,
          compraUrl: seed.sitioWeb,
          precio_general: funcion.precio_general,
          precio_jubilado: funcion.precio_jubilado,
          precio_menor: funcion.precio_menor,
        })),
      })),
    };
  });
}
