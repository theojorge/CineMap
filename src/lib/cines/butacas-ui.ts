import type { ButacasResponse } from "./butacas";
import { parseDatosFuncionCinemark, esCineCinemark, type DatosFuncionCinemark } from "./cinemark";
import type { Funcion } from "./types";

type ConsultaCinemark = {
  tipo: "cinemark";
  key: string[];
  payload: DatosFuncionCinemark;
};

type ConsultaAtlas = {
  tipo: "atlas";
  key: string[];
  payload: { df: string };
};

type ConsultaMultiplex = {
  tipo: "multiplex";
  key: string[];
  payload: { df?: string | null; peliculaUrl?: string | null };
};

export type PlanButacas =
  | ((ConsultaCinemark | ConsultaAtlas | ConsultaMultiplex) & { disponible: true })
  | { disponible: false };

/**
 * Decide qué flujo de butacas corresponde según la cadena del cine y los
 * identificadores disponibles en la función (`df` para Atlas/Multiplex,
 * `cinemark` para Cinemark). Devuelve la queryKey y el payload a consultar,
 * o `disponible: false` si la función no tiene cómo pedir asientos.
 */
export function planearButacas(
  cadena: string,
  funcion: Funcion,
  peliculaUrl?: string,
): PlanButacas {
  if (esCineCinemark(cadena)) {
    const datos = parseDatosFuncionCinemark(funcion.cinemark);
    if (!datos) return { disponible: false };
    return {
      disponible: true,
      tipo: "cinemark",
      key: ["butacas", "cinemark", String(datos.sessionId)],
      payload: datos,
    };
  }

  const cad = cadena.toLowerCase();
  if (cad === "atlas cines") {
    if (!funcion.df) return { disponible: false };
    return {
      disponible: true,
      tipo: "atlas",
      key: ["butacas", "atlas", funcion.df],
      payload: { df: funcion.df },
    };
  }

  if (cad === "multiplex") {
    return {
      disponible: true,
      tipo: "multiplex",
      key: ["butacas", "multiplex", funcion.df ?? peliculaUrl ?? "funcion"],
      payload: { df: funcion.df, peliculaUrl: peliculaUrl ?? null },
    };
  }

  return { disponible: false };
}

/**
 * Invoca la server fn correspondiente a un plan y normaliza la respuesta
 * (o lanza con el mensaje de error si el flujo devolvió success:false).
 */
export async function consultarButacasPlan(plan: PlanButacas & { disponible: true }) {
  const { obtenerButacas, obtenerButacasAtlas, obtenerButacasCinemark } = await import("./butacas");
  let respuesta: ButacasResponse;
  if (plan.tipo === "cinemark") {
    respuesta = await obtenerButacasCinemark({ data: plan.payload });
  } else if (plan.tipo === "atlas") {
    respuesta = await obtenerButacasAtlas({ data: plan.payload });
  } else {
    respuesta = await obtenerButacas({ data: plan.payload });
  }
  if (respuesta.success) return respuesta.data ?? [];
  throw new Error(respuesta.error ?? "No se pudieron obtener las butacas");
}
