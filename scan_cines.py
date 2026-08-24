#!/usr/bin/env python3
"""
scan_cines.py — Escanea la cartelera de CABA y GBA (todas las cadenas) y arma
un listado de películas con horarios.

Fuente de datos: cartelera.ar, que agrupa los cines por zona (CABA, GBA Norte,
GBA Sur, GBA Oeste, Córdoba, Rosario, etc.) y agrega horarios de Cinemark,
Showcase, Multiplex, Cinépolis, Atlas, Hoyts, Cinemacenter e independientes.
Se eligió esta fuente en lugar de scrapear cada cadena directo porque esos
sitios son SPAs; cartelera.ar entrega el dato en HTML / RSC parseable.

Uso:
    pip install requests beautifulsoup4 --break-system-packages
    python3 scan_cines.py
    python3 scan_cines.py --zonas caba
    python3 scan_cines.py --zonas caba,"gba norte",córdoba
    python3 scan_cines.py --zonas todas
    python3 scan_cines.py --cadenas cinemark,atlas
    python3 scan_cines.py --fecha 2026-08-25
    python3 scan_cines.py --json salida.json --csv salida.csv

Por defecto recorre las zonas CABA + GBA Norte/Sur/Oeste, sin filtrar por
cadena. --cadenas queda como filtro opcional.

Notas:
- Este script hace scraping "amable": espera ~1 segundo entre pedidos y
  usa un User-Agent identificable. Si vas a correrlo seguido (ej. cron),
  subí el --delay y revisá los Términos de cartelera.ar.
- La página /cines es un Next.js que manda el listado en el payload RSC
  (self.__next_f). Si cambia el formato, correlo con --debug.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin, urlparse, parse_qs, unquote
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://cartelera.ar"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ScanCinesBot/1.0; uso personal; "
        "+https://cartelera.ar)"
    )
}

TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
FORMAT_RE = re.compile(
    r"\b(2D|3D|4D|4DX|XD|IMAX|D-?BOX|PREMIER|COMFORT|LASER|SCREENX|"
    r"DOBLADA|SUBTITULADA|CASTELLANO)\b",
    re.IGNORECASE,
)
# Precio por función, tal como lo concatena el HTML: "$24.000Jub. $17.000Men. $17.000"
# Jub./Men. son opcionales porque algunos formatos (ej. estrenos especiales)
# solo muestran precio general.
PRICE_RE = re.compile(
    r"^\$([\d.,]+)"
    r"(?:\s*Jub\.?\s*\$([\d.,]+))?"
    r"(?:\s*Men\.?\s*\$([\d.,]+))?$"
)
SLUG_RE = re.compile(r"/cine/([a-z0-9-]+)")
FLIGHT_PUSH_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)')
CHUNK_ID_RE = re.compile(r"(?:^|\n)([0-9a-f]+):")
LREF_RE = re.compile(r'"\$L([0-9a-f]+)"')
SECTION_RE = re.compile(r'\["\$","section","([^"]+)"')
PELICULAS_RE = re.compile(r'\[(\d+)," ","películas"\]')

# Alias de CLI → zonas publicadas en /cines. "gba" cubre las tres del conurbano.
ZONAS_AMBA = ("CABA", "GBA Norte", "GBA Sur", "GBA Oeste")
ZONA_ALIASES = {
    "caba": ("CABA",),
    "capital": ("CABA",),
    "amba": ZONAS_AMBA,
    "gba": ("GBA Norte", "GBA Sur", "GBA Oeste"),
    "gba norte": ("GBA Norte",),
    "gba-norte": ("GBA Norte",),
    "gbanorte": ("GBA Norte",),
    "gba sur": ("GBA Sur",),
    "gba-sur": ("GBA Sur",),
    "gbasur": ("GBA Sur",),
    "gba oeste": ("GBA Oeste",),
    "gba-oeste": ("GBA Oeste",),
    "gbaoeste": ("GBA Oeste",),
}

# Prefijos de slug → nombre de cadena, por si el payload no trae la etiqueta.
CADENA_POR_SLUG = (
    ("cinemark", "Cinemark Hoyts"),
    ("hoyts", "Cinemark Hoyts"),
    ("showcase", "Showcase"),
    ("imax-showcase", "Showcase"),
    ("multiplex", "Multiplex"),
    ("cinepolis", "Cinépolis"),
    ("atlas", "Atlas Cines"),
    ("cinemacenter", "Cinemacenter"),
)


@dataclass
class Funcion:
    horario: str
    formato: str
    precio_general: Optional[int] = None
    precio_jubilado: Optional[int] = None
    precio_menor: Optional[int] = None


@dataclass
class Pelicula:
    titulo: str
    url: str
    imagen: str = ""
    funciones: list = field(default_factory=list)


@dataclass
class Cine:
    cadena: str
    nombre: str
    slug: str
    zona: str = ""
    direccion: str = ""
    peliculas: list = field(default_factory=list)


def log(msg: str, debug_only: bool = False, debug: bool = False):
    if debug_only and not debug:
        return
    print(msg, file=sys.stderr)


def get_soup(url: str, session: requests.Session, timeout: int = 20) -> BeautifulSoup:
    resp = session.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def unescape_js_string(s: str) -> str:
    """Desescapa el string que Next.js mete en self.__next_f.push([1, "..."])."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == "\\" and i + 1 < n:
            nxt = s[i + 1]
            if nxt == "n":
                out.append("\n")
                i += 2
                continue
            if nxt == "t":
                out.append("\t")
                i += 2
                continue
            if nxt in '"\\/':
                out.append(nxt)
                i += 2
                continue
            if nxt == "u" and i + 5 < n:
                try:
                    out.append(chr(int(s[i + 2 : i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
        out.append(s[i])
        i += 1
    return "".join(out)


def extraer_flight(html: str) -> str:
    return unescape_js_string("".join(FLIGHT_PUSH_RE.findall(html)))


def parsear_chunks(flight: str) -> dict:
    chunks = {}
    matches = list(CHUNK_ID_RE.finditer(flight))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(flight)
        chunks[m.group(1)] = flight[start:end].strip()
    return chunks


def expandir_lrefs(texto: str, chunks: dict, depth: int = 0, seen: Optional[set] = None) -> str:
    """Reemplaza "$Lxx" por el contenido del chunk, para armar las cards completas."""
    if seen is None:
        seen = set()
    if depth > 40:
        return texto

    def repl(m):
        cid = m.group(1)
        if cid in seen or cid not in chunks:
            return m.group(0)
        seen.add(cid)
        return expandir_lrefs(chunks[cid], chunks, depth + 1, seen)

    return LREF_RE.sub(repl, texto)


def parsear_precio(texto: Optional[str]) -> Optional[int]:
    """Convierte '24.000' o '24.000,50' en un entero de pesos (redondea centavos)."""
    if not texto:
        return None
    limpio = texto.replace(".", "").split(",")[0]
    return int(limpio) if limpio.isdigit() else None


def inferir_cadena(slug: str, etiqueta: str) -> str:
    if etiqueta:
        return etiqueta
    slug_l = slug.lower()
    for prefijo, nombre in CADENA_POR_SLUG:
        if slug_l.startswith(prefijo):
            return nombre
    return "Independiente"


def parsear_card(slug: str, fragmento: str) -> Optional[dict]:
    """Saca cadena / nombre / dirección / 'sin funciones' de un fragmento de card."""
    if "Sin funciones" in fragmento:
        return None
    strings = re.findall(r'"children":"([^"]+)"', fragmento)
    cadena = ""
    nombre = ""
    direccion = ""
    if strings:
        cadena = strings[0]
        if len(strings) > 1:
            nombre = strings[1]
        if len(strings) > 2:
            direccion = strings[2]
    pelis = None
    pm = PELICULAS_RE.search(fragmento)
    if pm:
        pelis = int(pm.group(1))
        if pelis == 0:
            return None
    return {
        "slug": slug,
        "cadena": inferir_cadena(slug, cadena),
        "nombre": nombre or slug.replace("-", " ").title(),
        "direccion": direccion,
        "pelis": pelis,
    }


def extraer_cards(cuerpo: str) -> list:
    """Parte un bloque de zona en cards por href=/cine/slug."""
    cards = []
    vistos = set()
    partes = re.split(r'"href":"/cine/', cuerpo)
    for parte in partes[1:]:
        m = re.match(r"([a-z0-9-]+)", parte)
        if not m:
            continue
        slug = m.group(1)
        if slug in vistos:
            continue
        vistos.add(slug)
        card = parsear_card(slug, parte[:3000])
        if card:
            cards.append(card)
    return cards


def listar_zonas_y_cines(html: str, debug: bool = False) -> tuple:
    """
    Parsea /cines y devuelve (zonas_en_orden, {zona: [card, ...]}).
    Las zonas son las que publica cartelera.ar en los <section> del listado.
    """
    flight = extraer_flight(html)
    if not flight:
        log("  [debug] no se encontró payload RSC en /cines", True, debug)
        return [], {}

    chunks = parsear_chunks(flight)
    secciones = [
        (m.group(1), m.start())
        for m in SECTION_RE.finditer(flight)
        if not m.group(1).isdigit()
    ]
    # Nos quedamos con la primera aparición de cada zona (el stream a veces
    # duplica el árbol cuando se concatenan los chunks).
    vistas = set()
    unicas = []
    for nombre, pos in secciones:
        if nombre in vistas:
            continue
        vistas.add(nombre)
        unicas.append((nombre, pos))

    por_zona = {}
    for i, (zona, pos) in enumerate(unicas):
        siguiente_zona = unicas[i + 1][1] if i + 1 < len(unicas) else len(flight)
        # El JSON de la sección termina al arrancar el próximo chunk del
        # flight (`\n54:...`). Si no recortamos ahí, la última zona se come
        # las cards diferidas de las anteriores.
        siguiente_chunk = CHUNK_ID_RE.search(flight, pos + 1)
        fin = siguiente_zona
        if siguiente_chunk is not None:
            fin = min(fin, siguiente_chunk.start())
        cuerpo = expandir_lrefs(flight[pos:fin], chunks)
        otras = list(SECTION_RE.finditer(cuerpo))
        if len(otras) > 1:
            cuerpo = cuerpo[: otras[1].start()]
        cards = extraer_cards(cuerpo)
        por_zona[zona] = cards
        log(f"  zona {zona}: {len(cards)} cines con funciones", True, debug)

    return [z for z, _ in unicas], por_zona


def resolver_zonas_pedidas(pedido: str, zonas_disponibles: list) -> list:
    """
    Interpreta --zonas. Acepta nombres publicados (CABA, GBA Norte, ...),
    alias (caba, gba) y 'todas'.
    """
    disponibles_lower = {z.lower(): z for z in zonas_disponibles}
    if not pedido or pedido.strip().lower() in ("todas", "all", "*"):
        if pedido and pedido.strip().lower() in ("todas", "all", "*"):
            return list(zonas_disponibles)
        # Default: CABA + GBA, en el orden en que las publica el sitio.
        return [z for z in zonas_disponibles if z in ZONAS_AMBA] or list(ZONAS_AMBA)

    pedidas = []
    vistas = set()
    for raw in pedido.split(","):
        token = raw.strip()
        if not token:
            continue
        key = re.sub(r"\s+", " ", token.lower().replace("_", " "))
        if key in ("todas", "all", "*"):
            for z in zonas_disponibles:
                if z not in vistas:
                    pedidas.append(z)
                    vistas.add(z)
            continue
        if key in ZONA_ALIASES:
            for z in ZONA_ALIASES[key]:
                if z not in vistas:
                    pedidas.append(z)
                    vistas.add(z)
            continue
        if key in disponibles_lower:
            z = disponibles_lower[key]
            if z not in vistas:
                pedidas.append(z)
                vistas.add(z)
            continue
        # Prefijo: "gba" ya está en alias; "córdoba" vs "cordoba"
        key_norm = (
            key.replace("á", "a")
            .replace("é", "e")
            .replace("í", "i")
            .replace("ó", "o")
            .replace("ú", "u")
        )
        match = None
        for z in zonas_disponibles:
            z_norm = (
                z.lower()
                .replace("á", "a")
                .replace("é", "e")
                .replace("í", "i")
                .replace("ó", "o")
                .replace("ú", "u")
            )
            if z_norm == key_norm or z_norm.startswith(key_norm):
                match = z
                break
        if match is None:
            raise ValueError(token)
        if match not in vistas:
            pedidas.append(match)
            vistas.add(match)
    return pedidas


def cadena_matchea(cadena: str, slug: str, filtros: tuple) -> bool:
    if not filtros:
        return True
    blob = f"{cadena} {slug}".lower()
    return any(f in blob for f in filtros)


def listar_cines(
    session: requests.Session,
    zonas_pedido: str,
    cadenas: tuple,
    debug: bool = False,
) -> list:
    """Trae /cines y devuelve los cines de las zonas pedidas."""
    resp = session.get(f"{BASE_URL}/cines", headers=HEADERS, timeout=20)
    resp.raise_for_status()

    zonas_disponibles, por_zona = listar_zonas_y_cines(resp.text, debug=debug)
    if not zonas_disponibles:
        log("No se pudieron leer las zonas de /cines.")
        return []

    log(f"Zonas en cartelera.ar: {', '.join(zonas_disponibles)}")
    try:
        zonas = resolver_zonas_pedidas(zonas_pedido, zonas_disponibles)
    except ValueError as e:
        log(
            f"Zona no reconocida: {e}. "
            f"Disponibles: {', '.join(zonas_disponibles)} "
            f"(alias: caba, gba, amba, todas)"
        )
        sys.exit(1)

    log(f"Filtrando zonas: {', '.join(zonas)}")

    cines = []
    vistos = set()
    for zona in zonas:
        for card in por_zona.get(zona, []):
            slug = card["slug"]
            if slug in vistos:
                continue
            if not cadena_matchea(card["cadena"], slug, cadenas):
                log(f"  (omitido, cadena): {slug}", True, debug)
                continue
            vistos.add(slug)
            cines.append(
                Cine(
                    cadena=card["cadena"],
                    nombre=card["nombre"],
                    slug=slug,
                    zona=zona,
                    direccion=card["direccion"],
                )
            )
    return cines


FILENAME_INVALID_RE = re.compile(r'[\\/:*?"<>|]')


def resolver_url_real(url: str) -> str:
    """
    Si la URL es un proxy de Next.js (/_next/image?url=...), extrae la URL
    real de la imagen (ej. la de TMDB) del parámetro 'url'. Si no, la
    devuelve tal cual.
    """
    partes = urlparse(url)
    if "/_next/image" in partes.path:
        qs = parse_qs(partes.query)
        real = qs.get("url", [None])[0]
        if real:
            return unquote(real)
    return url


def nombre_archivo_desde_url(url: str) -> str:
    """Genera un nombre de archivo válido (sin caracteres prohibidos) a partir de una URL."""
    url_real = resolver_url_real(url)
    path = urlparse(url_real).path
    filename = path.rsplit("/", 1)[-1] if path else ""
    filename = FILENAME_INVALID_RE.sub("_", filename)
    if not filename or "." not in filename:
        filename = "poster.jpg"
    return filename


def descargar_imagen(url: str, session: requests.Session, output_dir: str = "public/posters") -> str:
    """Descarga la imagen de la película y devuelve la ruta local."""
    try:
        # Si es una URL de proxy (/_next/image?url=...), pedimos la imagen
        # real directamente: es más liviano y evita depender del proxy.
        url_descarga = resolver_url_real(url)

        resp = session.get(url_descarga, headers=HEADERS, timeout=10)
        resp.raise_for_status()

        # Crear directorio si no existe
        os.makedirs(output_dir, exist_ok=True)

        # Generar nombre de archivo válido desde la URL
        filename = nombre_archivo_desde_url(url)

        local_path = os.path.join(output_dir, filename)

        with open(local_path, "wb") as f:
            f.write(resp.content)

        return f"/posters/{filename}"
    except Exception as e:
        log(f"    !! error al descargar imagen: {e}")
        return ""


def parsear_cine(slug: str, session: requests.Session, fecha: Optional[str], debug: bool = False, descargar_imagenes: bool = False):
    """Trae /cine/{slug} y devuelve (nombre_real, [Pelicula, ...])."""
    url = f"{BASE_URL}/cine/{slug}"
    if fecha:
        url += f"?date={fecha}"

    soup = get_soup(url, session)

    h1 = soup.find("h1")
    nombre_real = h1.get_text(strip=True) if h1 else slug

    # Next.js streamea la cartelera a un slot #S:0 hermano de <main>, no adentro.
    root = soup.find(id="S:0") or soup.find("main") or soup
    if not root.select('a[href^="/pelicula/"]'):
        root = soup

    peliculas_por_titulo = {}
    orden_titulos = []
    current_titulo = None
    current_formato = None
    current_precio_general = None
    current_precio_jubilado = None
    current_precio_menor = None

    for el in root.descendants:
        nombre_tag = getattr(el, "name", None)
        if nombre_tag is None:
            continue

        # Título de película: <a href="/pelicula/...">
        if nombre_tag == "a" and el.get("href", "").startswith("/pelicula/"):
            titulo = el.get_text(strip=True)
            if titulo and not TIME_RE.match(titulo):
                current_titulo = titulo
                current_formato = None
                current_precio_general = None
                current_precio_jubilado = None
                current_precio_menor = None
                if titulo not in peliculas_por_titulo:
                    href = el["href"]
                    url_pelicula = href if href.startswith("http") else BASE_URL + href
                    pelicula = Pelicula(titulo=titulo, url=url_pelicula)
                    
                    # Intentar obtener la imagen de la página de la película
                    if descargar_imagenes:
                        try:
                            peli_soup = get_soup(url_pelicula, session, timeout=10)
                            img_tag = peli_soup.find("img", alt=lambda x: x and titulo.lower() in x.lower())
                            if img_tag and img_tag.get("src"):
                                img_url = img_tag["src"]
                                if not img_url.startswith("http"):
                                    img_url = urljoin(BASE_URL, img_url)
                                pelicula.imagen = descargar_imagen(img_url, session)
                        except Exception as e:
                            log(f"    !! error al obtener imagen de {titulo}: {e}", True, debug)
                    
                    peliculas_por_titulo[titulo] = pelicula
                    orden_titulos.append(titulo)
            continue

        # Horario: cualquier <a> cuyo texto sea HH:MM
        if nombre_tag == "a":
            txt = el.get_text(strip=True)
            if TIME_RE.match(txt) and current_titulo is not None:
                peliculas_por_titulo[current_titulo].funciones.append(
                    Funcion(
                        horario=txt,
                        formato=current_formato or "2D",
                        precio_general=current_precio_general,
                        precio_jubilado=current_precio_jubilado,
                        precio_menor=current_precio_menor,
                    )
                )
            continue

        # Precio: bloque tipo "$24.000Jub. $17.000Men. $17.000", pegado
        # justo antes de los horarios de cada formato. Exigimos que empiece
        # con "$" y contenga "Jub"/"Men" para no matchear los fragmentos
        # sueltos ("$17.000" solo, o "Jub. $17.000" solo) que aparecen al
        # recorrer los hijos del mismo bloque.
        if current_titulo is not None:
            txt = el.get_text(strip=True)
            if txt.startswith("$") and ("Jub" in txt or "Men" in txt) and len(txt) < 80:
                m = PRICE_RE.match(txt)
                if m:
                    current_precio_general = parsear_precio(m.group(1))
                    current_precio_jubilado = parsear_precio(m.group(2))
                    current_precio_menor = parsear_precio(m.group(3))
                continue

        # Etiqueta de formato: texto corto tipo "2D Subtitulada"
        if current_titulo is not None:
            txt = el.get_text(strip=True)
            if txt and len(txt) < 40 and FORMAT_RE.search(txt):
                current_formato = txt

    peliculas = [peliculas_por_titulo[t] for t in orden_titulos if peliculas_por_titulo[t].funciones]

    if debug and not peliculas:
        log(f"  [debug] no se encontraron funciones parseables en {url}", True, debug)

    return nombre_real, peliculas


def escanear(
    zonas_pedido: str,
    cadenas: tuple,
    fecha: Optional[str],
    delay: float,
    debug: bool = False,
    descargar_imagenes: bool = False,
) -> list:
    session = requests.Session()

    log("Buscando cines en cartelera.ar ...")
    cines = listar_cines(session, zonas_pedido, cadenas, debug=debug)
    log(f"Encontrados {len(cines)} cines.\n")

    resultado = []
    for i, cine in enumerate(cines, 1):
        log(f"[{i}/{len(cines)}] {cine.zona} — {cine.cadena} — {cine.nombre} ({cine.slug})")
        try:
            nombre_real, peliculas = parsear_cine(cine.slug, session, fecha, debug=debug, descargar_imagenes=descargar_imagenes)
            cine.nombre = nombre_real
            cine.peliculas = peliculas
            log(f"    -> {len(peliculas)} películas con horarios")
        except requests.RequestException as e:
            log(f"    !! error al pedir la página: {e}")
        resultado.append(cine)
        time.sleep(delay)

    return resultado


def exportar_json(cines: list, path: str):
    data = [asdict(c) for c in cines]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fecha_argentina_hoy() -> str:
    return datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date().isoformat()


def filtrar_funciones_pasadas(cines: list, fecha: Optional[str]):
    """Quita funciones vencidas y películas que se quedaron sin funciones futuras."""
    fecha_objetivo = fecha or fecha_argentina_hoy()
    hoy = fecha_argentina_hoy()
    if fecha_objetivo > hoy:
        return

    ahora = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).strftime("%H:%M")
    for cine in cines:
        peliculas_vigentes = []
        for peli in cine.peliculas:
            if fecha_objetivo < hoy:
                peli.funciones = []
            elif fecha_objetivo == hoy:
                peli.funciones = [f for f in peli.funciones if f.horario >= ahora]
            if peli.funciones:
                peliculas_vigentes.append(peli)
        cine.peliculas = peliculas_vigentes


def limpiar_posters_no_usados(cines: list, output_dir: str = "public/posters"):
    """Borra posters locales que ya no están referenciados por la cartelera vigente."""
    if not os.path.isdir(output_dir):
        return

    usados = set()
    for cine in cines:
        for peli in cine.peliculas:
            imagen = getattr(peli, "imagen", "") or ""
            if imagen.startswith("/posters/"):
                usados.add(os.path.basename(imagen))

    for filename in os.listdir(output_dir):
        path = os.path.join(output_dir, filename)
        if os.path.isfile(path) and filename not in usados:
            os.remove(path)


def exportar_csv(cines: list, path: str):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "zona", "cadena", "cine", "direccion", "pelicula", "formato",
                "horario", "precio_general", "precio_jubilado", "precio_menor",
                "url_pelicula",
            ]
        )
        for cine in cines:
            for peli in cine.peliculas:
                for func in peli.funciones:
                    writer.writerow(
                        [
                            cine.zona,
                            cine.cadena,
                            cine.nombre,
                            cine.direccion,
                            peli.titulo,
                            func.formato,
                            func.horario,
                            func.precio_general if func.precio_general is not None else "",
                            func.precio_jubilado if func.precio_jubilado is not None else "",
                            func.precio_menor if func.precio_menor is not None else "",
                            peli.url,
                        ]
                    )


def imprimir_resumen(cines: list):
    total_funciones = sum(len(p.funciones) for c in cines for p in c.peliculas)
    print(f"\n=== Resumen: {len(cines)} cines, {total_funciones} funciones ===\n")
    zona_actual = None
    for cine in cines:
        if not cine.peliculas:
            continue
        if cine.zona != zona_actual:
            zona_actual = cine.zona
            print(f"## {zona_actual}")
        print(f"### {cine.cadena} — {cine.nombre}")
        if cine.direccion:
            print(f"    {cine.direccion}")
        for peli in cine.peliculas:
            horarios = ", ".join(f"{f.horario} ({f.formato})" for f in peli.funciones)
            print(f"  - {peli.titulo}: {horarios}")
            precios = {
                (f.formato, f.precio_general, f.precio_jubilado, f.precio_menor)
                for f in peli.funciones
                if f.precio_general is not None
            }
            for formato, general, jubilado, menor in sorted(precios):
                extra = []
                if jubilado is not None:
                    extra.append(f"Jub. ${jubilado:,}".replace(",", "."))
                if menor is not None:
                    extra.append(f"Men. ${menor:,}".replace(",", "."))
                extra_str = f" ({', '.join(extra)})" if extra else ""
                print(f"      {formato}: ${general:,}".replace(",", ".") + extra_str)
        print()


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Escanea horarios de cine en CABA y GBA (todas las cadenas) "
            "usando las zonas de cartelera.ar."
        )
    )
    parser.add_argument(
        "--zonas",
        default="caba,gba",
        help=(
            "Zonas a incluir, separadas por coma. "
            "Default: caba,gba (CABA + GBA Norte/Sur/Oeste). "
            "Valores: caba, gba, gba norte, gba sur, gba oeste, amba, todas, "
            "o el nombre publicado (Córdoba, Rosario, ...)."
        ),
    )
    parser.add_argument(
        "--cadenas",
        default="",
        help=(
            "Filtro opcional de cadenas, separadas por coma "
            "(ej. cinemark,atlas,cinepolis). Default: todas."
        ),
    )
    parser.add_argument("--fecha", default=None, help="Fecha en formato YYYY-MM-DD (default: hoy).")
    parser.add_argument("--json", default="cartelera.json", help="Archivo JSON de salida.")
    parser.add_argument("--csv", default="cartelera.csv", help="Archivo CSV de salida.")
    parser.add_argument("--delay", type=float, default=1.0, help="Segundos entre pedidos (default 1.0).")
    parser.add_argument("--debug", action="store_true", help="Mostrar info extra de diagnóstico.")
    parser.add_argument(
        "--no-descargar-imagenes",
        dest="descargar_imagenes",
        action="store_false",
        help="Desactivar la descarga de imágenes (por defecto SÍ se descargan).",
    )
    parser.set_defaults(descargar_imagenes=True)
    args = parser.parse_args()

    cadenas = tuple(c.strip().lower() for c in args.cadenas.split(",") if c.strip())

    cines = escanear(args.zonas, cadenas, args.fecha, args.delay, debug=args.debug, descargar_imagenes=args.descargar_imagenes)

    filtrar_funciones_pasadas(cines, args.fecha)
    exportar_json(cines, args.json)
    if args.descargar_imagenes:
        limpiar_posters_no_usados(cines)
    exportar_csv(cines, args.csv)
    imprimir_resumen(cines)

    print(f"Guardado: {args.json} y {args.csv}")


if __name__ == "__main__":
    main()
