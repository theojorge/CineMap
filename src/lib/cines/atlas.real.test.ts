import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAtlasSeats, parseAtlasTickets } from "./atlas";

const here = dirname(fileURLToPath(import.meta.url));

describe("fixtures reales de atlascines.com", () => {
  it("parsea los 162 asientos del HTML real de SelectSeats", () => {
    const html = readFileSync(join(here, "__fixtures__", "atlas-selectseats.html"), "utf8");
    const seats = parseAtlasSeats(html);
    expect(seats).not.toBeNull();
    expect(seats!.length).toBe(162);
    const by: Record<string, number> = {};
    seats!.forEach((s) => (by[s.Disponible] = (by[s.Disponible] || 0) + 1));
    expect(by).toMatchObject({ available: 160, sold: 2 });
    const g9 = seats!.find((s) => s.Nombre === "G-9");
    expect(g9).toMatchObject({ X: "543", Y: "4", Disponible: "sold" });
  });

  it("parsea la tarjeta v2-tcat del carrito real", () => {
    const html = readFileSync(join(here, "__fixtures__", "atlas-carrito.html"), "utf8");
    expect(parseAtlasTickets(html)).toMatchObject({
      id: "24",
      zone: "1",
      isPromo: "False",
      isPromoValidated: "True",
    });
  });
});
