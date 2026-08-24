import carteleraStatic from "../../../cartelera.json";
import { CINES } from "./seed";
import type { Cine } from "./types";

const cache = new Map<string, { at: number; cines: Cine[] }>();
const TTL_MS = 8 * 60 * 1000;

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

const STATIC_CINES = carteleraStatic as StaticCine[];

export async function fetchCartelera(date: string): Promise<Cine[]> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cines;
  const cines = CINES.map((c) => getStaticCine(c));
  cache.set(date, { at: Date.now(), cines });
  return cines;
}

function getStaticCine(seed: (typeof CINES)[number]): Cine {
  const staticCine = STATIC_CINES.find((c) => c.slug === seed.slug);
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
        ...pickPrices(funcion),
      })),
    })),
  };
}

function pickPrices(funcion: StaticFuncion) {
  return {
    precio_general: funcion.precio_general,
    precio_jubilado: funcion.precio_jubilado,
    precio_menor: funcion.precio_menor,
  };
}
