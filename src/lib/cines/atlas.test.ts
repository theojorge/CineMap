import { describe, it, expect } from "vitest";
import { armarDfAtlas, parseAtlasTickets, parseAtlasSeats, esCineAtlas } from "./atlas";

const CARRITO_HTML = `
<div class="v2-ticket-list">
  <div class="v2-tcat " data-price="10200,0" data-name="MITAD PRECIO 2D WEB" data-id="24" data-zone="1" data-counttickets="1" data-promo="False" data-promoval="True" data-maxsell="0" data-membership="false" data-loyalty="false" data-pointscost="0">
    <div class="v2-tcat-info">...</div>
  </div>
  <div class="v2-tcat " data-price="18000,0" data-name="ENTRADA GENERAL 2D WEB" data-id="25" data-zone="1" data-counttickets="1" data-promo="False" data-promoval="True">
    <div class="v2-tcat-info">...</div>
  </div>
</div>
`;

const SELECTSEATS_HTML = `
<div class="v2-seat-card">
  <div class="v2-seat-inner">
    <div class="v2-seat-row">
      <div class="v2-row-label">K</div>
      <div class="v2-seat-row-cells">
        <div class="v2-seat"
             title="K-1"
             data-seat-id="K-1"
             data-zone="1"
             data-seat-type="0"
             data-seat-status="available"
             data-row="0"
             data-x="182">
          <div class="v2-seat-back"></div>
        </div>
        <div class="v2-seat"
             title="K-2"
             data-seat-id="K-2"
             data-zone="1"
             data-seat-type="0"
             data-seat-status="sold"
             data-row="0"
             data-x="217">
          <div class="v2-seat-back"></div>
        </div>
      </div>
    </div>
    <div class="v2-seat-row">
      <div class="v2-row-label">G</div>
      <div class="v2-seat-row-cells">
        <div class="v2-seat"
             title="G-8"
             data-seat-id="G-8"
             data-zone="1"
             data-seat-type="0"
             data-seat-status="available"
             data-row="4"
             data-x="508">
          <div class="v2-seat-back"></div>
        </div>
        <div class="v2-seat reserved"
             title="G-9"
             data-seat-id="G-9"
             data-zone="1"
             data-seat-type="0"
             data-seat-status="sold"
             data-row="4"
             data-x="543">
          <div class="v2-seat-back"></div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

describe("armarDfAtlas", () => {
  it("arma el df con el formato codComp-AAAAMMDD-codPelicula-codFuncion-codTecnologia", () => {
    expect(
      armarDfAtlas({
        codComplejo: 191,
        fecha: "2026-09-23",
        codPelicula: 569,
        codFuncion: 23307,
        codTecnologia: 1,
      }),
    ).toBe("191-20260923-569-23307-1");
  });
});

describe("esCineAtlas", () => {
  it("reconoce la cadena Atlas Cines", () => {
    expect(esCineAtlas("Atlas Cines")).toBe(true);
  });

  it("rechaza otras cadenas", () => {
    expect(esCineAtlas("Multiplex")).toBe(false);
    expect(esCineAtlas("Cinemark Hoyts")).toBe(false);
  });
});

describe("parseAtlasTickets", () => {
  it("devuelve la primera tarjeta v2-tcat con sus datos de compra", () => {
    const ticket = parseAtlasTickets(CARRITO_HTML);
    expect(ticket).toEqual({
      id: "24",
      zone: "1",
      isPromo: "False",
      isPromoValidated: "True",
    });
  });

  it("devuelve null cuando no hay tarjetas v2-tcat", () => {
    expect(parseAtlasTickets("<html><body>sin tarjetas</body></html>")).toBeNull();
  });
});

describe("parseAtlasSeats", () => {
  it("convierte los asientos del HTML en Butaca[] con coordenadas", () => {
    const seats = parseAtlasSeats(SELECTSEATS_HTML)!;
    expect(seats).toHaveLength(4);
    const k1 = seats.find((s) => s.Nombre === "K-1");
    expect(k1).toMatchObject({
      X: "182",
      Y: "0",
      Disponible: "available",
      Nombre: "K-1",
      Id: "K-1",
    });
    const g9 = seats.find((s) => s.Nombre === "G-9");
    expect(g9).toMatchObject({ X: "543", Y: "4", Disponible: "sold" });
  });

  it("nombra la zona como Sala N cuando la zona es numérica", () => {
    const seats = parseAtlasSeats(SELECTSEATS_HTML)!;
    expect(seats[0].Zona).toBe("1");
    expect(seats[0].NombreZona).toBe("Sala 1");
  });

  it("devuelve null cuando no hay asientos v2-seat", () => {
    expect(parseAtlasSeats("<html><body>sin mapa</body></html>")).toBeNull();
  });
});
