import type { Butaca } from "./butacas";

export const CINEMARK_BASE_URL = "https://bff.cinemark.com.ar/api";

/**
 * Verifica si un cine pertenece a Cinemark Hoyts (cadena almacenada en el seed).
 */
export function esCineCinemark(cadena: string): boolean {
  return cadena.toLowerCase() === "cinemark hoyts";
}

export type EntradaGeneralCinemark = {
  hoCode: string;
  price: number;
  buyOption: {
    value: number;
    valueWithoutTax: number;
    service: number;
  };
};

export type AsientoCinemark = {
  gridSeatNumber: number;
  seatNumber: string;
  seatStatus: number;
};

export type FilaCinemark = {
  seatGridRowId: number;
  seats: AsientoCinemark[];
};

export type AreaCinemark = {
  areaNumber: number;
  areaDescription: string;
  rows: FilaCinemark[];
};

export type MapaCinemark = {
  areas: AreaCinemark[];
};

export type DatosFuncionCinemark = {
  cinemaId: number;
  sessionId: number;
  feature?: number;
  corporateFilmId?: string;
};

/**
 * Deserializa el payload JSON que el scan guarda por función en `funcion.cinemark`
 * (identificadores que el server fn necesita para pedir el mapa de asientos).
 */
export function parseDatosFuncionCinemark(
  raw: string | undefined | null,
): DatosFuncionCinemark | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const cinemaId = Number(obj.cinemaId);
  const sessionId = Number(obj.sessionId);
  if (!Number.isFinite(cinemaId) || !Number.isFinite(sessionId)) return null;
  return {
    cinemaId,
    sessionId,
    feature: obj.feature === undefined ? undefined : Number(obj.feature),
    corporateFilmId: typeof obj.corporateFilmId === "string" ? obj.corporateFilmId : undefined,
  };
}

/**
 * Elige la entrada "GENERAL" de la respuesta de /api/get-prices (la que usa
 * el flujo de compra para `order-tickets`): categoría `categoryId === 1`,
 * primer ticket disponible. Devuelve null si no hay tal categoría.
 */
export function elegirEntradaGeneral(precios: unknown): EntradaGeneralCinemark | null {
  if (!Array.isArray(precios)) return null;

  const categoria = precios.find(
    (cat) =>
      typeof cat === "object" && cat !== null && (cat as { categoryId?: number }).categoryId === 1,
  ) as
    | {
        tickets?: Array<{
          hoCode?: string;
          buyOptions?: Array<{ value?: number; valueWithoutTax?: number; service?: number }>;
        }>;
      }
    | undefined;

  const ticket = categoria?.tickets?.[0];
  const buyOption = ticket?.buyOptions?.[0];
  if (!ticket?.hoCode || !buyOption || typeof buyOption.value !== "number") return null;

  return {
    hoCode: ticket.hoCode,
    price: buyOption.value,
    buyOption: {
      value: buyOption.value,
      valueWithoutTax: buyOption.valueWithoutTax ?? 0,
      service: buyOption.service ?? 0,
    },
  };
}

/**
 * Convierte el layout de /api/order-get-map (áreas con filas de asientos y su
 * `seatStatus`) en `Butaca[]` para el render de la grilla:
 *   - seatStatus 0 -> available (libre)
 *   - seatStatus 1 -> sold (ocupada)
 *   - seatStatus 4 -> sold (especial/no vendible en el flujo normal)
 * Cada área del mapa se expone como una zona (NombreZona) propia.
 */
export function mapearAsientosCinemark(mapa: MapaCinemark): Butaca[] {
  const butacas: Butaca[] = [];
  for (const area of mapa.areas) {
    for (const fila of area.rows) {
      for (const asiento of fila.seats) {
        butacas.push({
          Nombre: asiento.seatNumber,
          Id: asiento.seatNumber,
          X: String(asiento.gridSeatNumber),
          Y: String(fila.seatGridRowId),
          Disponible: asiento.seatStatus === 0 ? "available" : "sold",
          Test: "0",
          Naranja: "",
          EsZonaPrincipal: "",
          Zona: String(area.areaNumber),
          NombreZona: area.areaDescription || `Zona ${area.areaNumber}`,
        });
      }
    }
  }
  return butacas;
}
