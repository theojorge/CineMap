import type { Funcion } from "./types";

export type SeleccionFuncion = {
  cineSlug: string;
  movieTitle: string;
  funcion: Funcion;
  movieImage?: string;
  movieUrl?: string;
};

/**
 * Arma la selección de función que abre el popup. El `movieUrl` es
 * necesario para el fallback de butacas de Multiplex (scrapeo de la
 * página de la película cuando la función no trae `df`).
 */
export function crearSeleccionFuncion(
  cineSlug: string,
  movieTitle: string,
  funcion: Funcion,
  movieImage?: string,
  movieUrl?: string,
): SeleccionFuncion {
  return { cineSlug, movieTitle, funcion, movieImage, movieUrl };
}
