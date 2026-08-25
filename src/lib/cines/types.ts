export type Funcion = {
  horario: string;
  formato: string;
  compraUrl: string;
  precio_general?: number;
  precio_jubilado?: number;
  precio_menor?: number;
  promociones?: string[];
};

export type Pelicula = {
  titulo: string;
  url: string;
  imagen?: string;
  funciones: Funcion[];
};

export type CineSeed = {
  slug: string;
  cadena: string;
  nombre: string;
  zona: string;
  direccion: string;
  lat: number;
  lng: number;
  sitioWeb: string;
  carteleraUrl: string;
};

export type Cine = CineSeed & {
  peliculas: Pelicula[];
};
