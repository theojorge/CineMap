import { describe, expect, test } from "vitest";
import { crearSeleccionFuncion } from "./seleccion-funcion";
import type { Funcion } from "./types";

function funcion(): Funcion {
  return {
    horario: "20:40",
    formato: "2D Subtitulada",
    compraUrl: "https://www.multiplex.com.ar",
    df: "187-211-9608-20261006",
  };
}

describe("crearSeleccionFuncion", () => {
  test("conserva el movieUrl para el fallback de butacas", () => {
    const sel = crearSeleccionFuncion(
      "multiplex-belgrano",
      "Avengers: Endgame",
      funcion(),
      "/posters/x.jpg",
      "https://www.multiplex.com.ar/peliculas/avengers-endgame-re-estreno/",
    );
    expect(sel).toEqual({
      cineSlug: "multiplex-belgrano",
      movieTitle: "Avengers: Endgame",
      funcion: funcion(),
      movieImage: "/posters/x.jpg",
      movieUrl: "https://www.multiplex.com.ar/peliculas/avengers-endgame-re-estreno/",
    });
  });

  test("movieUrl ausente queda como undefined", () => {
    const sel = crearSeleccionFuncion("multiplex-belgrano", "Avengers: Endgame", funcion());
    expect(sel.movieUrl).toBeUndefined();
    expect(sel.cineSlug).toBe("multiplex-belgrano");
  });
});
