# Bucle Copilot ⇄ Claude

Dos agentes trabajan en bucle sobre los issues del proyecto. Uno implementa y el otro revisa,
hasta que el PR queda aprobado o se alcanza el límite de iteraciones (3 por defecto).

| Bucle | Implementa | Revisa | Cómo se inicia |
|---|---|---|---|
| **A** (`bucle-copilot-claude.yml`) | Copilot coding agent | Claude | Asignar el issue a **Copilot** |
| **B** (`bucle-claude-copilot.yml`) | Claude | Copilot code review | Comentar **`@claude`** en el issue |

```
Bucle A:  issue ─► Copilot abre PR ─► Claude revisa ─┬─ aprueba ─► etiqueta bucle:aprobado ─► merge humano
                        ▲                            └─ pide cambios ─► comenta "@copilot ..." ─┐
                        └───────────────────────────────────────────────────────────────────────┘

Bucle B:  issue ─► @claude abre PR ─► Copilot revisa ─┬─ sin High ─────────────► CI verde ─► merge
                                          ▲             ├─ con High (ronda < 3) ─► Claude corrige y hace push ─┐
                                          │             └─ con High (ronda = 3) ─► merge + bucle:revisar-despues
                                          └────────────────────────────────────────────────────────────────────┘
```

### Cuándo para el Bucle B (para no gastar la suscripción de Claude)

La decisión se toma **sin llamar a Claude**: el workflow lee el resumen de la review de Copilot
("Open (N)") y cuenta los hallazgos abiertos de severidad **High o Critical**.

| Review de Copilot | Qué pasa | ¿Gasta Claude? |
|---|---|---|
| Sin hallazgos abiertos | Espera la CI y mergea | No |
| Primera review con High **o** Medium/Low | Claude corrige todos los High reales y, de los Medium/Low, **los que considere necesarios** (bugs, datos, trazabilidad, seguridad, arreglos cortos). El resto lo marca como *diferido*. Máx. 80 turnos; si se acaba, se sube lo avanzado (commiteado o no) y Copilot vuelve a revisar | Sí, una ronda |
| Reviews siguientes sin High | Mergea. Los Medium/Low se triagean una sola vez por PR | No |
| Reviews siguientes con High, quedan rondas (`MAX_ITERACIONES`, 3) | Otra ronda de Claude | Sí |
| Claude concluye que no hay nada que cambiar | No hace commits: se mergea | — |
| Con High tras 3 rondas | `AL_LIMITE: mergear` → mergea y etiqueta `bucle:revisar-despues`. `AL_LIMITE: detener` → se detiene con `bucle:requiere-humano` | No |
| CI en rojo | Nunca se mergea: `bucle:requiere-humano` y la cadena se detiene | No |

**Nada se pierde:** al mergear, el workflow comenta en el issue de revisión final
(`ISSUE_REVISION_FINAL`, por defecto el **#8**) todo lo que Copilot reportó en **cualquier**
review del PR y nunca marcó como resuelto (secciones *Open* y *Previously missed*), con enlace o
archivo:línea, más lo que Claude difirió y su motivo. El parser está en
`.github/scripts/hallazgos_copilot.py`. Cuando la
cadena llega al #8, Claude los ve en los comentarios del issue y los resuelve en esa revisión final.
Esto no gasta tokens: lo publica el propio workflow.

En el peor caso, un issue cuesta 1 implementación + 3 rondas de corrección. Las reviews las hace
Copilot (se cobran de sus premium requests, no de Claude).

El Bucle B **no** escucha el evento de la review de Copilot: GitHub deja esas ejecuciones en
*action_required* (hay que pulsar *Approve and run* a mano) porque las dispara un bot. En su lugar,
cada vez que el PR se abre o recibe un push, el workflow se lanza, **espera** (hasta 30 min) a que
Copilot publique su review sobre ese commit y recién ahí llama a Claude. Solo entran PRs de ramas
`claude/*` que cierren algún issue (`Closes #N`).

Etiquetas:
- `bucle:aprobado`: el revisor ya no pide cambios (o no quedan hallazgos graves).
- `bucle:revisar-despues`: se mergeó al llegar al límite con hallazgos High abiertos; revísalos cuando puedas.
- `bucle:requiere-humano`: la CI falló, algo se rompió o (Bucle A) se alcanzó el límite.

En el Bucle A, Claude solo pide cambios por problemas graves (bugs, tests rotos, trazabilidad,
seguridad) y aprueba lo demás; en la última revisión aprueba si solo quedan detalles.

## Cadena automática (`cadena.yml`)

> **Ojo:** esto cambia la regla original de que *el merge a `main` siempre lo hace una
> persona*. Ahora el Bucle B mergea solo. Para volver al modo manual, borra el bloque
> de merge automático del final de `bucle-claude-copilot.yml`.

Con la cadena activa los 8 issues se implementan seguidos sin intervención:

```
issue ─► @claude implementa ─► PR ─► Copilot revisa ─► Claude corrige ─► bucle:aprobado
                                                                              │
              ┌───────────────────────────────────────────────────────────────┘
              ▼
        ¿CI en verde? ──no──► bucle:requiere-humano (se detiene, lo ves tú)
              │
             sí
              ▼
        merge --squash ─► cadena.yml cierra el issue y lanza el siguiente
```

Dos detalles de implementación que no son obvios:

- **El merge se hace con `BUCLE_PAT`, no con `GITHUB_TOKEN`.** GitHub no dispara workflows
  nuevos a partir de eventos generados por `GITHUB_TOKEN`; si el merge lo hiciera el token
  por defecto, `cadena.yml` no se enteraría nunca y la cadena se cortaría en el primer PR.
- **Cada issue lanzado queda marcado** con `<!-- cadena:lanzado -->` en su comentario. Así
  la cadena no puede relanzar el mismo issue en bucle si su PR se mergea sin cerrarlo.

**Para cortar la cadena:** deshabilita `cadena.yml` en *Actions*, o cierra los issues que
falten. El CI en rojo también la detiene sola.

## Configuración (una sola vez, la hace el dueño del repo)

Un colaborador no puede cambiar la configuración del repo ni de Copilot, así que estos pasos
los hace **el dueño del repo**.

### 1. Secrets de Actions
*Settings → Secrets and variables → Actions → New repository secret*

| Secret | Qué es | Cómo obtenerlo |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Acceso de Claude usando una suscripción Pro/Max | En una terminal con Claude Code: `claude setup-token` |
| `ANTHROPIC_API_KEY` | *Alternativa* al anterior (se paga por uso) | console.anthropic.com → API Keys |
| `BUCLE_PAT` | Token de una **persona** con acceso de escritura y licencia de Copilot. Sirve para relanzar los workflows y para que Copilot acepte las órdenes `@copilot` | Ver abajo |

Basta con uno de los dos primeros.

**`BUCLE_PAT`:** lo ideal es que lo cree el dueño del repo en *GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained tokens*. Limítalo a este repo con estos permisos: **Actions**,
**Contents**, **Issues** y **Pull requests** en *Read and write*. Si lo crea un colaborador,
tiene que ser un token **classic** con los scopes `repo` y `workflow` (los fine-grained no alcanzan
repos personales ajenos).

### 2. Claude GitHub App (opcional)
`claude.yml` usa `BUCLE_PAT`, así que la app no es necesaria. Si la instalas
(https://github.com/apps/claude) y dejas `BUCLE_PAT` vacío, `@claude` responderá como `claude[bot]`
en vez de como el dueño del token.

### 3. Copilot coding agent (Bucle A)
- La cuenta dueña necesita **Copilot Pro, Pro+, Business o Enterprise**.
- *Settings → Copilot → Coding agent*: verifica que esté habilitado en este repo.
- En esa misma pantalla, **desactiva la aprobación manual de workflows** para los PRs de Copilot.
  Si queda activa, cada vez que Copilot termine tendrás que pulsar *Approve and run workflows*
  en el PR para que el bucle siga.
- Para verificarlo: al asignar un issue, **Copilot** debe aparecer en la lista de asignables.

### 4. Copilot code review automático (Bucle B)
*Settings → Rules → Rulesets → New branch ruleset* sobre `main`:
- Activa **Automatically request Copilot code review**.
- Activa también **Review new pushes**, para que Copilot vuelva a revisar después de cada corrección de Claude.
  Sin esto el Bucle B espera 30 min la segunda review y se detiene con `bucle:requiere-humano`.
- Si activas *Require a pull request before merging*, deja **Required approvals en 0**: la review
  de Copilot es solo un comentario y nunca cuenta como aprobación, así que el merge automático fallaría.
- Si quieres, marca `backend` y `frontend` (jobs de `ci.yml`) como *Required status checks*.

### 5. Merge y Postgres para los agentes
- *Settings → General → Pull Requests*: deja habilitado **Allow squash merging** (el Bucle B mergea
  con `--squash`). Opcional: **Automatically delete head branches**.
- Copilot necesita `DATABASE_URL` para correr los tests: *Settings → Environments → `copilot`* →
  *Environment variables* → `DATABASE_URL` = `postgresql+psycopg://refri:refri@localhost:5432/refri_test`.
  El Postgres lo levanta `copilot-setup-steps.yml`. Los workflows de Claude ya traen el suyo.

## Uso diario

- **Bucle A:** crea un issue bien descrito y asígnalo a Copilot. Lo demás es automático.
- **Bucle B:** en un issue, comenta `@claude implementa este issue`.
- **Pedirle algo a Claude en un PR:** escribe `@claude ...` en la conversación del PR. Los
  comentarios en línea (de review) ya no lo invocan.
- **Relanzar a mano:** *Actions → (workflow del bucle) → Run workflow → número del PR*.
- **Modelo:** los tres workflows de Claude usan `--model claude-sonnet-5` en `claude_args`
  (más barato para la suscripción). Cámbialo ahí si quieres otro.
- **Ajustar el límite:** cambia `MAX_ITERACIONES` al inicio de cada workflow. En el Bucle B,
  `AL_LIMITE` decide si al llegar al límite se mergea (`mergear`) o se detiene (`detener`).
- **Sacar un PR del bucle A:** quita la etiqueta `bucle` o cierra el PR.
  Un PR que no sea de Copilot entra al bucle A si le pones la etiqueta `bucle`.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `Falta el secret BUCLE_PAT` | No se creó el secret del paso 1 |
| Copilot no reacciona al comentario `@copilot` | El dueño de `BUCLE_PAT` no tiene licencia de Copilot o no tiene permiso de escritura |
| El bucle A no arranca cuando Copilot termina | La aprobación de workflows sigue activa (paso 3); apruébalo en el PR o lánzalo a mano |
| El bucle B no arranca | La rama del PR no empieza con `claude/` o el PR no tiene `Closes #N` |
| El bucle B se detiene con "Copilot no revisó el commit" | Falta el ruleset del paso 4 (o *Review new pushes*), o se agotaron las premium requests de Copilot del dueño de `BUCLE_PAT` |
| "Aprobado por el bucle, pero GitHub rechazó el merge" | El ruleset exige aprobaciones o el squash merge está deshabilitado (paso 5) |
| Ejecuciones en *action_required* disparadas por Copilot | Workflows que escuchan eventos del bot de Copilot; los del bucle ya no lo hacen |
| La revisión de Claude falla | Revisa `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` y el log del run |
