"""Lee los resúmenes de review de Copilot code review ("Copilot review overview").

Uso:
  hallazgos_copilot.py ultima <review.md> <url_pr> <pendientes.md> <abiertos.md>
      Hallazgos de la última review. Imprime "<high> <otros>" (-1 si el formato es desconocido),
      escribe los High/Critical en pendientes.md y todos en abiertos.md.
  hallazgos_copilot.py acumulado <reviews.json> <url_pr> <salida.md>
      Recorre todas las reviews en orden y escribe lo que nunca se marcó como resuelto.
      reviews.json es la lista de la API de GitHub (solo las de Copilot).
"""
import json
import re
import sys

GRAVES = ("High", "Critical")


def _severidad(html):
    m = re.search(r'alt="(\w+) severity"', html)
    return m.group(1) if m else "?"


def _bloque(cuerpo, titulo):
    m = re.search(r"<summary><strong>" + titulo + r" \(\d+\)</strong></summary>(.*?)</details>", cuerpo, re.S)
    return m.group(1) if m else None


def _limpiar(texto):
    texto = re.sub(r"<[^>]+>", "", texto).replace("\u200b", "")
    texto = re.sub(r"\]\(#[^)]*\)", "]", texto)
    return texto.replace("· New", "").strip()


def parsear(cuerpo, url_pr):
    """Devuelve (abiertos, resueltos, reconocido). Cada hallazgo es (clave, severidad, texto)."""
    abiertos, resueltos = [], set()
    reconocido = "ccr-overview" in cuerpo
    bloque = _bloque(cuerpo, "Open")
    if bloque:
        for linea in (l.strip() for l in bloque.splitlines()):
            if not linea.startswith("- "):
                continue
            enlace = re.search(r"\]\((#[^)]*)\)", linea)
            texto = _limpiar(linea[2:]) + (f" ({url_pr}{enlace.group(1)})" if enlace else "")
            clave = enlace.group(1) if enlace else texto
            abiertos.append((clave, _severidad(linea), texto))
    bloque = _bloque(cuerpo, "Resolved since last review")
    if bloque:
        resueltos.update(re.findall(r"\]\((#[^)]*)\)", bloque))
    # "Previously missed": hallazgos en código que no cambió; no tienen hilo propio.
    pos = cuerpo.find("<strong>Previously missed")
    if pos >= 0:
        for resumen, ubicacion in re.findall(r"<details>\s*<summary>(.*?)</summary>\s*`([^`]+)`", cuerpo[pos:], re.S):
            titulo = _limpiar(resumen)
            ubicacion = ubicacion.replace("\u200b", "")
            abiertos.append((titulo, _severidad(resumen), f"{titulo} (`{ubicacion}`)"))
    return abiertos, resueltos, reconocido


def _lineas(items):
    return "".join(f"- **{sev}** {texto}\n" for _, sev, texto in items)


def main():
    modo = sys.argv[1]
    if modo == "ultima":
        cuerpo = open(sys.argv[2], encoding="utf-8").read()
        abiertos, _, reconocido = parsear(cuerpo, sys.argv[3])
        graves = [h for h in abiertos if h[1] in GRAVES]
        open(sys.argv[4], "w", encoding="utf-8").write(_lineas(graves))
        open(sys.argv[5], "w", encoding="utf-8").write(_lineas(abiertos))
        if not reconocido:
            print(-1, 0)
        else:
            print(len(graves), len(abiertos) - len(graves))
    elif modo == "acumulado":
        reviews = json.load(open(sys.argv[2], encoding="utf-8"))
        pendientes = {}
        for review in sorted(reviews, key=lambda r: r.get("submitted_at") or ""):
            abiertos, resueltos, _ = parsear(review.get("body") or "", sys.argv[3])
            for clave, sev, texto in abiertos:
                pendientes[clave] = (clave, sev, texto)
            for clave in resueltos:
                pendientes.pop(clave, None)
        orden = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
        items = sorted(pendientes.values(), key=lambda h: orden.get(h[1], 9))
        open(sys.argv[4], "w", encoding="utf-8").write(_lineas(items))
    else:
        sys.exit(f"modo desconocido: {modo}")


if __name__ == "__main__":
    main()
