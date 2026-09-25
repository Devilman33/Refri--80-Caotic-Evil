# Calidad de vida · qué se hizo y qué queda

Cierre del issue #8: *"Implementa las que aporten más con poco riesgo y documenta el resto"*.
Este documento es la segunda mitad de esa frase.

## Las siete ideas del issue

| Idea | Estado | Dónde |
|---|---|---|
| Exportar a CSV/Excel el resultado de una búsqueda | **Hecho** (CSV; xlsx no) | `GET /samples/export`, botón en la barra de filtros |
| Pegar o escanear un listado de IDs para buscarlos juntos | **Hecho** | `GET /samples/by-ids`, `IdListSearch` |
| Mover una muestra de posición con trazabilidad | **Hecho** | acción `move` en `movements`, `MoveModal` |
| Alertas de cajas casi llenas y muestras sin encargado | **Hecho** | `GET /alerts`, `AlertsPanel` |
| Página de anomalías del importador | **Hecho** | `import_runs` / `import_anomalies`, `AnomaliesView` |
| Autenticación simple por usuario | **Diferida** | `docs/adr/0002-autenticacion.md` |
| Respaldo y restauración documentados | **Hecho** | `docs/RESPALDO.md`, `scripts/backup.sh`, verificado en CI |

Seis de siete implementadas. La séptima tiene un ADR con el riesgo aceptado escrito,
el diseño elegido y el conflicto con `docs/FORMULARIO.md` que hay que resolver antes.

## Lo que queda, en orden de lo que más duele

### 1. Dos personas editando la misma muestra (lost update)

`PATCH /samples/{id}` no tiene control de concurrencia: el último que guarda gana, y
el primero nunca se entera de que su cambio desapareció. Con dos personas frente al
mismo freezer y una tablet cada una, esto pasa.

**Arreglo:** una columna `version` (o `updated_at`) que el PATCH reciba y compare; si no
coincide, 409 con los valores actuales y que la interfaz muestre "alguien más editó esto
mientras tanto". Es la misma forma del 409 que ya usa el traslado, así que el frontend ya
sabe mostrarlo.

**Por qué no se hizo ahora:** toca el esquema, el endpoint, el schema de Pydantic y el
modal, y el issue #8 es de calidad de vida. Merece su propio issue, no un renglón de este.

### 2. Exportar a xlsx además de CSV

El CSV sale con BOM UTF-8 y con las fórmulas neutralizadas, así que Excel lo abre bien y
sin ejecutar nada. Lo que no tiene es formato: ancho de columnas, encabezado fijo, fechas
como fecha en vez de texto.

**Arreglo:** `openpyxl` en modo `write_only` (streaming, sin armar el libro en memoria) y un
segundo valor de `?format=xlsx`. El tope de 25.000 filas ya está, y con xlsx importa más:
un libro en memoria de 25.000 filas es caro donde el CSV es gratis.

**Por qué no se hizo ahora:** una dependencia nueva para una mejora de presentación. El
CSV resuelve el caso real (abrir el resultado en Excel y trabajarlo).

### 3. Navegar el mapa de posiciones con el teclado

`PositionPicker` responde a clicks y a Tab, pero no a las flechas. En una grilla de 9×9 o
10×10 eso son hasta 100 tabulaciones para llegar a la posición de abajo a la derecha.

**Arreglo:** el patrón de grilla de WAI-ARIA — un solo `tabindex="0"` (el foco actual, el
resto en `-1`), flechas para moverse, Home/End para los extremos de la fila,
Ctrl+Home/Ctrl+End para los de la grilla.

**Por qué no se hizo ahora:** es accesibilidad real, no cosmética, pero el picker ya es
usable por teclado hoy. Va cuando alguien lo pida o cuando se toque el componente.

### 4. Reingresar una muestra que se descongeló

Hoy un retiro (`thaw`) libera la posición y ahí termina. Si la muestra vuelve al freezer,
se registra como ingreso nuevo y se pierde el vínculo con la anterior.

**Lo que hay que decidir primero:** `environ_id` es el **código de origen del espécimen**,
no el identificador de un tubo (`docs/DATOS.md`). Un mismo ID cubre decenas o cientos de
tubos. Entonces "la muestra que salió el martes y volvió el jueves" no se puede identificar
con los datos que hoy existen: haría falta un identificador físico del tubo, que es una
decisión del laboratorio sobre cómo rotula, no una decisión de software.

**Por qué no se hizo ahora:** implementarlo sin ese identificador significa adivinar, y
adivinar acá produce trazabilidad falsa, que es peor que no tenerla.

### 5. Compartir una búsqueda por link

Los filtros viven en el estado de React. No se pueden mandar por chat, ni dejar en un
favorito, ni recuperar con el botón atrás del navegador.

**Arreglo:** los filtros a la query string con `URLSearchParams`, leídos al montar. `SampleFilters`
ya es plano y serializable, así que el backend no cambia.

**Por qué no se hizo ahora:** hay que decidir qué pasa con el botón atrás (¿cada tecleo es
una entrada en el historial?) y eso es diseño, no plomería. Con el debounce de 300 ms que
ya tienen los campos de texto, la respuesta razonable es `replaceState` mientras se escribe
y `pushState` al cambiar de vista, pero conviene verlo funcionando antes de fijarlo.

### 6. Autenticación

En `docs/adr/0002-autenticacion.md`, con el riesgo aceptado escrito y la recomendación
(empezar por el reverse proxy). Lo único que hay que releer antes de exponer esto fuera
de la red del laboratorio.

## Lo que se arregló de paso

El issue traía además 33 hallazgos de revisiones anteriores. Los que cambiaron
comportamiento, resumidos:

- **Movimientos**: el endpoint aceptaba cualquier `action` y creaba filas sin efecto.
  Ahora valida, y `thaw` baja el `is_full` de la caja que dejó de estarlo.
- **Importador**: las filas ya importadas salteaban el parseo, así que la serie de calidad
  de datos mentía — decía que el Excel mejoraba cuando lo único que pasaba era que la
  segunda corrida no miraba. Ahora parsea siempre y saltea solo la escritura.
- **Semáforo**: rojo y verde eran el único indicador. Ahora además la posición ocupada se
  rellena y la libre queda hueca, con leyenda, para quien no distingue rojo de verde.
- **Cajas llenas con huecos**: `is_full` podía quedar en `true` con posiciones libres.
  Es un quinto nivel de ocupación ("inconsistente") con su alerta, no un redondeo.
- **Layout**: `seed` validaba poco y la restricción de racks no era diferible, así que
  reordenar `layout.yaml` fallaba a mitad de camino.
- **`DATABASE_URL`**: tenía un default que apuntaba a localhost. Arrancar mal configurado
  y escribir en la base equivocada era posible; ahora falla al arrancar con instrucciones.

Una última pasada, después de mergear las tres PRs, volvió a revisar uno por uno los
hallazgos de los comentarios del issue contra `main`. Quedaban tres: el importador aceptaba
`Caja` por encima de 30, la tabla mostraba "—" en vez de la marca "sin ID", y el retiro
relajaba campos del Google Form sin que estuviera escrito en `docs/FORMULARIO.md`. Los dos
primeros se arreglaron y el tercero quedó documentado como desviación deliberada. De los
demás, el único que no se implementó es el reingreso de una muestra retirada (punto 4 de
arriba), y la fecha de salida con formato de fecha en Excel no se guarda como nota porque
no trae texto que guardar.

## Cómo seguir

Cada punto de arriba alcanza para un issue. El orden sugerido es el de la lista: el
lost-update es el único que puede perder trabajo de alguien.
