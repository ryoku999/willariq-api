# Prompts versionados y rutas IA — Postman

Esta fase administra configuración y valida muestras localmente. No llama a Cerebras, Groq ni OpenRouter; no consume tokens, no crea trabajos BullMQ y todavía no clasifica incidencias. Todos los endpoints requieren ADMIN, conservan el envoltorio `{ success, path, data }` y usan el prefijo de API configurado.

## 1. Preparación y migración

AJV ya está instalado por el usuario. No hacen falta SDK de proveedores, Redis ni paquetes adicionales.

Se preparó `prisma/migrations/20261015180000_ai_prompt_activation/migration.sql`: cambia el default de un prompt nuevo a inactivo y crea un índice parcial único para permitir un solo prompt activo por capacidad. No se aplicó a tus tablas de negocio. Se probó en un esquema PostgreSQL descartable.

Desde la raíz de API revisa pendientes y aplica las migraciones preparadas:

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm exec prisma migrate deploy --config prisma7.config.ts
pnpm exec prisma generate --config prisma7.config.ts
pnpm run start:dev
```

`migrate status` puede señalar migraciones pendientes antes de aplicarlas; eso es lo esperado para esta entrega. No necesitas generar otra migración ni usar reset. `migrate deploy` aplica las pendientes existentes, sin shadow database y sin recrear datos. Si tienes migraciones ajenas pendientes, revísalas también antes de ejecutar el comando.

La migración no selecciona arbitrariamente una versión si encuentra varios prompts activos históricos de una capacidad: falla con un mensaje explícito. Si ocurre, conserva el mensaje para revisar ese caso; no borres tablas, volúmenes o historial. El endpoint de activación permite elegir una versión y desactivar las otras conservando su contenido.

No hay nuevas variables obligatorias para guardar borradores. Para habilitar una ruta necesitas la credencial de su proveedor en el entorno del backend:

```dotenv
CEREBRAS_API_KEY=TU_CLAVE_SI_USARAS_CEREBRAS
GROQ_API_KEY=TU_CLAVE_SI_USARAS_GROQ
OPENROUTER_API_KEY=TU_CLAVE_SI_USARAS_OPENROUTER
```

Configura solo las que usarás; las ausentes o vacías se consideran no configuradas. Reinicia la API después de cambiarlas. No envíes claves en ningún body, prompt, ruta ni variable `VITE_*`; no se almacenan ni se devuelven por estos endpoints. Tampoco se comprueba todavía su validez remota, saldo o acceso a un modelo.

En Postman configura:

| Variable | Valor |
| --- | --- |
| `baseUrl` | `http://localhost:8000/api`, ajustado a tu entorno |
| `adminToken` | Access token de tu ADMIN |
| `promptId` | Se guardará después del primer POST |
| `promptV2Id` | Segunda versión, para probar sustitución |
| `routeId` | Primera ruta |
| `fallbackRouteId` | Segunda ruta |

Usa Authorization → Bearer Token → `{{adminToken}}` en toda la carpeta. Puedes obtenerlo por el login móvil existente con las credenciales de ADMIN y guardar `data.tokens.accessToken`; los roles se vuelven a comprobar contra BD. Para cuerpos usa Body → raw → JSON y `Content-Type: application/json`.

## 2. Primer system prompt preparado

El body completo está en [incident-classification-v1.json](ai/incident-classification-v1.json). Abre ese archivo y pega su contenido en Postman. El prompt cubre descripción fiel, categoría/tipo, urgencia, sentimiento, palabras clave, confianza, supervisión, entidades y tratamiento del texto ciudadano como datos no confiables.

Se carga por HTTP; no está hardcodeado en un servicio ni se inserta automáticamente en tu BD. Puedes revisarlo y adaptar las instrucciones municipales antes de crear la primera versión. Después, cualquier cambio de contenido se publica como otra versión.

El código fija el contrato de salida persistible, porque cambiar instrucciones no debe permitir que una IA escriba `status`, usuarios o campos arbitrarios. El prompt de ejemplo omite `responseSchema`: para INCIDENT_CLASSIFICATION la API completa el esquema canónico. También puedes obtenerlo y enviarlo explícitamente, siempre idéntico al contrato actual.

No se ha evaluado todavía la calidad de clasificación con un proveedor real. La muestra incluida sirve para comprobar estructura y reglas locales; no acredita precisión de un modelo.

## 3. Endpoints de prompts

### Consultar el contrato

`GET {{baseUrl}}/admin/ai/contracts/incident-classification`

Esperado **200**, `data.contractVersion=1` y `data.responseSchema`. Define:

- `improvedDescription`, `recommendedAction`, `type`, `category`, `urgency`, `sentiment`.
- `keywords` (hasta 10), `aiConfidence` entre 0 y 1, `requiresSupervision`.
- `entities` (hasta 30), cada una con `type`, `value`, `confidence`.

Los enums se obtienen de Prisma; se rechazan propiedades adicionales. Este endpoint no lee prompts privados ni hace llamadas de IA.

### Crear una versión

`POST {{baseUrl}}/admin/ai/prompts`

Pega el JSON completo del archivo del primer prompt. Su forma es:

```json
{
  "name": "incident-classification",
  "version": 1,
  "capability": "INCIDENT_CLASSIFICATION",
  "systemPrompt": "PEGA_AQUI_EL_TEXTO_COMPLETO_DEL_ARCHIVO"
}
```

Esperado **201**, con ID, prompt/esquema, hashes SHA-256 y `active=false`. El ejemplo corto de arriba ilustra la forma; usa el archivo completo para cargar las instrucciones preparadas.

```javascript
pm.test('Versión creada', () => pm.response.to.have.status(201));
pm.environment.set('promptId', pm.response.json().data.id);
```

`name` es un slug de hasta 120 caracteres, minúsculas/dígitos/guiones. `version` es entero positivo y el texto admite hasta 20000 caracteres. `(name, version)` es único, incluso entre capacidades; duplicarlo devuelve 409. No envíes `active`, hashes, autor ni claves: esos campos no son editables por el cliente.

Para otras capacidades se debe enviar `responseSchema` explícito. El perfil local admite objetos, propiedades, campos requeridos, tipos, enums, límites de tamaño/rango e items; no admite `$ref`, `$async`, regex, resolución de URLs ni esquemas arbitrariamente profundos. Máximo 32 KiB, 128 nodos y profundidad 8. Los contratos de chatbot se completarán con su módulo; embeddings normalmente no usan system prompt.

### Listar versiones

`GET {{baseUrl}}/admin/ai/prompts?capability=INCIDENT_CLASSIFICATION&active=false&page=1&limit=20`

Esperado **200**, `data.items` y paginación. Filtros opcionales: `capability`, nombre exacto `name`, `version` y `active=true|false`. Límite máximo 100. El listado devuelve metadatos/hashes, no textos completos ni esquemas extensos.

### Leer una versión

`GET {{baseUrl}}/admin/ai/prompts/{{promptId}}`

Esperado **200** con contenido y esquema. Un UUID inexistente devuelve 404; un ID mal formado devuelve 400.

### Activar

`POST {{baseUrl}}/admin/ai/prompts/{{promptId}}/activate`, sin body.

Esperado **200**, `active=true`. Desactiva las otras versiones de la capacidad dentro de la misma transacción. Activar otra vez la misma versión no duplica auditoría. Activaciones simultáneas se serializan: queda una versión activa, la de la última activación confirmada.

Se puede seleccionar un prompt sin claves ni rutas, para preparar la configuración por etapas. Eso no habilita ejecución ni hace que `config/check` marque toda la capacidad como lista.

### Crear y probar versión 2

Repite el POST de creación con `version=2`, mismo `name` y una modificación revisada en `systemPrompt`. Guarda su ID como `promptV2Id` y activa esa versión. Comprueba por GET que la primera conserva texto y hashes, pero ahora tiene `active=false`.

No existen PATCH ni DELETE de versiones. Los trabajos futuros fijarán `promptVersionId` y hashes; sustituir el activo no reescribe los trabajos que ya referencien una versión anterior.

### Desactivar

`POST {{baseUrl}}/admin/ai/prompts/{{promptId}}/deactivate`, sin body.

Esperado **200** cuando no haya rutas habilitadas que necesiten ese prompt. Si hay, devuelve **409**: deshabilita primero las rutas o activa otra versión como sustitución. Desactivar un prompt ya inactivo es idempotente. EMBEDDING no exige prompt para sus rutas.

### Validar una salida de ejemplo localmente

`POST {{baseUrl}}/admin/ai/prompts/{{promptId}}/validate-output`

Pega [incident-classification-output-example.json](ai/incident-classification-output-example.json). El body tiene la forma `{ "output": { ... } }`.

Esperado **200** con `data.valid=true`, `errors=[]` y `externalRequestsMade=false`. No altera incidencias ni genera clasificación nueva.

Cambia `type` por un enum inexistente, añade `reporterId` o pon confianza mayor a 1: devuelve **200**, `valid=false` y errores. Para CRITICAL o confianza menor a 0.6 se exige `requiresSupervision=true`. Un body mal formado devuelve 400. La muestra se limita a 64 KiB y la validación no convierte tipos, no completa campos ni elimina extras silenciosamente.

## 4. Endpoints de rutas IA

### Crear ruta principal deshabilitada

`POST {{baseUrl}}/admin/ai/routes`

```json
{
  "capability": "INCIDENT_CLASSIFICATION",
  "provider": "CEREBRAS",
  "model": "TU_MODELO_REAL",
  "priority": 1,
  "enabled": false,
  "timeoutMs": 30000
}
```

Sustituye `model` por el identificador disponible en tu cuenta; si usarás otro proveedor elige GROQ u OPENROUTER. No se verifica su catálogo todavía. Esperado **201**. Guarda `data.id` como `routeId`.

`enabled` predeterminado false y `timeoutMs` predeterminado 30000. Timeout permitido 1000–120000 ms; prioridad 1–1000000. Hay un máximo de 100 rutas por capacidad. La prioridad es única en la capacidad, también para rutas deshabilitadas; una colisión devuelve 409.

Para crear una alternativa, cambia proveedor/modelo, usa prioridad 2 y guarda el ID como `fallbackRouteId`. Puede mantenerse deshabilitada aunque no tengas su credencial. No envíes API keys ni base URLs en una ruta.

### Listar rutas

`GET {{baseUrl}}/admin/ai/routes?capability=INCIDENT_CLASSIFICATION&enabled=false&page=1&limit=20`

Esperado **200** con paginación. Filtros: `capability`, `provider`, `enabled=true|false`. Orden por capacidad y prioridad ascendente: número menor se probará primero cuando exista el worker.

### Editar o habilitar ruta

`PATCH {{baseUrl}}/admin/ai/routes/{{routeId}}`

```json
{
  "enabled": true,
  "timeoutMs": 30000
}
```

Esperado **200** solo si el proveedor tiene una clave configurada y hay un prompt activo válido para INCIDENT_CLASSIFICATION o CHATBOT. Si falta algo, **409**. No realiza una llamada real para validar la clave/modelo.

Puedes actualizar `model`, `enabled`, `timeoutMs`. Un body vacío devuelve 400. Capacidad, proveedor y prioridad no se editan por PATCH: crea otra ruta para cambiar proveedor/capacidad, y usa el reordenamiento para prioridades. Embeddings no requieren prompt activo, pero sí credencial; la implementación y compatibilidad real de embeddings se decidirán en su fase.

Para deshabilitar usa `{ "enabled": false }`, incluso si la credencial dejó de estar disponible.

### Reordenar prioridades

`PUT {{baseUrl}}/admin/ai/routes/priorities`

```json
{
  "capability": "INCIDENT_CLASSIFICATION",
  "routeIds": ["{{fallbackRouteId}}", "{{routeId}}"]
}
```

Esperado **200**, con prioridades finales 1 y 2 en ese orden. Incluye todas las rutas de la capacidad, también las deshabilitadas, exactamente una vez. Omisiones/IDs de otra capacidad devuelven 409; duplicados o UUID inválidos devuelven 400. El intercambio usa posiciones temporales dentro de una transacción y no deja prioridades negativas visibles al finalizar.

## 5. Diagnóstico sin consumo de tokens

`GET {{baseUrl}}/admin/ai/providers/status`

Devuelve **200** con un elemento por proveedor, `credentialConfigured` y `availability=NOT_CHECKED`. No devuelve las claves, no muestra prefijos de secretos ni asegura que estén vigentes.

`POST {{baseUrl}}/admin/ai/config/check`

```json
{
  "capability": "INCIDENT_CLASSIFICATION"
}
```

Devuelve **200** con el prompt seleccionado, IDs de rutas habilitadas, problemas y estas distinciones:

- `configurationReady=true`: localmente existe prompt/esquema válido, ruta habilitada y credencial para cada ruta habilitada. EMBEDDING no requiere prompt.
- `executionImplemented=false`: el worker y la integración con proveedores siguen pendientes de la siguiente fase.
- `providerVerification=NOT_CHECKED`: no se verificaron claves, saldo, catálogo ni disponibilidad remota.
- `externalRequestsMade=false`: esta comprobación no consume tokens.

Posibles problemas: `ACTIVE_PROMPT_REQUIRED`, `ACTIVE_PROMPT_SCHEMA_INVALID`, `ENABLED_ROUTE_REQUIRED`, `PROVIDER_KEY_MISSING:PROVEEDOR`. Con body `{}` revisa las tres capacidades; no necesitas configurar CHATBOT/EMBEDDING para continuar con incidencias.

## 6. Lista de endpoints y comprobaciones

| Método | Ruta relativa a `baseUrl` | Resultado normal |
| --- | --- | --- |
| GET | `/admin/ai/contracts/incident-classification` | 200: esquema fijo del clasificador |
| POST | `/admin/ai/prompts` | 201: versión nueva inactiva |
| GET | `/admin/ai/prompts` | 200: metadatos paginados |
| GET | `/admin/ai/prompts/:id` | 200: detalle y contenido |
| POST | `/admin/ai/prompts/:id/activate` | 200: versión seleccionada |
| POST | `/admin/ai/prompts/:id/deactivate` | 200 o 409 por dependencia |
| POST | `/admin/ai/prompts/:id/validate-output` | 200: validación local de muestra |
| POST | `/admin/ai/routes` | 201: ruta creada |
| GET | `/admin/ai/routes` | 200: rutas paginadas |
| PATCH | `/admin/ai/routes/:id` | 200: modelo/estado/timeout |
| PUT | `/admin/ai/routes/priorities` | 200: orden nuevo |
| GET | `/admin/ai/providers/status` | 200: presencia de credenciales |
| POST | `/admin/ai/config/check` | 200: diagnóstico local |

Comprueba los trece con un token CITIZEN/SUPERVISOR/OPERATOR: todos deben devolver **403**. Sin sesión válida, 401; borra también cookies de Postman si haces esta prueba después de usar el login web. En consultas no se acepta `active=texto` o `enabled=texto`; los booleanos se interpretan explícitamente.

Versiones, activaciones, cambios de rutas y reordenamientos escriben auditoría dentro de la misma transacción. No se guarda texto completo de prompts ni credenciales en la bitácora: se registran identificadores, hashes y cambios de configuración. Si la auditoría falla, se revierte la operación.

La API está preparada para una futura sección ADMIN de configuración IA. Las pantallas de ese módulo todavía no forman parte de esta entrega; por ahora se verifica con Postman como acordamos.

## 7. Verificación y siguiente fase

La prueba `test/ai-config.integration.test.cjs` usa PostgreSQL real y JWT/HTTP, en un esquema descartable. Incluye migración e índice, permisos de todos los endpoints, versiones inmutables, schemas, activaciones y reordenamientos concurrentes, conservación de referencias de jobs, ausencia de claves en respuestas y rollback por fallo de auditoría. No necesita MinIO/Redis/proveedores activos ni consume tokens. Usa una credencial falsa solo dentro de la aplicación de prueba para verificar presencia de configuración.

Para repetirla desde PowerShell después de compilar:

```powershell
pnpm run build
$env:RUN_AI_CONFIG_INTEGRATION_TESTS='1'
node --test test/ai-config.integration.test.cjs
Remove-Item Env:RUN_AI_CONFIG_INTEGRATION_TESTS
```

El esquema temporal se elimina al terminar. Se requiere `DATABASE_URL`, permiso de creación de esquema y la extensión vector disponible, igual que para las tablas existentes. Esta prueba no aplica migraciones ni inserta prompts en tus tablas de negocio.

Después de que pruebes configuración y primer prompt, sigue BullMQ/Redis y los adaptadores de clasificación. En esa entrega fijaremos prompt y rutas por job, validaremos respuestas con el contrato preparado y añadiremos submit/retry, historial, reintentos y revisión manual cuando falle un proveedor.
