# Sistema de diseño · Refri -80

Fuente de verdad visual del frontend. Los tokens viven en `frontend/src/styles/theme.css`; este
documento dice **qué significan, cuándo se usan y qué no se hace**. Si algo aquí choca con
`requirements.md` o `docs/FORMULARIO.md`, mandan ellos.

## Contexto de producto

- **Qué es:** inventario del freezer de -80 °C del laboratorio Environ. Congelar, descongelar,
  mover, encontrar una muestra y ver cuánto espacio queda.
- **Quién lo usa:** científicos del laboratorio. A veces desde una **tablet frente al freezer**, con
  guantes, apurados y con la puerta abierta; a veces desde un **PC**, revisando o planificando.
- **Tipo:** herramienta interna, densa en datos. No es un sitio de marketing ni un dashboard de
  métricas.
- **Lo que tiene que quedar:** *"Miro la pantalla y sé dónde está, sin pensar."* Cada decisión de
  abajo existe para que la ubicación de una muestra (sección → rack → caja → subcaja → posición) se
  lea más rápido que cualquier otra cosa en pantalla.

## Dirección estética

- **Dirección:** industrial/utilitaria, como un instrumento de laboratorio o una etiqueta
  criogénica. Datos en monoespaciada, títulos condensados, color solo cuando significa algo.
- **Decoración:** mínima. Separar con líneas de 1px y con espacio, no con sombras ni fondos.
- **Ánimo:** sobrio, preciso, confiable. Tiene que verse hecha para este freezer, no generada.
- **Referencia interna:** `demo.html` (visor 3D). Se mantiene su estética e interacciones; no sus
  números ni su acento `#0A7C96`, que en la app se reemplaza por el turquesa de marca.

### Prohibido (AI-slop)

- Gradientes decorativos, glassmorphism, fondos con blobs o ruido.
- Tarjetas con sombra por todo. La sombra se reserva a lo que **flota** (modal, tooltip, menú).
- Íconos dentro de círculos de color, grillas de 3 "features", emojis de adorno.
- Todo centrado. El contenido se alinea a la izquierda sobre una grilla.
- Textos de relleno ("¡Bienvenido! 🚀", "Gestiona tus muestras de forma fácil").
- Esquinas redondeadas uniformes y grandes en todo.
- Color usado para "decorar": si algo es rojo, verde o naranja, **significa** algo (ver semántica).

## Tipografía

Se cargan desde Google Fonts (ya está en `frontend/index.html`):
`Barlow Semi Condensed 600/700`, `IBM Plex Sans 400/500/600`, `IBM Plex Mono 400/500/600`.

| Rol | Fuente | Uso |
|---|---|---|
| Display | Barlow Semi Condensed 600/700 | Títulos de página, de panel y de modal. Condensada para que quepan nombres largos de caja en tablet. Nunca en párrafos. |
| Cuerpo / UI | IBM Plex Sans 400/500/600 | Texto, etiquetas, botones, tablas de texto. |
| Datos | IBM Plex Mono 400/500/600 | **Todo identificador y ubicación**: ID Environ, ID Origen, `II-C`, `1A`…`9I`, `1`…`100`, fechas, conteos, %. Siempre con `font-variant-numeric: tabular-nums`. |

Reglas:

- Los IDs y ubicaciones van **siempre** en mono, en mayúsculas, sin traducir ni abreviar.
  La ruta completa se escribe `II · Rack C · Caja 4 · 5E`; el separador es `·`.
- Nada de `system-ui` como fuente principal; solo como respaldo en la pila.
- Etiquetas de campo en versalitas (`uppercase`, `letter-spacing: 0.03em`) solo en `.field label`
  y encabezados de tabla. No en botones ni títulos.

### Escala

Base 14px (PC). En tablet (`pointer: coarse`) el cuerpo sube a 16px para leer a 50 cm con guantes.

| Token | PC | Tablet | Uso |
|---|---|---|---|
| `--fs-xs` | 12px | 13px | Ayudas, leyendas, metadatos. **Mínimo absoluto.** |
| `--fs-sm` | 13px | 14px | Etiquetas de campo, celdas de tabla, botones. |
| `--fs-md` | 14px | 16px | Cuerpo. |
| `--fs-lg` | 17px | 19px | Títulos de panel (display 600). |
| `--fs-xl` | 24px | 26px | Título de página / código de caja (display 700 o mono 600). |
| `--fs-2xl` | 30px | 32px | Solo el código de la muestra o caja seleccionada. |

Hoy `theme.css` tiene 10px y 11px en varias reglas (etiquetas de eje, leyendas, badges). Suben a
`--fs-xs`. La única excepción es el número dentro de una posición de la grilla 10×10 en pantallas
angostas, que puede bajar a 11px **si** la posición también tiene `aria-label` con la ubicación
completa.

## Color

- **Enfoque:** restringido. Neutros fríos + un acento (turquesa Environ) + tres colores
  semánticos que nunca se usan para otra cosa.

### Semántica fija (no negociable)

| Significado | Token | Codificación sin color (daltonismo) |
|---|---|---|
| **Ocupada** | rojo `--led-on`, `--occupied-*` | Círculo **relleno**. Texto "Ocupada" en leyendas y `aria-label`. |
| **Libre** | verde `--led-off`, `--free-*` | Círculo **hueco** (solo anillo). Texto "Libre". |
| **Núcleo** | naranja `--warn`, `--warn-soft` | Marca de **esquina/triángulo** + la palabra "Núcleo" siempre visible junto al ID. Nunca solo color. |
| Seleccionada / foco | turquesa `--accent` | Contorno de 2px con separación de 2px. |
| Error / acción destructiva | `--danger` | Texto del error explícito. Descongelar **no** es destructivo (no se borra nada): usa botón normal, no rojo. |

El rojo y el verde se leen como "luces" del freezer. No se usan para éxito/error de formularios:
para eso hay `--danger` y mensajes con texto.

### Tokens

Claro / oscuro. Todos los pares texto-fondo verificados ≥ 4.5:1; bordes de controles y estados ≥ 3:1.

| Token | Claro | Oscuro | Rol |
|---|---|---|---|
| `--bg` | `#e6ebee` | `#0d1317` | Fondo de página. |
| `--panel` | `#f7f9fa` | `#131b21` | Superficie de paneles, header, modales. |
| `--chip` / `--chip-hover` | `#ecf0f2` / `#e0e7eb` | `#1b252c` / `#223039` | Fondo de campos, botones secundarios. |
| `--ink` | `#14202a` | `#e2e9ed` | Texto principal (13.8:1 / 15.2:1). |
| `--muted` | `#5a6873` | `#8d9ba6` | Texto secundario (≥ 4.4:1 en todos los fondos, incl. `--warn-soft`). |
| `--line` | `#d1dae0` | `#25313a` | Divisores **decorativos** (tablas, paneles). No sirve como borde de un control. |
| `--field-border` *(nuevo)* | `#7d8b95` | `#5f707b` | Borde de inputs, selects y posiciones libres (3.0:1+, WCAG 1.4.11). |
| `--brand` / `--accent` | `#0c6575` | `#45b3c4` | Marca, botón primario, enlaces, foco, selección. |
| `--accent-ink` | `#ffffff` | `#06161b` | Texto sobre `--accent` (6.7:1 / 7.5:1). |
| `--accent-soft` | `#d2e7eb` | `#13333a` | Fondo de fila seleccionada, vista activa. |
| `--warn` | **`#9a4413`** (era `#b4531a`) | `#e08a4f` | Núcleo. El claro anterior daba 3.8:1 sobre `--warn-soft`; el nuevo da 5.0:1. |
| `--warn-soft` | `#f3ddce` | `#3a2a1c` | Fondo del aviso de Núcleo. |
| `--danger` | `#b3261e` | `#e5766b` | Errores de validación, conflictos de posición. |
| `--occupied-soft` / `--occupied-ink` | `#fbdcdd` / `#9c1f23` | `#3a1a1d` / `#ff9b9e` | Posición ocupada en grillas 2D (6.2:1 / 7.8:1). |
| `--free-soft` / `--free-ink` | `#d9f2e4` / `#0f5f3c` | `#143026` / `#6ee7a8` | Posición libre en grillas 2D (6.5:1 / 9.2:1). |
| `--led-on` / `--led-off` | `#e5484d` / `#2bb673` | `#ff6369` / `#3dd68c` | **Solo emisión en el 3D.** En claro `--led-off` da 2.5:1 sobre el panel: nunca como texto ni como único borde en 2D. |
| `--scene`, `--grid`, `--box`, `--box-edge`, `--slot`, `--slot-line` | ver `theme.css` | ver `theme.css` | Escena 3D y cajas de cartón; vienen de `demo.html`, no se tocan. |

### Modo oscuro

- Se respeta `prefers-color-scheme` y se puede forzar con `data-theme`. Cada token se define tres
  veces (claro, `@media` oscuro con `:root:not([data-theme="light"])`, `:root[data-theme="dark"]`).
  Al agregar un token, agregarlo en los tres bloques.
- Superficies rediseñadas, no invertidas: el acento se aclara (`#45b3c4`) y el texto sobre él pasa a
  oscuro.
- La placa clara detrás del logo hoy solo aplica con `data-theme="dark"`; tiene que aplicar también
  en el oscuro automático.

## Estados de una posición

Una posición (2D o 3D) combina estos estados. Todos se distinguen **sin color**:

| Estado | Relleno | Borde | Extra |
|---|---|---|---|
| Libre | hueco (`--free-soft` en 2D) | 1.5px `--free-ink` | — |
| Ocupada | relleno `--occupied-soft` + punto `--occupied-ink` | 1.5px `--occupied-ink` | — |
| Núcleo (ocupada) | como ocupada | igual | triángulo `--warn` en la esquina superior derecha |
| Seleccionada | sin cambio | + contorno 2px `--accent` separado 2px | — |
| Deshabilitada (fuera de rango) | `--chip` | 1px `--line` | cursor `not-allowed`, sin número |

Cada posición lleva `aria-label` completo: `"5E, ocupada, ENV-0231, Núcleo"`.

## Espaciado y tamaño

- **Base:** 4px. Escala: `2 · 4 · 8 · 12 · 16 · 24 · 32 · 48`.
- **Densidad:** compacta en PC (filas de tabla de 36px), cómoda en tablet.
- **Objetivos táctiles:** todo lo que se toca mide **≥ 44×44px** con `pointer: coarse`
  (botones, chips, filas de tabla, posiciones de la grilla, cerrar modal). Hoy los botones miden
  ~35px (`padding: 8px 14px`): se agrega `min-height: 44px` bajo `@media (pointer: coarse)`.
  En PC el mínimo es 32px.
- Si una grilla 10×10 no cabe con celdas de 44px, se hace scroll horizontal o se amplía la
  subcaja; no se achican las celdas.

## Layout

- **Enfoque:** grilla disciplinada, alineado a la izquierda.
- Header fijo con logo, nombre, usuario y selector de vista; debajo, la vista activa.
- **PC (≥ 1100px):** visor/tabla a la izquierda, panel de detalle a la derecha (360px).
- **Tablet (700–1099px):** una columna; el detalle aparece como hoja inferior o modal.
- **Teléfono (< 700px):** una columna, sin 3D por defecto (tabla primero).
- Ancho máximo del contenido de texto: 72ch. Las tablas y el visor usan el ancho completo.

### Superficies y bordes

| Elemento | Radio | Borde | Sombra |
|---|---|---|---|
| Campos, botones, chips | 6px | 1px `--field-border` / ninguno | ninguna |
| Paneles | 10px | 1px `--line` | ninguna |
| Modales, tooltip, menús | 10px / 6px | 1px `--line` | `0 10px 30px rgb(0 0 0 / .16)` (la única sombra permitida) |
| Posiciones de subcaja | 50% (círculos, como en el demo) | 1.5px | ninguna |
| Badges de estado | 999px | — | ninguna |

Nada de `box-shadow` en paneles ni en tarjetas de resumen. Los paneles se separan por el cambio
de superficie (`--bg` → `--panel`) y una línea.

## Componentes clave

- **Botón primario:** `--accent` sobre `--accent-ink`, peso 600, verbo concreto en infinitivo
  ("Congelar", "Descongelar", "Mover caja", "Buscar"). Uno por vista o modal.
- **Botón secundario:** `.btn-ghost` (fondo `--chip`, borde). "Cancelar" siempre secundario y a la
  izquierda del primario.
- **Selector de vista:** control segmentado (como `.seg` del demo), la activa con `--accent`.
- **Aviso de Núcleo:** franja `--warn-soft` con borde izquierdo 3px `--warn` y el texto
  "Núcleo: no descongelar sin autorización" (o el que defina `requirements.md`). Aparece en la
  tabla, el detalle, el 3D (tooltip y panel), el formulario y los modales de retiro.
- **Tabla:** encabezados sticky en versalitas `--fs-xs`, filas con divisor `--line`, columnas de
  ID/ubicación/fecha en mono. Fila seleccionada con `--accent-soft`. Sin cebra.
- **% de uso:** barra horizontal plana (sin gradiente) con el número en mono a la derecha
  (`34 / 81 · 42 %`). Color de la barra `--accent`; nunca rojo/verde, que ya significan posición.
- **Mensajes vacíos:** una línea factual en `--muted` ("No hay muestras con esos filtros.").

## Foco y teclado

- Foco visible en todo control: `outline: 2px solid var(--accent); outline-offset: 2px`.
  Nunca `outline: none` sin reemplazo.
- La grilla de posiciones se navega con flechas (roving tabindex), Enter selecciona
  (`docs/QOL.md` §3).
- Los modales atrapan el foco y lo devuelven al elemento que los abrió; Esc cierra.

## Movimiento

- **Enfoque:** mínimo-funcional. Solo transiciones que explican un cambio de estado.
- Duraciones: micro 100ms (hover, presión), corto 180ms (abrir panel/modal), cámara 3D 400–600ms
  `ease-in-out` (volar a una caja, como en el demo).
- `prefers-reduced-motion: reduce`: la cámara salta sin animar y se quitan las transiciones.
- Nada de animaciones de entrada, rebotes, skeletons decorativos ni pulsos en luces.

## Visor 3D

- Se porta desde `demo.html` y conserva: paleta de escena (`--scene`, `--grid`), cajas de cartón
  (`--box*`, `--slot*`), etiquetas en IBM Plex Mono dibujadas en canvas, tooltip, órbita y
  "volar a la caja".
- Las luces de posición usan `--led-on` / `--led-off` (emisión) y además forma: esfera llena para
  ocupada, anillo para libre.
- Los números de racks y cajas salen de los datos (`layout.yaml` / API), nunca del demo.
- Siempre hay una alternativa sin 3D (tabla) con la misma información.

## Voz y textos

- Español, trato de tú o impersonal, sin exclamaciones ni emojis.
- Frases cortas y literales: "Posición 5E ocupada por ENV-0231." en vez de "¡Ups! Algo salió mal".
- Mayúscula solo al inicio de la frase. Los nombres de campo son los del Google Form
  (`docs/FORMULARIO.md`) tal cual.
- Los errores dicen qué pasó y qué hacer: "Esa posición ya tiene una muestra activa. Elige otra o
  descongela la actual."

## Cambios pendientes en `theme.css`

Derivados de la auditoría de contraste y tamaño hecha al escribir este documento:

1. `--warn` claro: `#b4531a` → `#9a4413`.
2. Nuevo `--field-border` (claro `#7d8b95`, oscuro `#5f707b`) para inputs, selects y posiciones
   libres; hoy usan `--line` (1.3:1).
3. Subir todos los `font-size: 10px` y `11px` a `--fs-xs` (12px), salvo la excepción de la grilla 10×10.
4. `min-height: 44px` en botones, chips, filas y celdas bajo `@media (pointer: coarse)`.
5. Placa del logo también en el modo oscuro automático.
6. Quitar `box-shadow: 0 1px 2px …` de paneles; dejar sombra solo en modal/tooltip.
7. No usar `--led-off` como color de texto o borde en 2D (usar `--free-ink`).

## Registro de decisiones

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-09-25 | Se formaliza el sistema existente (Environ `#0c6575`, Plex + Barlow, modo oscuro) en vez de uno nuevo | Ya funciona y a los usuarios les gustó el visor; cambiar la identidad no aporta. |
| 2026-09-25 | Rojo/verde/naranja reservados a ocupada/libre/Núcleo, con forma además de color | Requisito de dominio y accesibilidad para daltónicos. |
| 2026-09-25 | `--warn` claro más oscuro y nuevo `--field-border` | Fallaban WCAG AA (3.8:1 y 1.3:1). |
| 2026-09-25 | Tamaño mínimo de texto 12px y objetivos de 44px en táctil | Uso en tablet frente al freezer, con guantes. |
| 2026-09-25 | Sombra solo en capas flotantes | Evitar el look de "tarjetas por todo"; la jerarquía la dan superficie y línea. |
