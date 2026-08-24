import { X, ExternalLink } from "lucide-react";
import type { Funcion } from "@/lib/cines/types";

type Props = {
  movieTitle: string;
  cineName: string;
  funcion: Funcion;
  movieImage?: string;
  onClose: () => void;
};

export function MoviePopup({ movieTitle, cineName, funcion, movieImage, onClose }: Props) {
  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 z-50 w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-panel">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-medium text-fg">{movieTitle}</h3>
          <p className="text-sm text-fg-muted">{cineName}</p>
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
      <div className="p-4">
        <div className="mb-4 grid grid-cols-[6rem_1fr] gap-4">
          {movieImage ? (
            <img
              src={movieImage}
              alt={movieTitle}
              className="aspect-[2/3] w-24 rounded-md border border-border object-cover"
            />
          ) : (
            <div className="aspect-[2/3] w-24 rounded-md border border-border bg-surface-2" />
          )}
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums text-fg">{funcion.horario}</span>
              <span className="text-sm text-fg-muted">{shortFormat(funcion.formato)}</span>
            </div>
            <PriceList funcion={funcion} />
          </div>
        </div>
        <a
          href={funcion.compraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          Comprar entradas
          <ExternalLink className="size-4" />
        </a>
      </div>
    </div>
  );
}

function PriceList({ funcion }: { funcion: Funcion }) {
  const prices = [
    ["General", funcion.precio_general],
    ["Jubilado", funcion.precio_jubilado],
    ["Menor", funcion.precio_menor],
  ].filter(([, price]) => typeof price === "number") as [string, number][];

  if (prices.length === 0) {
    return <p className="text-sm text-fg-muted">Precio no disponible</p>;
  }

  return (
    <dl className="grid gap-1.5 text-sm">
      {prices.map(([label, price]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="font-semibold tabular-nums text-fg">{formatPrice(price)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

function shortFormat(formato: string): string {
  return formato
    .replace(/subtitulada/i, "SUB")
    .replace(/doblada/i, "DOB")
    .replace(/castellano/i, "CAST");
}
