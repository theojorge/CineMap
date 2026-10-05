export const VENTAS_MULTIPLEX_URL = "https://ventas.cinemultiplex.com.ar/funcion";
export const CARRITO_ATLAS_URL = "https://www.atlascines.com/carrito";

/**
 * URL del botón "Comprar entradas" para una función. Cuando la función
 * trae `df`, Multiplex y Atlas enlazan directo al flujo de compra de esa
 * función; si no, se usa el sitio del cine.
 */
export function compraUrlParaFuncion(
  cadena: string,
  funcion: { df?: string | null },
  sitioWeb: string,
): string {
  const df = funcion.df ?? "";
  if (df !== "") {
    if (cadena === "Multiplex") return `${VENTAS_MULTIPLEX_URL}?df=${df}`;
    if (cadena === "Atlas Cines") return `${CARRITO_ATLAS_URL}?df=${df}`;
  }
  return sitioWeb;
}
