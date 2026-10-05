import { describe, expect, test } from "vitest";
import {
  elegirEntradaGeneral,
  esCineCinemark,
  mapearAsientosCinemark,
  parseDatosFuncionCinemark,
} from "./cinemark";

describe("esCineCinemark", () => {
  test("reconoce la cadena del seed de Cinemark Hoyts", () => {
    expect(esCineCinemark("Cinemark Hoyts")).toBe(true);
    expect(esCineCinemark("CINEMARK HOYTS")).toBe(true);
    expect(esCineCinemark("Multiplex")).toBe(false);
  });
});

describe("parseDatosFuncionCinemark", () => {
  test("parsea el payload JSON del campo cinemark de la función", () => {
    const datos = parseDatosFuncionCinemark(
      JSON.stringify({ cinemaId: 733, sessionId: 164063, feature: 0, corporateFilmId: "112892" }),
    );
    expect(datos).toEqual({
      cinemaId: 733,
      sessionId: 164063,
      feature: 0,
      corporateFilmId: "112892",
    });
  });

  test("acepta payload mínimo sin feature ni película", () => {
    const datos = parseDatosFuncionCinemark(JSON.stringify({ cinemaId: 733, sessionId: 164063 }));
    expect(datos).toEqual({
      cinemaId: 733,
      sessionId: 164063,
      feature: undefined,
      corporateFilmId: undefined,
    });
  });

  test("devuelve null si el payload es inválido o falta", () => {
    expect(parseDatosFuncionCinemark(null)).toBeNull();
    expect(parseDatosFuncionCinemark("")).toBeNull();
    expect(parseDatosFuncionCinemark("no-json")).toBeNull();
    expect(parseDatosFuncionCinemark(JSON.stringify({ sessionId: 1 }))).toBeNull();
  });
});

describe("elegirEntradaGeneral", () => {
  test("elije la entrada GENERAL (hoCode 1000) con precio y comisión", () => {
    const precios = [
      {
        categoryId: 14,
        title: "SUMATE A CINEMARK CLUB",
        tickets: [
          {
            hoCode: "1667",
            buyOptions: [{ value: 2000000, valueWithoutTax: 1526700, service: 210000 }],
          },
        ],
      },
      {
        categoryId: 1,
        title: "GENERAL",
        tickets: [
          {
            hoCode: "1000",
            title: "Miércoles 50% Off",
            buyOptions: [{ value: 1000000, valueWithoutTax: 763300, service: 105000 }],
          },
        ],
      },
    ];

    const entrada = elegirEntradaGeneral(precios);

    expect(entrada).toEqual({
      hoCode: "1000",
      price: 1000000,
      buyOption: { value: 1000000, valueWithoutTax: 763300, service: 105000 },
    });
  });

  test("devuelve null si no hay categoría GENERAL", () => {
    expect(elegirEntradaGeneral([{ categoryId: 14, tickets: [] }])).toBeNull();
  });
});

describe("mapearAsientosCinemark", () => {
  test("convierte filas y asientos en Butaca[] con coordenadas y disponibilidad", () => {
    const mapa = {
      areas: [
        {
          areaNumber: 1,
          areaDescription: "SALA 3",
          rows: [
            {
              seatGridRowId: 16,
              rowPhysicalId: "1",
              seats: [{ gridSeatNumber: 22, seatNumber: "30", seatStatus: 4 }],
            },
            {
              seatGridRowId: 15,
              rowPhysicalId: "2",
              seats: [
                { gridSeatNumber: 22, seatNumber: "30", seatStatus: 0 },
                { gridSeatNumber: 21, seatNumber: "28", seatStatus: 1 },
              ],
            },
          ],
        },
      ],
    };

    const butacas = mapearAsientosCinemark(mapa);

    expect(butacas).toHaveLength(3);
    expect(butacas[0]).toMatchObject({
      Nombre: "30",
      X: "22",
      Y: "16",
      Disponible: "sold",
      NombreZona: "SALA 3",
    });
    expect(butacas[1]).toMatchObject({ Nombre: "30", X: "22", Y: "15", Disponible: "available" });
    expect(butacas[2]).toMatchObject({ Nombre: "28", X: "21", Y: "15", Disponible: "sold" });
  });

  test("agrupa varias áreas por su descripción", () => {
    const mapa = {
      areas: [
        {
          areaNumber: 1,
          areaDescription: "SALA 1",
          rows: [
            {
              seatGridRowId: 2,
              rowPhysicalId: "1",
              seats: [{ gridSeatNumber: 3, seatNumber: "5", seatStatus: 0 }],
            },
          ],
        },
        {
          areaNumber: 2,
          areaDescription: "SALA 2",
          rows: [
            {
              seatGridRowId: 1,
              rowPhysicalId: "1",
              seats: [{ gridSeatNumber: 1, seatNumber: "1", seatStatus: 1 }],
            },
          ],
        },
      ],
    };

    const butacas = mapearAsientosCinemark(mapa);

    expect(butacas.map((b) => b.NombreZona)).toEqual(["SALA 1", "SALA 2"]);
  });

  test("sin áreas devuelve lista vacía", () => {
    expect(mapearAsientosCinemark({ areas: [] })).toEqual([]);
  });
});
