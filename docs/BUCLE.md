# Bucle Copilot ⇄ Claude

Dos agentes trabajan en bucle sobre los issues del proyecto. Uno implementa y el otro revisa,
hasta que el PR queda aprobado o se alcanza el límite de iteraciones (5 por defecto).

| Bucle | Implementa | Revisa | Cómo se inicia |
|---|---|---|---|
| **A** (`bucle-copilot-claude.yml`) | Copilot coding agent | Claude | Asignar el issue a **Copilot** |
| **B** (`bucle-claude-copilot.yml`) | Claude | Copilot code review | Comentar **`@claude`** en el issue |

```
Bucle A:  issue ─► Copilot abre PR ─► Claude revisa ─┬─ aprueba ─► etiqueta bucle:aprobado ─► merge humano
                        ▲                            └─ pide cambios ─► comenta "@copilot ..." ─┐
                        └───────────────────────────────────────────────────────────────────────┘

Bucle B:  issue ─► @claude abre PR ─► Copilot revisa ─► Claude corrige y hace push ─┐
                                          ▲                                          │
                                          └──────────────────────────────────────────┘
          (termina cuando Claude no necesita cambiar nada ─► bucle:aprobado)
```

El merge a `main` **siempre lo hace una persona**. Etiquetas:
- `bucle:aprobado`: el revisor ya no pide cambios.
- `bucle:requiere-humano`: se alcanzó el límite de iteraciones o algo falló.

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

## Uso diario

- **Bucle A:** crea un issue bien descrito y asígnalo a Copilot. Lo demás es automático.
- **Bucle B:** en un issue, comenta `@claude implementa este issue`.
- **Relanzar a mano:** *Actions → (workflow del bucle) → Run workflow → número del PR*.
- **Ajustar el límite:** cambia `MAX_ITERACIONES` al inicio de cada workflow.
- **Sacar un PR del bucle A:** quita la etiqueta `bucle` o cierra el PR.
  Un PR que no sea de Copilot entra al bucle A si le pones la etiqueta `bucle`.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `Falta el secret BUCLE_PAT` | No se creó el secret del paso 1 |
| Copilot no reacciona al comentario `@copilot` | El dueño de `BUCLE_PAT` no tiene licencia de Copilot o no tiene permiso de escritura |
| El bucle A no arranca cuando Copilot termina | La aprobación de workflows sigue activa (paso 3); apruébalo en el PR o lánzalo a mano |
| El bucle B no arranca | Falta el ruleset del paso 4, o la rama del PR no empieza con `claude/` |
| La revisión de Claude falla | Revisa `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` y el log del run |
