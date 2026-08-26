import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MapLoader } from "@/components/map/map-loader";
import { SearchBar } from "@/components/search-bar";
import { CinemaPanel } from "@/components/cinema-panel";
import { MoviePanel } from "@/components/movie-panel";
import { MoviePopup } from "@/components/movie-popup";
import { getCartelera } from "@/lib/cines/api";
import { CINES } from "@/lib/cines/seed";
import type { Cine, CineSeed, Funcion, Pelicula } from "@/lib/cines/types";
import { addDaysISO, isUpcomingFuncion, todayAR } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            staleTime: 5 * 60 * 1000, // 5 minutos
            cacheTime: 10 * 60 * 1000, // 10 minutos
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <CarteleraApp />
    </QueryClientProvider>
  );
}

function CarteleraApp() {
  const today = todayAR();
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(today, i)),
    [today],
  );
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<string | null>(null);
  const [selectedFuncion, setSelectedFuncion] = useState<{ cineSlug: string; movieTitle: string; funcion: Funcion; movieImage?: string } | null>(null);

  const cartelera = useQuery({
    queryKey: ["cartelera", date],
    queryFn: () => getCartelera(date),
    staleTime: 5 * 60 * 1000,
  });

  const cines: (Cine | CineSeed)[] = useMemo(() => {
    if (!cartelera.data) return CINES;
    const bySlug = new Map(cartelera.data.map((c) => [c.slug, c]));
    return CINES.map((seed) => bySlug.get(seed.slug) ?? { ...seed, peliculas: [] });
  }, [cartelera.data]);

  const movieMatches = useMemo(() => filterMovies(cines, query), [cines, query]);
  const visibleSlugs = useMemo(() => {
    if (selectedMovie) {
      const slugs = new Set<string>();
      cines.forEach((c) => {
        if (
          "peliculas" in c &&
          c.peliculas.some(
            (p) =>
              p.titulo === selectedMovie &&
              p.funciones.some((f) => isUpcomingFuncion(f.horario, date)),
          )
        ) {
          slugs.add(c.slug);
        }
      });
      return slugs;
    }
    if (query.trim()) {
      const slugs = new Set<string>();
      movieMatches.forEach(({ cineSlug }: { cineSlug: string }) => slugs.add(cineSlug));
      return slugs;
    }
    return null;
  }, [selectedMovie, query, movieMatches, cines, date]);
  const selected = cines.find((c) => c.slug === selectedSlug);

  const movieShowtimes = useMemo(() => {
    if (!selectedMovie || !cartelera.data) return { showtimes: [], movieImage: undefined };
    const showtimes: { cine: Cine | CineSeed; funcion: Funcion; pelicula: Pelicula }[] = [];
    let movieImage: string | undefined;

    // Optimización: reducir iterations y procesamiento
    for (const c of cines) {
      if (!("peliculas" in c)) continue;

      const movie = c.peliculas.find((p) => p.titulo === selectedMovie);
      if (!movie) continue;

      if (!movieImage) movieImage = movie.imagen;

      // Filtrar y agregar funciones de forma más eficiente
      for (const f of movie.funciones) {
        if (isUpcomingFuncion(f.horario, date)) {
          showtimes.push({ cine: c, funcion: f, pelicula: movie });
        }
      }
    }

    // Sort optimizado usando una sola comparación
    return {
      showtimes: showtimes.sort((a, b) => {
        const [hoursA, minsA] = a.funcion.horario.split(':').map(Number);
        const [hoursB, minsB] = b.funcion.horario.split(':').map(Number);
        return hoursA * 60 + minsA - (hoursB * 60 + minsB);
      }),
      movieImage
    };
  }, [selectedMovie, cartelera.data, cines, date]);

  const { showtimes, movieImage } = movieShowtimes;

  const handleSelectFuncion = (cineSlug: string, movieTitle: string, funcion: Funcion, movieImage?: string) => {
    setSelectedSlug(cineSlug);
    setSelectedFuncion({ cineSlug, movieTitle, funcion, movieImage });
  };

  const handleSelectFuncionFromCinePanel = (movieTitle: string, funcion: Funcion, movieImage?: string) => {
    if (selected) {
      setSelectedFuncion({ cineSlug: selected.slug, movieTitle, funcion, movieImage });
    }
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <div className="absolute inset-0 z-0">
        <MapLoader
          cines={cines}
          visibleSlugs={visibleSlugs}
          selectedSlug={selectedSlug}
          loaded={Boolean(cartelera.data)}
          onSelect={setSelectedSlug}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <header className="flex flex-col gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:p-5">
          <div className="pointer-events-auto flex items-baseline gap-3">
            <h1 className="font-display text-2xl tracking-tight text-black md:text-3xl">
              CineMap
            </h1>
            <p className="hidden text-sm text-black sm:block">CABA y GBA</p>
          </div>
          <SearchBar
            query={query}
            onQuery={setQuery}
            date={date}
            dates={dates}
            today={today}
            onDate={(d) => {
              setDate(d);
            }}
            movieMatches={movieMatches}
            onPickMovie={(movieTitle: string) => {
              setSelectedMovie(movieTitle);
              setQuery("");
            }}
            loading={cartelera.isFetching}
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col justify-end p-3 md:flex-row md:items-stretch md:justify-end md:p-5">
          {selectedMovie ? (
            <MoviePanel
              movieTitle={selectedMovie}
              showtimes={showtimes}
              loaded={Boolean(cartelera.data)}
              onClose={() => setSelectedMovie(null)}
              onSelectFuncion={handleSelectFuncion}
              movieImage={movieImage}
            />
          ) : selected ? (
            <CinemaPanel
              cine={selected}
              loaded={Boolean(cartelera.data)}
              onClose={() => setSelectedSlug(null)}
              onSelectFuncion={handleSelectFuncionFromCinePanel}
              selectedDate={date}
            />
          ) : null}
        </div>

        {selectedFuncion && selected ? (
          <MoviePopup
            movieTitle={selectedFuncion.movieTitle}
            cineName={selected.nombre}
            funcion={selectedFuncion.funcion}
            movieImage={selectedFuncion.movieImage}
            onClose={() => setSelectedFuncion(null)}
          />
        ) : null}
      </div>
    </main>
  );
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function filterMovies(cines: (Cine | CineSeed)[], raw: string): { movieTitle: string; cineSlug: string; cine: Cine | CineSeed; movieImage?: string }[] {
  const q = normalizeText(raw.trim());
  if (!q) return [];
  const results: { movieTitle: string; cineSlug: string; cine: Cine | CineSeed; movieImage?: string }[] = [];
  const seenMovies = new Set<string>();

  cines.forEach((c) => {
    if ("peliculas" in c) {
      c.peliculas.forEach((p) => {
        const normalizedTitle = normalizeText(p.titulo);
        if (normalizedTitle.includes(q) && !seenMovies.has(normalizedTitle)) {
          seenMovies.add(normalizedTitle);
          results.push({ movieTitle: p.titulo, cineSlug: c.slug, cine: c, movieImage: p.imagen });
        }
      });
    }
  });

  return results;
}
