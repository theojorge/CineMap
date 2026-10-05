/**
 * Módulo para obtener datos de butacas de Multiplex en tiempo real.
 *
 * El scraping se hace del lado del servidor (createServerFn): el navegador no
 * puede llamar a ventas.cinemultiplex.com.ar directo por CORS, así que el
 * cliente invoca esta server fn y el server resuelve la sesión (GET + POST)
 * contra la página de la función. Solo aplica a funciones Multiplex.
 *
 * Flujo (port fiel de scrape_butacas_ful.py):
 *   1) GET  https://ventas.cinemultiplex.com.ar/funcion?df=<df>
 *      -> arma la sesión (cookies) y expone un __tabToken (hidden input) y
 *         el/los IdPrecio disponibles.
 *   2) POST /funcion/SeleccionAsientos
 *      body: detalleVenta=<json>&__tabToken=<token>
 *      -> devuelve HTML con un bloque <script> que define:
 *           seats = [ {X,Y,Nombre,Disponible,Test,Id,Naranja,
 *                      EsZonaPrincipal,Zona,NombreZona}, ... ]
 */

import { createServerFn } from "@tanstack/react-start";
import { ATLAS_BASE_URL, parseAtlasSeats, parseAtlasTickets } from "./atlas";
import {
  CINEMARK_BASE_URL,
  elegirEntradaGeneral,
  mapearAsientosCinemark,
  type DatosFuncionCinemark,
} from "./cinemark";

export type Butaca = {
  X: string;
  Y: string;
  Nombre: string;
  Disponible: "available" | "sold" | string;
  Test: string;
  Id: string;
  Naranja: string;
  EsZonaPrincipal: string;
  Zona: string;
  NombreZona: string;
};

export type ButacasResponse = {
  success: boolean;
  data?: Butaca[];
  error?: string;
};

/**
 * Extrae de un texto (HTML/JS) el primer objeto/array JS asignado como
 * `nombreVar = {...}` o `[...]`, tolerando cualquier texto que venga después
 * (ej. `seats = [...];` seguido de más JS). Equivale a raw_decode del Python.
 */
function extraerJsonVar(texto: string, nombreVar: string): any {
  const idx = texto.indexOf(`${nombreVar} = `);
  if (idx === -1) return null;
  let i = idx + `${nombreVar} = `.length;
  while (i < texto.length && texto[i] !== "[" && texto[i] !== "{") i++;
  if (i >= texto.length || (texto[i] !== "[" && texto[i] !== "{")) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let j = i; j < texto.length; j++) {
    const ch = texto[j];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(texto.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Extrae el __tabToken del HTML del paso 1 (varios patrones de atributos).
 */
function obtenerTabToken(html: string): string | null {
  // name="__tabToken" value="..."
  let m = html.match(/name="__tabToken"\s+value="([^"]+)"/);
  if (m) return m[1];
  m = html.match(/name=['"]__tabToken['"][^>]*value=['"]([^'"]+)['"]/);
  if (m) return m[1];
  m = html.match(/value=['"]([^'"]+)['"][^>]*name=['"]__tabToken['"]/);
  if (m) return m[1];
  return null;
}

/**
 * Detecta el IdPrecio a usar en el paso 1, igual que el scraper Python:
 *  1) atributo data-id del botón "btnPlus" (primer tipo de entrada);
 *  2) variables JS tipo precios/tiposEntrada/preciosFuncion/listaPrecios;
 *  3) data-idprecio="N"; 4) name="precios[N]".
 */
function obtenerPrecioPorDefecto(html: string): number | null {
  const mBtn = html.match(/id="btnPlus"[^>]*data-id="(\d+)"/);
  if (mBtn) return parseInt(mBtn[1], 10);

  const variables = ["precios", "tiposEntrada", "preciosFuncion", "listaPrecios"];
  for (const variable of variables) {
    const data = extraerJsonVar(html, variable);
    if (data) {
      if (Array.isArray(data) && data.length > 0) {
        return data[0].IdPrecio ?? data[0].Id ?? null;
      }
      if (typeof data === "object" && data !== null && "IdPrecio" in data) {
        return (data as { IdPrecio?: number }).IdPrecio ?? null;
      }
    }
  }

  const mIdPrecio = html.match(/data-idprecio="(\d+)"/i);
  if (mIdPrecio) return parseInt(mIdPrecio[1], 10);

  const mPrecio = html.match(/name="precio(?:s)?\[?(\d+)\]?"/);
  if (mPrecio) return parseInt(mPrecio[1], 10);

  return null;
}

const VENTAS_BASE = "https://ventas.cinemultiplex.com.ar";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9",
};

/**
 * Dado un `df`, resuelve la sesión/token contra ventas.cinemultiplex y
 * devuelve la lista `seats`. Corre del lado del servidor.
 *
 * La sesión se mantiene entre el GET y el POST reenviando las cookies
 * (`headers.getSetCookie()`) que el sitio setea al armar el `__tabToken`:
 * sin ellas el POST responde "El tiempo expiró".
 */
async function scrapearButacas(df: string): Promise<ButacasResponse> {
  try {
    // Paso 1: GET a la página de la función para armar la sesión y sacar el token
    const urlPaso1 = `${VENTAS_BASE}/funcion?df=${encodeURIComponent(df)}`;
    const r1 = await fetch(urlPaso1, { headers: HEADERS });
    if (!r1.ok) {
      throw new Error(`Error en paso 1: ${r1.status}`);
    }
    const html1 = await r1.text();

    const tabToken = obtenerTabToken(html1);
    if (!tabToken) {
      throw new Error("No se encontró __tabToken en la página del paso 1");
    }

    const idPrecio = obtenerPrecioPorDefecto(html1);
    if (idPrecio === null) {
      throw new Error("No se pudo detectar automáticamente el IdPrecio");
    }

    const cookies = r1.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");

    // Paso 2: POST para obtener los asientos
    const detalleVenta = {
      [idPrecio.toString()]: {
        IdPrecio: idPrecio,
        Cantidad: 1,
        Zone: "",
        Valor: 0,
        ValorTotal: 0,
        DescripcionPrecio: "",
        CantidadEntradas: 0,
        EsPromocion: false,
        Descuento: "",
        NombrePromocion: "",
        PromocionValida: false,
        CredencialPromocion: "",
      },
    };

    const body = new URLSearchParams({
      detalleVenta: JSON.stringify(detalleVenta),
      __tabToken: tabToken,
    });

    const urlPaso2 = `${VENTAS_BASE}/funcion/SeleccionAsientos`;
    const r2 = await fetch(urlPaso2, {
      method: "POST",
      headers: {
        ...HEADERS,
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: VENTAS_BASE,
        Referer: urlPaso1,
      },
      body: body.toString(),
    });
    if (!r2.ok) {
      throw new Error(`Error en paso 2: ${r2.status}`);
    }
    const html2 = await r2.text();

    const seats = extraerJsonVar(html2, "seats");
    if (!seats) {
      throw new Error("No se encontró la variable `seats` en la respuesta");
    }

    return { success: true, data: seats as Butaca[] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

type ObtenerButacasInput = {
  df?: string | null;
  peliculaUrl?: string | null;
};

/**
 * Server function: obtiene las butacas de una función Multiplex en tiempo
 * real. Si no viene `df`, intenta extraerlo de la página de la película
 * (URL de multiplex.com.ar). Solo debe invocarse para cines Multiplex.
 */
export const obtenerButacas = createServerFn({ method: "GET" })
  .validator((d: ObtenerButacasInput): ObtenerButacasInput => {
    return {
      df: d.df ?? null,
      peliculaUrl: d.peliculaUrl ?? null,
    };
  })
  .handler(async ({ data }) => {
    let df = data.df;

    // Fallback: si no hay df pero sí la URL de la película en multiplex.com.ar,
    // extraer el df de la página antes de scrapear (todo server-side).
    if (!df && data.peliculaUrl && !data.peliculaUrl.includes("cartelera.ar")) {
      try {
        const resp = await fetch(data.peliculaUrl, { headers: HEADERS });
        if (resp.ok) {
          const html = await resp.text();
          const match =
            html.match(/ventas\.cinemultiplex\.com\.ar\/funcion\?df=([0-9-]+)/) ??
            html.match(/df=([0-9-]+)/);
          if (match) df = match[1];
        }
      } catch {
        df = null;
      }
    }

    if (!df) {
      return {
        success: false,
        error: "No se pudo obtener el código de función (df)",
      } satisfies ButacasResponse;
    }

    return scrapearButacas(df);
  });

const ATLAS_HEADERS: Record<string, string> = {
  "User-Agent": HEADERS["User-Agent"],
  "Accept-Language": "es-ES,es;q=0.9",
};

/**
 * Dado un `df` de Atlas (`codComp-AAAAMMDD-codPelicula-codFuncion-codTecnologia`),
 * resuelve las butacas contra atlascines.com sin login:
 *   1) GET /carrito?df=<df> -> arma la sesión (cookie) y expone las tarjetas
 *      de entrada (.v2-tcat) con su Id/Zone/promo.
 *   2) POST /Carrito/SelectSeats con carrito[0].{Id,Quantity,Zone,...}
 *      -> el HTML trae el layout completo de asientos (.v2-seat) con el
 *      estado available/sold ya marcado server-side.
 */
async function scrapearButacasAtlas(df: string): Promise<ButacasResponse> {
  try {
    const urlPaso1 = `${ATLAS_BASE_URL}/carrito?df=${encodeURIComponent(df)}`;
    const r1 = await fetch(urlPaso1, { headers: ATLAS_HEADERS });
    if (!r1.ok) {
      throw new Error(`Error en paso 1: ${r1.status}`);
    }
    const html1 = await r1.text();

    const ticket = parseAtlasTickets(html1);
    if (!ticket) {
      throw new Error(`No se encontró una tarjeta v2-tcat en el carrito (df=${df})`);
    }

    const cookies = r1.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");

    const form = new URLSearchParams({
      "carrito[0].Id": ticket.id,
      "carrito[0].Quantity": "1",
      "carrito[0].Zone": ticket.zone,
      "carrito[0].IsPromo": ticket.isPromo,
      "carrito[0].IsPromoValidated": ticket.isPromoValidated,
    });

    const r2 = await fetch(`${ATLAS_BASE_URL}/Carrito/SelectSeats`, {
      method: "POST",
      headers: {
        ...ATLAS_HEADERS,
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: ATLAS_BASE_URL,
        Referer: urlPaso1,
      },
      body: form.toString(),
    });
    if (!r2.ok) {
      throw new Error(`Error en paso 2: ${r2.status}`);
    }
    const html2 = await r2.text();

    const seats = parseAtlasSeats(html2);
    if (!seats) {
      throw new Error("No se encontraron asientos en la respuesta");
    }
    return { success: true, data: seats };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

/**
 * Server function: obtiene las butacas de una función Atlas a partir de su
 * `df`. Solo debe invocarse para cines Atlas.
 */
export const obtenerButacasAtlas = createServerFn({ method: "GET" })
  .validator((d: { df?: string | null }): { df: string | null } => ({
    df: d.df ?? null,
  }))
  .handler(async ({ data }) => {
    if (!data.df) {
      return {
        success: false,
        error: "No se pudo obtener el código de función (df)",
      } satisfies ButacasResponse;
    }
    return scrapearButacasAtlas(data.df);
  });

const CINEMARK_HEADERS = (): Record<string, string> => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  country: "AR",
  "User-Agent": HEADERS["User-Agent"],
  "member-session-id": process.env.CINEMARK_MEMBER_SESSION_ID ?? "",
  "x-client-ip": process.env.CINEMARK_X_CLIENT_IP ?? "",
  Origin: "https://www.cinemark.com.ar",
  Referer: "https://www.cinemark.com.ar/",
});

/**
 * Scrapea las butacas de una función Cinemark con el flujo de compra real,
 * del lado del servidor (sin navegador):
 *   1) GET  /api/get-prices                -> entrada "GENERAL" con su precio
 *   2) POST /api/order-tickets             -> arma un pedido temporal (transIdTemp)
 *   3) GET  /api/order-get-map?transIdTemp -> layout real de asientos (seatStatus)
 * Requiere la sesión autenticada del usuario en variables de entorno
 * (ver .env.example). El pedido temporal expira a los ~5 minutos.
 */
async function scrapearButacasCinemark(datos: DatosFuncionCinemark): Promise<ButacasResponse> {
  const memberSessionId = process.env.CINEMARK_MEMBER_SESSION_ID;
  const xClientIp = process.env.CINEMARK_X_CLIENT_IP;
  const salesChannelToken = process.env.CINEMARK_SALES_CHANNEL_TOKEN;
  const memberId = process.env.CINEMARK_MEMBER_ID;

  if (!memberSessionId || !xClientIp || !salesChannelToken || !memberId) {
    return {
      success: false,
      error:
        "Cinemark: faltan credenciales en .env " +
        "(CINEMARK_MEMBER_SESSION_ID, CINEMARK_X_CLIENT_IP, CINEMARK_SALES_CHANNEL_TOKEN, CINEMARK_MEMBER_ID)",
    };
  }

  if (!Number.isFinite(datos.cinemaId) || !Number.isFinite(datos.sessionId)) {
    return {
      success: false,
      error: "Cinemark: faltan datos de la función (cinemaId/sessionId)",
    };
  }

  const headers = CINEMARK_HEADERS();
  const feature = datos.feature ?? 0;
  const cineId = datos.cinemaId;
  const sesId = datos.sessionId;

  try {
    const preciosRes = await fetch(
      `${CINEMARK_BASE_URL}/get-prices?cinemaId=${cineId}&sessionId=${sesId}` +
        `&feature=${feature}&salesChannelToken=${encodeURIComponent(salesChannelToken)}` +
        `&memberId=${memberId}`,
      { headers },
    );
    if (!preciosRes.ok) {
      throw new Error(`Cinemark get-prices: ${preciosRes.status}`);
    }
    const precios = (await preciosRes.json()) as {
      code?: number;
      message?: string;
      data?: unknown;
    };
    if (precios.code !== 0) {
      throw new Error(`Cinemark: ${precios.message ?? "error al pedir precios"}`);
    }
    const entrada = elegirEntradaGeneral(precios.data);
    if (!entrada) {
      throw new Error("Cinemark: no se encontró la entrada GENERAL");
    }

    const cuerpoOrden = {
      sessionId: sesId,
      ticketList: [
        {
          areaCategoryCode: "",
          hOCode: entrada.hoCode,
          recogId: 0,
          promoId: 0,
          voucher: "",
          quantity: 1,
          price: entrada.price,
          ticketsQty: 1,
          buyOptions: [entrada.buyOption],
          isVoucher: false,
          isPaymentByCreditCardOnly: false,
          partnershipName: "",
        },
      ],
      cinemaId: cineId,
      feature,
      salesChannelToken,
      movie: { corporateFilmId: datos.corporateFilmId ?? "" },
      user: {
        fullName: process.env.CINEMARK_USER_FULL_NAME ?? "",
        email: process.env.CINEMARK_USER_EMAIL ?? "",
        phone: process.env.CINEMARK_USER_PHONE ?? "",
        memberId,
        customerType: 0,
      },
      isMobile: false,
    };

    const ordenRes = await fetch(`${CINEMARK_BASE_URL}/order-tickets`, {
      method: "POST",
      headers,
      body: JSON.stringify(cuerpoOrden),
    });
    if (!ordenRes.ok) {
      throw new Error(`Cinemark order-tickets: ${ordenRes.status}`);
    }
    const orden = (await ordenRes.json()) as {
      code?: number;
      message?: string;
      data?: { transIdTemp?: number };
    };
    if (orden.code !== 0) {
      throw new Error(`Cinemark: ${orden.message ?? "error al crear el pedido"}`);
    }
    const transIdTemp = orden.data?.transIdTemp;
    if (!transIdTemp) {
      throw new Error("Cinemark: no se obtuvo transIdTemp");
    }

    const mapaRes = await fetch(
      `${CINEMARK_BASE_URL}/order-get-map?cinemaId=${cineId}` +
        `&transIdTemp=${transIdTemp}&sessionId=${sesId}`,
      { headers },
    );
    if (!mapaRes.ok) {
      throw new Error(`Cinemark order-get-map: ${mapaRes.status}`);
    }
    const mapa = (await mapaRes.json()) as {
      Code?: number;
      Message?: string;
      Data?: { areas?: unknown };
    };
    if (mapa.Code !== 0) {
      throw new Error(`Cinemark: ${mapa.Message ?? "error al obtener el plano"}`);
    }

    const butacas = mapearAsientosCinemark(mapa.Data as never);
    return { success: true, data: butacas };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

/**
 * Server function: obtiene las butacas de una función Cinemark a partir de los
 * identificadores guardados en el scan (`funcion.cinemark`). Solo debe
 * invocarse para cines Cinemark.
 */
export const obtenerButacasCinemark = createServerFn({ method: "GET" })
  .validator((d: DatosFuncionCinemark): DatosFuncionCinemark => {
    return {
      cinemaId: Number(d.cinemaId),
      sessionId: Number(d.sessionId),
      feature: d.feature === undefined ? undefined : Number(d.feature),
      corporateFilmId: d.corporateFilmId ?? undefined,
    };
  })
  .handler(async ({ data }) => scrapearButacasCinemark(data));

/**
 * Extrae el código de función (df) de una URL de compra de Multiplex
 */
export function extraerCodigoFuncion(url: string): string | null {
  try {
    return new URL(url).searchParams.get("df");
  } catch {
    return null;
  }
}

/**
 * Verifica si una URL pertenece a Multiplex
 */
export function esMultiplex(url: string): boolean {
  return url.includes("multiplex.com.ar") || url.includes("cinemultiplex.com.ar");
}

/**
 * Verifica si un cine es Multiplex basándose en la cadena
 */
export function esCineMultiplex(cadena: string): boolean {
  return cadena.toLowerCase() === "multiplex";
}
