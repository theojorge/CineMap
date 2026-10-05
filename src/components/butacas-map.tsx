import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Butaca } from "@/lib/cines/butacas";

type Props = {
  butacas: Butaca[];
  onClose: () => void;
  isLoading?: boolean;
  error?: string;
};

export function ButacasMap({ butacas, onClose, isLoading, error }: Props) {
  const [selectedButaca, setSelectedButaca] = useState<Butaca | null>(null);

  if (isLoading) {
    return (
      <div className="pointer-events-auto fixed bottom-4 left-4 z-50 w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-panel p-6">
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm text-fg-muted">Cargando butacas...</span>
        </div>
      </div>
    );
  }

  if (!butacas || butacas.length === 0) {
    return (
      <div className="pointer-events-auto fixed bottom-4 left-4 z-50 w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-panel p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-display text-lg font-medium text-fg">Disponibilidad de butacas</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-sm text-fg-muted">
          {error
            ? "No se pudieron obtener las butacas"
            : "No hay información de butacas disponible."}
        </p>
      </div>
    );
  }

  // Agrupar butacas por zona
  const zonas = butacas.reduce(
    (acc, butaca) => {
      const zona = butaca.NombreZona || "General";
      if (!acc[zona]) {
        acc[zona] = [];
      }
      acc[zona].push(butaca);
      return acc;
    },
    {} as Record<string, Butaca[]>,
  );

  // Calcular estadísticas
  const disponibles = butacas.filter((b) => b.Disponible === "available").length;
  const ocupadas = butacas.filter((b) => b.Disponible === "sold").length;
  const total = butacas.length;

  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 z-50 w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-panel">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-medium text-fg">Disponibilidad de butacas</h3>
          <div className="mt-1 flex items-center gap-3 text-xs text-fg-muted">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-green-500" />
              {disponibles} disponibles
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-red-500" />
              {ocupadas} ocupadas
            </span>
            <span>Total: {total}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-4">
        {Object.entries(zonas).map(([nombreZona, butacasZona]) => (
          <div key={nombreZona} className="mb-4 last:mb-0">
            <h4 className="mb-2 text-sm font-medium text-fg">{nombreZona}</h4>
            <div className="relative rounded-lg border border-border bg-surface-2 p-3">
              <ButacasGrid butacas={butacasZona} onSelect={setSelectedButaca} />
            </div>
          </div>
        ))}
      </div>

      {selectedButaca && (
        <div className="border-t border-border p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-fg">Butaca {selectedButaca.Nombre}</p>
              <p className="text-xs text-fg-muted">Zona: {selectedButaca.NombreZona}</p>
              <p className="mt-1 text-xs">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    selectedButaca.Disponible === "available"
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {selectedButaca.Disponible === "available" ? "Disponible" : "Ocupada"}
                </span>
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedButaca(null)}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ButacasGrid({
  butacas,
  onSelect,
}: {
  butacas: Butaca[];
  onSelect: (butaca: Butaca) => void;
}) {
  // Agrupar por filas/columnas densas: cada Y distinta = una fila,
  // cada X distinta = una columna. Evita grillas gigantes con celdas vacías
  // cuando las coordenadas crudas vienen muy espaciadas.
  const xs = [...new Set(butacas.map((b) => parseInt(b.X)))].sort((a, b) => a - b);
  const ys = [...new Set(butacas.map((b) => parseInt(b.Y)))].sort((a, b) => a - b);
  const xIndex = new Map(xs.map((v, i) => [v, i]));
  const yIndex = new Map(ys.map((v, i) => [v, i]));

  const width = xs.length;
  const height = ys.length;

  // Crear un mapa de posiciones
  const positionMap = new Map<string, Butaca>();
  butacas.forEach((butaca) => {
    const key = `${xIndex.get(parseInt(butaca.X))},${yIndex.get(parseInt(butaca.Y))}`;
    positionMap.set(key, butaca);
  });

  // Asiento de tamaño fijo: en salas grandes la grilla hace scroll
  // horizontal en vez de achicar los asientos hasta hacerlos ilegibles.
  const SEAT_PX = 24;
  const SEAT_H = 20;

  return (
    <div>
      {/* Pantalla */}
      <div className="mb-4">
        <div className="relative flex h-16 items-end justify-center overflow-hidden rounded-t-full border border-b-0 border-accent/30 bg-gradient-to-b from-accent/50 via-accent/10 to-transparent shadow-[0_-2px_14px_rgba(0,0,0,0.35)]">
          <span className="pb-2.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-fg">
            Pantalla
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div
          className="mx-auto grid w-max gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${width}, ${SEAT_PX}px)`,
          }}
        >
          {Array.from({ length: height }).map((_, y) =>
            Array.from({ length: width }).map((_, x) => {
              const key = `${x},${y}`;
              const butaca = positionMap.get(key);

              if (!butaca) {
                return <div key={key} style={{ width: SEAT_PX, height: SEAT_H }} />;
              }

              const isAvailable = butaca.Disponible === "available";
              const estado = isAvailable ? "Disponible" : "Ocupada";

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(butaca)}
                  style={{ width: SEAT_PX, height: SEAT_H }}
                  className={`flex items-center justify-center rounded-md transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isAvailable ? "bg-green-500" : "bg-red-500/90"
                  }`}
                  title={`Butaca ${butaca.Nombre} - ${estado}`}
                  aria-label={`Butaca ${butaca.Nombre} - ${estado}`}
                >
                  <svg viewBox="0 0 24 20" className="h-[62%] w-auto text-white" aria-hidden="true">
                    <g fill="currentColor">
                      <rect x="4" y="1" width="16" height="7" rx="2" />
                      <rect x="1.5" y="7" width="21" height="11" rx="2.5" />
                    </g>
                  </svg>
                </button>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
