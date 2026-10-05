import { describe, expect, test } from "vitest";
import { compraUrlParaFuncion } from "./compra-url";

describe("compraUrlParaFuncion", () => {
  test("Multiplex con df enlaza a la función exacta en ventas", () => {
    expect(
      compraUrlParaFuncion(
        "Multiplex",
        { df: "187-211-9608-20261006" },
        "https://www.multiplex.com.ar",
      ),
    ).toBe("https://ventas.cinemultiplex.com.ar/funcion?df=187-211-9608-20261006");
  });

  test("Multiplex sin df usa el sitio del cine", () => {
    expect(compraUrlParaFuncion("Multiplex", {}, "https://www.multiplex.com.ar")).toBe(
      "https://www.multiplex.com.ar",
    );
  });

  test("Atlas con df enlaza al carrito de esa función", () => {
    expect(
      compraUrlParaFuncion(
        "Atlas Cines",
        { df: "191-20261006-586-23798-1" },
        "https://www.atlascines.com/",
      ),
    ).toBe("https://www.atlascines.com/carrito?df=191-20261006-586-23798-1");
  });

  test("Atlas sin df usa el sitio del cine", () => {
    expect(compraUrlParaFuncion("Atlas Cines", {}, "https://www.atlascines.com/")).toBe(
      "https://www.atlascines.com/",
    );
  });

  test("otras cadenas usan el sitio del cine", () => {
    expect(
      compraUrlParaFuncion(
        "Cinemark Hoyts",
        { df: "x" },
        "https://www.cinemark.com.ar/cartelera/abasto",
      ),
    ).toBe("https://www.cinemark.com.ar/cartelera/abasto");
    expect(
      compraUrlParaFuncion("Showcase", {}, "https://www.todoshowcase.com/cine/6/belgrano"),
    ).toBe("https://www.todoshowcase.com/cine/6/belgrano");
  });
});
