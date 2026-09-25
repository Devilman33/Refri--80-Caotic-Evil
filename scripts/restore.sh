#!/bin/sh
# Restauración de la base del inventario. DESTRUCTIVO.
#
#   ./scripts/restore.sh --file backups/refri-20260925-021500.dump --database refri --yes
#
# Reemplaza el contenido de la base por el del archivo. Lo que haya ahora se pierde.
#
# Por eso pide tres cosas y no una:
#   --file      el respaldo a restaurar
#   --database  el nombre de la base destino, ESCRITO A MANO
#   --yes       confirmación explícita
#
# El nombre escrito a mano tiene que coincidir con el de DATABASE_URL. Es la misma guarda
# que el repo ya usa en backend/tests/conftest.py para no borrar la base de desarrollo
# desde los tests: dos fuentes que tienen que decir lo mismo, y si difieren se corta.
#
# Códigos de salida:
#   0  restauración terminada
#   2  falta la URL, el archivo, el nombre de base o --yes
#   3  falta pg_restore
#   4  el nombre de base no coincide con DATABASE_URL
#   5  pg_restore falló

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/_common.sh"

DATABASE_URL_ARG=""
DUMP_FILE=""
DB_ARG=""
CONFIRMED="no"

while [ $# -gt 0 ]; do
    case "$1" in
        --database-url) DATABASE_URL_ARG="${2:-}"; shift 2 ;;
        --file)         DUMP_FILE="${2:-}";        shift 2 ;;
        --database)     DB_ARG="${2:-}";           shift 2 ;;
        --yes)          CONFIRMED="si";            shift ;;
        -h|--help)
            sed -n '2,22p' "$0" | sed 's|^# \{0,1\}||'
            exit 0
            ;;
        *)
            echo "Opción desconocida: $1" >&2
            exit 2
            ;;
    esac
done

URL="$(resolve_database_url "$DATABASE_URL_ARG")"
PG_URL="$(libpq_url "$URL")"
URL_DB="$(database_name_from_url "$PG_URL")"

if [ -z "$DUMP_FILE" ]; then
    echo "Falta --file: no se dijo qué respaldo restaurar." >&2
    exit 2
fi

if [ ! -f "$DUMP_FILE" ]; then
    echo "El archivo '$DUMP_FILE' no existe." >&2
    echo "  Respaldos disponibles:" >&2
    ls -1t backups/*.dump 2>/dev/null | head -5 >&2 || echo "    (ninguno en backups/)" >&2
    exit 2
fi

if [ -z "$DB_ARG" ]; then
    echo "Falta --database." >&2
    echo "  Escribí a mano el nombre de la base que vas a REEMPLAZAR: '$URL_DB'." >&2
    echo "  Se pide aparte de DATABASE_URL justamente para que no sea automático." >&2
    exit 2
fi

if [ "$DB_ARG" != "$URL_DB" ]; then
    echo "El nombre de base no coincide, y por eso no se hace nada:" >&2
    echo "  --database dice:  '$DB_ARG'" >&2
    echo "  DATABASE_URL dice: '$URL_DB'" >&2
    echo "  Una de las dos está equivocada. Revisá cuál antes de seguir." >&2
    exit 4
fi

if [ "$CONFIRMED" != "si" ]; then
    echo "Falta --yes." >&2
    echo "" >&2
    echo "  Esto REEMPLAZA el contenido de la base '$URL_DB' por el de" >&2
    echo "  '$DUMP_FILE'. Las muestras y los movimientos que haya ahora y no estén en ese" >&2
    echo "  archivo se pierden." >&2
    echo "" >&2
    echo "  Antes de correrlo, frená el backend para que no escriba a mitad de camino:" >&2
    echo "    docker compose stop backend" >&2
    echo "" >&2
    echo "  Si es lo que querés, volvé a correrlo agregando --yes." >&2
    exit 2
fi

require_pg_tool pg_restore

echo "Restaurando '$DUMP_FILE' sobre la base '$URL_DB'…"

# --clean --if-exists borra los objetos antes de recrearlos; sin eso, restaurar sobre una
# base con datos falla con errores de "ya existe" en cada tabla.
# --single-transaction: o entra todo o no entra nada. Una restauración a medias dejaría el
# inventario en un estado que nadie sabe leer.
if ! pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
        --dbname="$PG_URL" "$DUMP_FILE"; then
    echo "pg_restore falló. Por --single-transaction, la base quedó como estaba antes." >&2
    exit 5
fi

echo "Restauración terminada."
echo "Levantá el backend de nuevo:"
echo "  docker compose start backend"
