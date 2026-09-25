# Plan · Rediseño del frontend (accesible, simple, sin AI-slop)

Objetivo: que la gente del laboratorio haga sus tareas de siempre (**congelar, descongelar,
encontrar una muestra, ver cuánto espacio queda**) sin pensar, desde una tablet frente al
freezer o un PC, y que la interfaz se vea hecha para este laboratorio, no generada.

Se hace con skills de gstack, en fases. Cada fase termina en un PR propio (ver `docs/BUCLE.md`).
Referencia visual: **`DESIGN.md`** (tokens, tipografía, semántica de estados, lo prohibido).

## Punto de partida

| Pieza | Estado hoy |
|---|---|
| Vistas | `3d` (inicial), `table`, `usage` como pestañas; `anomalies` sin pestaña, se llega desde Alertas (`App.tsx`, `ViewMode`) |
| Tareas (modales) | `FreezeForm`, `ThawForm`, `MoveModal`, `BoxMoveModal`, `SampleEditModal`, `SampleDetail`, `UsersModal`; `LoginScreen` es pantalla completa |
| Búsqueda | Por ID: solo en Vista tabla (`FiltersBar`, `IdListSearch`). En el 3D, "Buscar posición" solo acepta códigos de caja (`A5`, `A5-3B`) |
| Estilos | `styles/theme.css` de 1.687 líneas, tokens en `:root`, modo oscuro, turquesa Environ `#0c6575`, IBM Plex + Barlow |
| Estado | `App.tsx` (549 líneas) concentra vista, filtros, sesión y todos los modales |

## Restricciones que ninguna fase puede romper

Vienen de `requirements.md`, `docs/FORMULARIO.md`, `.github/copilot-instructions.md` y `DESIGN.md`:

- Luces: **rojo = ocupada, verde = libre**, más relleno/hueco para daltónicos.
- **Warning de Núcleo** visible en todas las vistas (hoy **falta en el visor 3D**, ver T6).
- Formulario de congelamiento con los campos, el orden y las opciones del Google Form, más las
  desviaciones escritas en `docs/FORMULARIO.md`. Cambiar el aspecto sí, los campos no.
- Mantener la estética e interacciones del visor 3D de `demo.html`.
- Vista tabla/lista sin 3D, % de uso, búsqueda con filtros que muestre la ubicación.
- Textos de la UI en español; `npm run build` y `npm test` en verde.

## Arquitectura de información (decidida)

Regla: **una vista es un lugar donde se mira el inventario; un modal es una tarea que escribe
algo y termina.** Mirar una muestra no escribe nada, así que el detalle deja de ser modal.

```
┌ Barra superior (fija, todas las vistas) ─────────────────────────────────────────┐
│ [logo] Refri -80   [ Buscar ID, ID Origen o ubicación… ]   [Congelar] [Descongelar] │
│                                          ⚠ 3 alertas   [Nombre ▾ ]                │
├ Vistas (control segmentado) ──────────────────────────────────────────────────────┤
│  Freezer 3D  │  Tabla  │  % de uso                                                │
├──────────────────────────────────────────────┬────────────────────────────────────┤
│ Vista activa                                 │ Panel de contexto (PC ≥1100px)     │
│  3D: escena                                  │  Muestra seleccionada (si hay)     │
│  Tabla: filtros + tabla + paginación         │  Caja seleccionada                 │
│  % de uso: tabla por sección/rack/caja       │  % de uso del rack                 │
└──────────────────────────────────────────────┴────────────────────────────────────┘
Menú de usuario (Nombre ▾): Usuarios · Modo claro/oscuro · Cambiar usuario
```

| Qué | Tipo | Cómo se llega |
|---|---|---|
| Freezer 3D (inicial en PC y tablet) | Vista | Pestaña |
| Tabla (inicial en teléfono < 700px) | Vista | Pestaña; buscador global con varios resultados |
| % de uso | Vista | Pestaña; alertas de cajas llenas |
| Anomalías | Vista **sin pestaña** | Desde Alertas; breadcrumb "← Volver a alertas" |
| Detalle de muestra | **Panel** (antes modal) | Clic en posición ocupada, fila de tabla, buscador global |
| Alertas | Panel desplegable bajo la barra | Chip "⚠ N alertas" (solo si N > 0) |
| Congelar | Modal | Botón fijo; clic en posición libre del 3D |
| Descongelar | Modal | Botón fijo; "Descongelar" en el detalle |
| Mover muestra, Editar muestra | Modal | Desde el detalle |
| Mover caja | Modal | "Mover caja" en Caja seleccionada (3D) o fila de % de uso |
| Usuarios | Modal | Menú de usuario |

Lo que cambia respecto de hoy:

1. **Buscador global** en la barra superior (decisión D1). Acepta ID Environ, ID Origen o
   ubicación (`A5`, `A5-3B`, `II · C4 · 5E`). Reemplaza "Buscar posición" del panel 3D.
   - 1 resultado activo → cambia al 3D, vuela a la caja, resalta la posición y abre el detalle.
   - Varios → Vista tabla con ese filtro aplicado y el chip "ID: ENV-02 ×".
   - Ubicación → 3D enfocado en esa caja/posición.
   - 0 → mensaje bajo el campo: "No hay muestras activas con «ENV-9999». ¿Buscar también retiradas?" (enlace a la tabla con estado = todas).
   - Teclado: `/` enfoca el buscador; flechas + Enter en las sugerencias.
2. **Detalle como panel** (D2). En el 3D va arriba del panel derecho ("Muestra seleccionada"),
   sobre "Caja seleccionada", y la posición queda resaltada en la escena. En Tabla: panel
   derecho en PC, hoja inferior (bottom sheet) en tablet/teléfono. Acciones: **Descongelar**
   (primario), Mover, Editar, **Ver en el refri** (solo fuera del 3D). Esc lo cierra.
3. Congelar y Descongelar salen de la fila de la vista y pasan a la barra superior: son las dos
   tareas más frecuentes y tienen que estar a un toque desde cualquier vista.
4. Usuarios, tema y "Cambiar usuario" van a un menú de usuario: se usan poco y hoy compiten con
   las tareas principales en el header.
5. "Buscar por lista de IDs" se queda en Vista tabla como acción de la barra de filtros.

## Flujos (decididos)

### F1 · Congelar varias muestras del mismo set (D4)

| Paso | Persona hace | Pantalla muestra |
|---|---|---|
| 1 | Toca **Congelar** (o una posición libre del 3D) | Modal con Operador = sesión, Fecha = hoy; si vino del 3D, caja y posición ya puestas |
| 2 | Escribe ID Environ | Autocompletado sugiere Tipo, Descripción, Pasaje, Núcleo, encargados y caja de otras muestras con ese ID (ya existe) |
| 3 | Completa, **Enter** | Acción primaria = **"Guardar y siguiente"**: guarda, deja todo menos la posición, avanza a la siguiente posición libre en orden de lectura de la caja, foco vuelve a **ID Environ** con el texto seleccionado |
| 4 | Repite 2–3 | Franja fija arriba del botón: "En esta tanda: 3 · 5A 5B 5C", cada una enlazable |
| 5 | Toca **Guardar y cerrar** (secundario) o Esc | Cierra; aviso "3 muestras congeladas en II · C4 (5A–5C)."; el 3D enfoca la caja |

- Si la caja se llena a mitad de tanda: la posición queda vacía y el aviso dice "La caja C4 está
  llena. Elige otra caja para seguir." con foco en Nombre Caja. No se salta de caja solo.
- Posición ocupada al guardar (otra persona llegó antes): error en el campo + botón
  "Usar 5F (siguiente libre)".
- Criterio: 5 muestras seguidas solo con teclado (Tab/Enter), sin tocar el mouse.

### F2 · Descongelar (D3)

| Paso | Persona hace | Pantalla muestra |
|---|---|---|
| 1 | Toca **Descongelar** (barra) o "Descongelar" en el detalle | Modal. Si vino del detalle, la muestra ya está elegida y se salta al paso 3 |
| 2 | Escribe el **ID Environ** del tubo (campo nuevo, primero) | Sugerencias de muestras **activas** con ese ID, con su ubicación en mono. Al elegir, se rellenan Nombre Caja y Posición, y la grilla de ocupadas la muestra marcada. También se puede ir por Nombre Caja → Posición como hoy |
| 3 | Revisa la ficha (ID, Descripción, Tipo, Pasaje, Núcleo, Encargados en solo lectura) | Si es Núcleo: aviso naranja arriba de la ficha. Si la persona no es encargada: aviso y botón deshabilitado con el motivo ("Solo sus encargados pueden retirarla: MN, AS") |
| 4 | Escribe Motivo, **Descongelar** | Botón primario turquesa (no rojo: no se borra nada, `DESIGN.md`). Aviso "ENV-0231 retirada de II · C4 · 5E." y la luz de esa posición pasa a verde en el 3D |

- El campo ID no cambia los campos del Google Form: es una forma de llenar caja + posición.
- Si el ID tiene varias muestras activas (mismo ID, varias alícuotas), la lista las muestra
  todas con ubicación y la persona elige.

### F3 · Encontrar una muestra por ID hasta su posición en el 3D (D1 + D2)

| Paso | Persona hace | Pantalla muestra |
|---|---|---|
| 1 | Toca el buscador (o `/`), escribe `ENV-0231` | Sugerencias en vivo: ID, ubicación, aviso Núcleo |
| 2 | Enter | 3D vuela a la caja (400–600 ms, sin animación con `prefers-reduced-motion`), abre la caja, resalta 5E con contorno turquesa, panel muestra el detalle |

Dos acciones desde cualquier vista (criterio: ≤ 3).

### F4 · Mover una caja

| Paso | Persona hace | Pantalla muestra |
|---|---|---|
| 1 | En el 3D selecciona la caja → **Mover caja**; o en % de uso, acción de la fila | Modal "Mover caja II · C4 (34 muestras)" |
| 2 | Escribe el nuevo lugar (`D7`) | Debajo del campo, en vivo: "D7 está vacía" (ok) / "D7 tiene 12 muestras" (error) / "No existe el rack D" (error). La Sección se deduce, en solo lectura |
| 3 | **Mover caja** | Aviso "Caja movida de II · C4 a III · D7 (34 muestras)."; el 3D enfoca el lugar nuevo |

## Estados por pantalla

| Pantalla | Cargando | Vacío | Error | Éxito |
|---|---|---|---|---|
| Buscador global | Spinner de 12px dentro del campo tras 300 ms | "No hay muestras activas con «X»." + enlace a incluir retiradas | "No se pudo buscar. Reintentar." bajo el campo | Navega (ver F3) |
| Freezer 3D | Escena con cajas en gris y "Cargando ocupación…" en el panel | Caja sin registrar: "Caja sin registrar" + "Registrar congelamiento aquí" | Banda en el panel: "No se pudo cargar la ocupación. Reintentar." La escena queda navegable | — |
| Tabla | Primera carga: "Cargando muestras…"; refetch: tabla con `aria-busy` y opacidad 0.6 (ya existe) | "No hay muestras con esos filtros." + botón "Limpiar filtros" | `role="alert"` con el mensaje de la API + Reintentar | — |
| % de uso | Filas esqueleto sin animación | "No hay cajas registradas." | Igual que tabla | — |
| Detalle | Panel con el ID y "Cargando…" | — | "No se pudo cargar la muestra." | — |
| Modales de tarea | Botón primario con verbo en gerundio ("Guardando…") y deshabilitado | — | Error en el campo (`aria-describedby`) o arriba del pie si es del servidor; el modal no se cierra | Cierra y deja un **aviso** |
| Aviso de resultado | — | — | — | Franja `role="status"` bajo la barra con ✕; **se va sola a los 8 s o al siguiente cambio de vista** (hoy queda para siempre) |
| Alertas | — | Sin chip cuando N = 0 | Chip no se muestra; el error se registra en consola | — |

## Responsive y accesibilidad

| Ancho | Barra superior | Vista | Detalle |
|---|---|---|---|
| PC ≥ 1100px | Todo en una fila | Vista + panel derecho de 360px | Panel derecho |
| Tablet 700–1099px | Buscador en fila propia a ancho completo; Congelar/Descongelar como botones de 44px | Una columna; en 3D el panel pasa debajo de la escena | Hoja inferior al 50% de alto, arrastrable a 90% |
| Teléfono < 700px | Buscador + menú; Congelar/Descongelar en barra inferior fija | Tabla por defecto; 3D disponible | Hoja inferior a pantalla completa |

- Objetivos táctiles de 44px con `pointer: coarse` (`DESIGN.md`).
- Landmarks: `header` (barra), `nav` (vistas), `main` (vista), `aside` (panel de contexto).
- Foco: al abrir un modal va al primer campo vacío; al cerrarlo vuelve al elemento que lo abrió.
  Al cambiar de vista por el buscador, el foco va al título del detalle.
- Grilla de posiciones con flechas y roving tabindex (`docs/QOL.md` §3); cada posición con
  `aria-label` completo (`DESIGN.md` › Estados de una posición).
- Los avisos de resultado van en una sola región `aria-live="polite"`.

## Fases

### Fase 0 · Preparar (manual)

```bash
docker compose up -d          # db + backend + frontend con el seed
cd frontend && npm install    # los skills corren tests y build
```

Las fases 3 y 4 navegan la app real con el navegador de gstack (`/browse`), así que la app tiene
que estar corriendo con datos (seed o importación con el Excel sintético de los tests).

### Fase 1 · Sistema de diseño → `/design-consultation` ✔

Salida: `DESIGN.md` en la raíz.

### Fase 2 · Revisar el plan → `/plan-design-review` ✔

Salida: este documento, con la arquitectura de información y los flujos cerrados.
Siguiente: `/plan-eng-review` sobre la división de `App.tsx` (el panel de contexto y el buscador
global cambian quién es dueño de `selected` y `focusTarget`) antes de la fase 3.

### Fase 3 · Implementar y auditar → `/design-review`

Un PR por bloque, en este orden (cada uno deja la app usable):

1. **Tokens y base** (T1): cambios pendientes de `theme.css` listados en `DESIGN.md`.
2. **Barra superior y navegación** (T2, T3): buscador global, Congelar/Descongelar fijos, menú de
   usuario, avisos que se cierran. `Header`, `App.tsx`, `FiltersBar`.
3. **Detalle como panel** (T4): `SampleDetail`, `FreezerViewer` (panel), `SamplesTable`.
4. **Tareas** (T5, T7, T8): `FreezeForm` (tanda), `ThawForm` (ID primero), `BoxMoveModal`.
5. **Visor y ocupación** (T6): Núcleo en el 3D, `OccupancyView`, `PositionPicker`.
6. **Administración**: `UsersModal`, `AnomaliesView` (solo auditoría visual).

### Fase 4 · Verificar los flujos → `/qa`

Recorre F1–F4 de punta a punta en PC y en viewport de tablet, en claro y oscuro.

## Criterios de aceptación

- F1: congelar 5 muestras consecutivas del mismo set solo con teclado.
- F3: encontrar una muestra por ID y llegar a su posición en el 3D en ≤ 3 acciones desde cualquier vista (diseño: 2).
- F2: retirar un tubo teniendo solo su ID, sin saber la caja.
- F4: mover una caja sabiendo antes de confirmar si el destino está libre.
- Todo operable por teclado, con foco visible; la grilla de posiciones con flechas.
- Contraste WCAG AA en claro y oscuro; objetivos táctiles ≥ 44 px (tablet).
- Warning de Núcleo presente en: buscador, tabla, detalle, 3D (posición y panel), congelar, descongelar, mover.
- Ningún patrón de AI-slop (`DESIGN.md` › Prohibido).

## Tareas

- [ ] **T1 (P1)** — `theme.css` — Aplicar "Cambios pendientes" de `DESIGN.md` (`--warn`, `--field-border`, 12px mínimo, 44px táctil, logo en oscuro automático, sombras).
- [ ] **T2 (P1)** — `Header`, `App.tsx` — Buscador global con sugerencias y las tres salidas (1 resultado / varios / ubicación); quitar "Buscar posición" del panel 3D. Backend: verificar que `searchSamples` filtre por prefijo de ID Environ e ID Origen; si no, issue aparte.
- [ ] **T3 (P1)** — `Header`, `App.tsx` — Congelar/Descongelar en la barra; menú de usuario (Usuarios, tema, Cambiar usuario); avisos que se cierran solos.
- [ ] **T4 (P1)** — `SampleDetail`, `FreezerViewer`, `App.tsx` — Detalle como panel/hoja inferior; botón "Ver en el refri" fuera del 3D; Descongelar como primario.
- [ ] **T5 (P1)** — `FreezeForm` — "Guardar y siguiente" como primario (Enter), foco a ID Environ, franja "En esta tanda", caja llena a mitad de tanda.
- [ ] **T6 (P1)** — `FreezerViewer` — Warning de Núcleo en el 3D (triángulo en la posición de la vista de caja + aviso en el panel). Hoy no aparece.
- [ ] **T7 (P2)** — `ThawForm` — Campo ID Environ primero con sugerencias de muestras activas; botón primario turquesa "Descongelar"; motivo del bloqueo cuando no es encargado.
- [ ] **T8 (P2)** — `BoxMoveModal` — Validación en vivo del destino (vacía / ocupada / no existe); tras mover, enfocar el 3D en el lugar nuevo.

## Fuera de alcance

- Lector de códigos de barras/QR: el campo ID de F2 queda listo para un lector tipo teclado, pero no se integra cámara.
- Rediseño del modelo 3D (geometría, cámara): solo se agregan Núcleo y el resaltado.
- Cambiar campos del Google Form: prohibido por `docs/FORMULARIO.md`.
- Modo sin conexión.

## Qué ya existe y se reutiliza

- `DESIGN.md` y los tokens de `theme.css`.
- `Modal` (atrapa foco, Esc) para todas las tareas.
- `NucleoWarning` en tabla, detalle y descongelar: se reutiliza en el 3D y el buscador.
- `getAutocompleteSuggestions` (congelar) y `lookupByIds` (lista de IDs) como base del buscador y del ID en descongelar.
- `focusTarget` del visor ("Ver en el refri") para el salto desde el buscador.
- `parseViewerQuery` del visor para reconocer ubicaciones en el buscador global.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 9/10, 4 decisiones (D1–D4) + 8 tareas |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |

- **VERDICT:** Design CLEARED. Falta eng review (división de `App.tsx` por el panel de contexto y el buscador global).

NO UNRESOLVED DECISIONS
