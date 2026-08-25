import { CINES } from "./seed";
import type { Cine, CineSeed } from "./types";

type StaticFuncion = {
  horario: string;
  formato: string;
  precio_general?: number;
  precio_jubilado?: number;
  precio_menor?: number;
};

type StaticPelicula = {
  titulo: string;
  url: string;
  imagen?: string;
  funciones: StaticFuncion[];
};

type StaticCine = {
  slug: string;
  peliculas: StaticPelicula[];
};

type StaticPrecio = {
  formato: string;
  precio_general?: number;
  precio_jubilado?: number;
  precio_menor?: number;
};

type StaticPrecios = {
  version: number;
  cines: Record<
    string,
    {
      cadena?: string;
      nombre?: string;
      formatos: Record<string, StaticPrecio>;
    }
  >;
  promociones?: StaticPromocion[];
};

type StaticPromocion = {
  id: string;
  nombre: string;
  activa?: boolean;
  dias?: number[];
  cadenas?: string[];
  cines?: string[];
  formatos?: string[];
  descripcion?: string;
  tipo?: "2x1" | "texto" | "descuento_porcentaje" | "precio_fijo";
  porcentaje?: number;
  precio_general?: number;
};

export async function listCines() {
  return CINES;
}

export async function getCartelera(date: string): Promise<Cine[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Fecha inválida");
  }

  const [response, precios] = await Promise.all([
    fetch(`/cartelera/${date}.json`, {
      cache: "no-store",
    }),
    getPrecios(),
  ]);
  if (!response.ok) {
    return CINES.map((seed) => ({ ...seed, peliculas: [] }));
  }

  const carteleraStatic = (await response.json()) as StaticCine[];
  const bySlug = new Map(carteleraStatic.map((cine) => [cine.slug, cine]));

  return CINES.map((seed) => {
    const staticCine = bySlug.get(seed.slug);
    if (!staticCine) return { ...seed, peliculas: [] };

    return {
      ...seed,
      peliculas: staticCine.peliculas.map((pelicula) => ({
        titulo: pelicula.titulo,
        url: pelicula.url,
        imagen: pelicula.imagen,
        funciones: pelicula.funciones.map((funcion) => ({
          horario: funcion.horario,
          formato: funcion.formato,
          compraUrl: seed.sitioWeb,
          ...resolvePrecio(precios, seed, funcion.formato, date),
        })),
      })),
    };
  });
}

async function getPrecios(): Promise<StaticPrecios | null> {
  const response = await fetch(`/cartelera/precios.json`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as StaticPrecios;
}

function resolvePrecio(precios: StaticPrecios | null, cine: CineSeed, formato: string, date: string) {
  const promociones = resolvePromociones(precios, cine, formato, date);
  const formatos = precios?.cines[cine.slug]?.formatos;
  if (!formatos) return promociones.length ? { promociones } : {};

  const exacto = formatos[normalizeFormat(formato)];
  if (exacto) return { ...priceFields(exacto), promociones };

  const compatible = Object.values(formatos).find((precio) =>
    areCompatibleFormats(precio.formato, formato),
  );
  return compatible ? { ...priceFields(compatible), promociones } : promociones.length ? { promociones } : {};
}

function priceFields(precio: StaticPrecio) {
  return {
    precio_general: precio.precio_general,
    precio_jubilado: precio.precio_jubilado,
    precio_menor: precio.precio_menor,
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeFormat(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function roomFamily(formato: string): string {
  const normalized = normalizeText(formato);
  if (normalized.includes("4d") || normalized.includes("4dx")) return "4d";
  if (normalized.includes("d box") || normalized.includes("dbox")) return "dbox";
  if (normalized.includes("imax")) return "imax";
  if (normalized.includes("screenx")) return "screenx";
  if (normalized.includes("premier")) return "premier";
  if (normalized.includes("comfort")) return "comfort";
  if (/\bxd\b/.test(normalized)) return "xd";
  if (normalized.includes("laser")) return "laser";
  return "standard";
}

function dimension(formato: string): string {
  const normalized = normalizeText(formato);
  if (normalized.includes("3d")) return "3d";
  if (normalized.includes("2d")) return "2d";
  return "";
}

function language(formato: string): string {
  const normalized = normalizeText(formato);
  if (normalized.includes("sub")) return "sub";
  if (
    normalized.includes("doblada") ||
    normalized.includes("cast") ||
    normalized.includes("espanol") ||
    normalized.includes("castellano")
  ) {
    return "dob";
  }
  return "";
}

function areCompatibleFormats(source: string, target: string): boolean {
  if (roomFamily(source) !== roomFamily(target)) return false;

  const sourceDimension = dimension(source);
  const targetDimension = dimension(target);
  if (sourceDimension && targetDimension && sourceDimension !== targetDimension) return false;

  const sourceLanguage = language(source);
  const targetLanguage = language(target);
  if (sourceLanguage && targetLanguage && sourceLanguage !== targetLanguage) return false;

  return true;
}

function resolvePromociones(
  precios: StaticPrecios | null,
  cine: CineSeed,
  formato: string,
  date: string,
): string[] {
  const weekday = getWeekday(date);
  return (precios?.promociones ?? [])
    .filter((promo) => promo.activa !== false)
    .filter((promo) => !promo.dias || promo.dias.includes(weekday))
    .filter((promo) => !promo.cines || promo.cines.includes(cine.slug))
    .filter((promo) => !promo.cadenas || promo.cadenas.includes(cine.cadena))
    .filter((promo) => matchesPromoFormat(promo, formato))
    .map((promo) => promo.nombre);
}

function matchesPromoFormat(promo: StaticPromocion, formato: string): boolean {
  if (!promo.formatos || promo.formatos.includes("*")) return true;
  return promo.formatos.some((promoFormat) => {
    if (normalizeFormat(promoFormat) === normalizeFormat(formato)) return true;
    return areCompatibleFormats(promoFormat, formato);
  });
}

function getWeekday(date: string): number {
  return new Date(`${date}T00:00:00`).getDay();
}
