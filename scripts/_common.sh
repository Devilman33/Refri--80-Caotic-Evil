#!/bin/sh
# Utilidades compartidas por backup.sh y restore.sh.
#
# POSIX sh a propósito, sin flags de GNU: el mantenedor del proyecto está en Windows y
# estos scripts se corren con Git Bash. Cualquier `bash`ismo los rompería justo en la
# máquina donde más falta hacen.

set -eu

# La app usa la URL de SQLAlchemy (`postgresql+psycopg://…`). Las herramientas de Postgres
# no entienden el sufijo del dialecto, así que hay que sacárselo. Sin esto, pg_dump falla
# con "invalid URI scheme" y el mensaje no explica por qué.
libpq_url() {
    printf '%s' "$1" | sed 's|^postgresql+[a-z0-9_]*://|postgresql://|'
}

# Nombre de base desde la URL: todo lo que va después del último "/", sin querystring.
database_name_from_url() {
    printf '%s' "$1" | sed 's|.*/||' | sed 's|?.*||'
}

# Resuelve la URL desde --database-url o DATABASE_URL. Nunca inventa un default: conectarse
# "a algo" por descarte es cómo se termina respaldando la base equivocada.
resolve_database_url() {
    _url="${1:-}"
    if [ -z "$_url" ]; then
        _url="${DATABASE_URL:-}"
    fi
    if [ -z "$_url" ]; then
        echo "Falta la base de datos: no se pasó --database-url ni está DATABASE_URL." >&2
        echo "  Este script NO asume una base por defecto a propósito: respaldar o restaurar" >&2
        echo "  la equivocada es peor que no hacer nada." >&2
        echo "" >&2
        echo "  Ejemplo:" >&2
        echo "    DATABASE_URL=postgresql://refri:refri@localhost:5432/refri $0 ..." >&2
        return 2
    fi
    printf '%s' "$_url"
}

# pg_dump/pg_restore no siempre están instalados en la máquina (en Windows es lo normal).
# El contenedor `db` de docker compose siempre los tiene, así que se usa como plan B.
require_pg_tool() {
    _tool="$1"
    if command -v "$_tool" >/dev/null 2>&1; then
        return 0
    fi
    echo "No se encontró '$_tool' en el PATH." >&2
    echo "  Opción A: instalá el cliente de PostgreSQL 16 o mayor." >&2
    echo "  Opción B (sin instalar nada): corré el comando dentro del contenedor, que ya lo" >&2
    echo "            trae. Ver docs/RESPALDO.md, sección 'Sin cliente de Postgres'." >&2
    return 3
}

# pg_dump se niega a volcar desde un servidor más nuevo que él. Es mejor cortar acá, con
# un mensaje que lo diga, que dejar un respaldo a medias.
warn_if_client_is_old() {
    _version="$(pg_dump --version 2>/dev/null | sed 's|[^0-9]*\([0-9]*\).*|\1|')"
    if [ -n "$_version" ] && [ "$_version" -lt 16 ] 2>/dev/null; then
        echo "Aviso: pg_dump es versión $_version y el servidor es PostgreSQL 16." >&2
        echo "  pg_dump se niega a volcar desde un servidor más nuevo que él." >&2
        return 3
    fi
    return 0
}
