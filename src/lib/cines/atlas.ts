import type { Butaca } from "./butacas";

export const ATLAS_BASE_URL = "https://www.atlascines.com";

/**
 * Verifica si un cine pertenece a Atlas Cines (cadena almacenada en el seed).
 */
export function esCineAtlas(cadena: string): boolean {
  return cadena.toLowerCase() === "atlas cines";
}

/**
 * Arma el `df` de Atlas con el formato `codComp-AAAAMMDD-codPelicula-codFuncion-codTecnologia`
 * que usa la URL de compra `/carrito?df=<df>`.
 */
export function armarDfAtlas(opts: {
  codComplejo: number | string;
  fecha: string;
  codPelicula: number | string;
  codFuncion: number | string;
  codTecnologia: number | string;
}): string {
  const fecha = opts.fecha.replace(/-/g, "");
  return `${opts.codComplejo}-${fecha}-${opts.codPelicula}-${opts.codFuncion}-${opts.codTecnologia}`;
}

export type TicketAtlas = {
  id: string;
  zone: string;
  isPromo: string;
  isPromoValidated: string;
};

/**
 * Extrae los datos de la primera tarjeta de entrada (.v2-tcat) del carrito:
 * los que se reenvían como `carrito[0].{Id,Quantity,Zone,IsPromo,IsPromoValidated}`
 * al POST /Carrito/SelectSeats.
 */
export function parseAtlasTickets(html: string): TicketAtlas | null {
  const m = html.match(/<div class="v2-tcat[^"]*"[^>]*>/);
  if (!m) return null;
  const tag = m[0];
  const get = (name: string) => {
    const r = tag.match(new RegExp(`data-${name}="([^"]+)"`));
    return r ? r[1] : null;
  };
  const id = get("id");
  if (id === null) return null;
  return {
    id,
    zone: get("zone") ?? "1",
    isPromo: get("promo") ?? "False",
    isPromoValidated: get("promoval") ?? "True",
  };
}

const SEAT_TAG_RE = /<div class="v2-seat(?:\s+[a-z0-9-]+)?"[^>]*>/g;

/**
 * Convierte el layout server-rendered de /Carrito/SelectSeats en `Butaca[]`.
 * Cada `.v2-seat` expone title/data-seat-id/data-zone/data-seat-type/
 * data-seat-status/data-row/data-x. `data-row` es la fila (0 = arriba,
 * label letra) y `data-x` la coordenada en px de la columna, igual que el
 * formato Multiplex. El estado sold ya viene marcado en el HTML.
 */
export function parseAtlasSeats(html: string): Butaca[] | null {
  const tags = [...html.matchAll(SEAT_TAG_RE)].map((m) => m[0]);
  if (tags.length === 0) return null;

  const seats: Butaca[] = [];
  for (const tag of tags) {
    const attr = (name: string) => tag.match(new RegExp(`data-${name}="([^"]+)"`))?.[1] ?? null;

    const id = attr("seat-id");
    if (id === null) continue;

    const zona = attr("zone") ?? "";
    const status = attr("seat-status") ?? "available";
    // La zona de Atlas es un id numérico (sala); se muestra como "Sala N"
    // para que el encabezado no sea un número suelto.
    const nombreZona = /^\d+$/.test(zona) ? `Sala ${zona}` : zona || "General";
    seats.push({
      Nombre: id,
      Id: id,
      X: attr("x") ?? "",
      Y: attr("row") ?? "",
      Disponible: status === "available" ? "available" : "sold",
      Test: "0",
      Naranja: "",
      EsZonaPrincipal: "",
      Zona: zona,
      NombreZona: nombreZona,
    });
  }
  return seats;
}
