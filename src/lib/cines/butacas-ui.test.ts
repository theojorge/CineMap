import { describe, expect, test } from "vitest";
import { planearButacas } from "./butacas-ui";
import type { Funcion } from "./types";

function funcion(partial: Partial<Funcion> = {}): Funcion {
  return {
    horario: "20:40",
    formato: "2D Subtitulada",
    compraUrl: "https://www.cinemark.com.ar/",
    ...partial,
  };
}

describe("planearButacas", () => {
  test("Cinemark con payload cinemark usa el flujo cinemark", () => {
    const plan = planearButacas(
      "Cinemark Hoyts",
      funcion({
        cinemark: JSON.stringify({ cinemaId: 733, sessionId: 164063, corporateFilmId: "112892" }),
      }),
    );
    expect(plan.disponible).toBe(true);
    if (plan.disponible) {
      expect(plan.tipo).toBe("cinemark");
      expect(plan.key).toEqual(["butacas", "cinemark", "164063"]);
      expect(plan.payload).toEqual({ cinemaId: 733, sessionId: 164063, corporateFilmId: "112892" });
    }
  });

  test("Cinemark sin payload no ofrece butacas", () => {
    expect(planearButacas("Cinemark Hoyts", funcion()).disponible).toBe(false);
  });

  test("Atlas con df usa el flujo atlas", () => {
    const plan = planearButacas("Atlas Cines", funcion({ df: "191-20260926-569-23305-1" }));
    expect(plan.disponible).toBe(true);
    if (plan.disponible) {
      expect(plan.tipo).toBe("atlas");
      expect(plan.payload).toEqual({ df: "191-20260926-569-23305-1" });
    }
  });

  test("Atlas sin df no ofrece butacas", () => {
    expect(planearButacas("Atlas Cines", funcion()).disponible).toBe(false);
  });

  test("Multiplex ofrece butacas aunque no tenga df (fallback por película)", () => {
    const plan = planearButacas(
      "Multiplex",
      funcion(),
      "https://www.multiplex.com.ar/pelicula/ejemplo",
    );
    expect(plan.disponible).toBe(true);
    if (plan.disponible && plan.tipo === "multiplex") {
      expect(plan.payload.peliculaUrl).toBe("https://www.multiplex.com.ar/pelicula/ejemplo");
    }
  });

  test("cadenas sin soporte (Cinepólis, Showcase) no ofrecen butacas", () => {
    expect(planearButacas("Cinépolis", funcion()).disponible).toBe(false);
    expect(planearButacas("Showcase", funcion()).disponible).toBe(false);
    expect(planearButacas("Cine Independiente", funcion()).disponible).toBe(false);
  });
});
