#!/bin/sh
# Respaldo de la base del inventario.
#
#   ./scripts/backup.sh [--database-url URL] [--out DIR]
#
# Sale con 0 si el respaldo quedó escrito, y distinto de 0 si no. Eso importa más de lo
# que parece: un respaldo que falla en silencio es peor que no tener respaldo, porque da
# falsa confianza. Si lo ponés en cron o en el Programador de tareas, hacé que te avise
# cuando el código de salida no sea 0 (ver docs/RESPALDO.md).
#
# Códigos de salida:
#   0  respaldo escrito y verificado
#   2  falta la URL de la base
#   3  falta pg_dump, o es más viejo que el servidor
#   4  pg_dump falló (base caída, credenciales, disco lleno)

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/_common.sh"

DATABASE_URL_ARG=""
OUT_DIR="backups"

while [ $# -gt 0 ]; do
    case "$1" in
        --database-url)
            DATABASE_URL_ARG="${2:-}"
            shift 2
            ;;
        --out)
            OUT_DIR="${2:-}"
            shift 2
            ;;
        -h|--help)
            sed -n '2,15p' "$0" | sed 's|^# \{0,1\}||'
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
DB_NAME="$(database_name_from_url "$PG_URL")"

require_pg_tool pg_dump
warn_if_client_is_old

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$OUT_DIR/${DB_NAME}-${STAMP}.dump"

# Formato custom (-Fc): comprimido, y pg_restore puede restaurar selectivamente desde él.
# Un .sql plano solo se puede aplicar entero.
if ! pg_dump --format=custom --no-owner --no-privileges --file="$TARGET" "$PG_URL"; then
    echo "pg_dump falló. El archivo '$TARGET' no sirve; se borra para no dejar un respaldo" >&2
    echo "a medias que parezca bueno." >&2
    rm -f "$TARGET"
    exit 4
fi

# Un archivo de 0 bytes es un dump fallido que pg_dump creyó exitoso.
if [ ! -s "$TARGET" ]; then
    echo "El respaldo quedó vacío: '$TARGET'. Se borra." >&2
    rm -f "$TARGET"
    exit 4
fi

echo "Respaldo escrito: $TARGET"
echo "Para verificar el contenido sin restaurar:"
echo "  pg_restore --list \"$TARGET\" | head"
