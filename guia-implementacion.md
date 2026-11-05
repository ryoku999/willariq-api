# Guía oficial de implementación de Willariq

Fecha de revisión: 15 de octubre de 2026. Estado: plan de implementación basado en los tres repositorios locales.

Este documento sustituye a `guia-migracion.md`. La guía anterior describe otro proyecto y sirve como referencia funcional, no como instrucciones para copiar su código, sus migraciones o sus limitaciones. La fuente de verdad de este proyecto es el código actual de `willariq-api`, su esquema Prisma y los contratos que se vayan verificando con Postman y el panel.

En esta etapa se documenta el desarrollo. Los endpoints, carpetas, paquetes y variables marcados como propuestos todavía deben implementarse. No se han instalado dependencias, aplicado migraciones ni implementado módulos como parte de esta revisión documental.

## 1. Objetivo y forma de trabajo

Completar una plataforma municipal de incidencias: registro ciudadano, evidencias, clasificación asistida por IA, revisión humana, asignación y atención municipal, seguimiento, notificaciones, conocimiento y chatbot. Desarrollar API y panel React/Vite de forma coordinada; probar el flujo ciudadano con Postman hasta incorporar la carpeta de React Native al final.

Responsabilidades por cada entrega:

| Responsable | Trabajo |
| --- | --- |
| Tú | Instalar los paquetes indicados para la etapa; preparar credenciales y variables; revisar el código; ejecutar migraciones revisadas y pruebas de endpoints en Postman; validar las pantallas y reglas de negocio. |
| Asistente | Revisar lo existente; implementar carpetas, DTO, servicios, controladores, permisos, migraciones necesarias y conexión del cliente; documentar peticiones y errores; ejecutar las verificaciones disponibles y explicar lo pendiente. |
| Ambos | Cerrar una etapa con evidencias de funcionamiento antes de continuar. Registrar aquí cambios de alcance, nombres definitivos y decisiones. |

No instalar todos los paquetes de esta guía de una vez. Antes de cada etapa se revisará el `package.json` y la compatibilidad de las versiones concretas; los comandos siguientes indican los paquetes necesarios, no una autorización para actualizarlos indiscriminadamente.

Cada entrega debe incluir: alcance, archivos afectados, paquetes que debes instalar, variables nuevas, cambios de BD, ejemplos Postman, integración web, verificación ejecutada y criterio de cierre. El móvil permanece pendiente hasta que agregues su repositorio.

## 2. Estado comprobado de los repositorios

### 2.1 API: `willariq-api`

Stack declarado: NestJS 11, Express, TypeScript, Prisma 7.10, PostgreSQL con `pg` y `@prisma/adapter-pg`, Zod, JWT/Passport, bcryptjs, scheduler y throttler. Mantener `src/database`, `src/shared`, `src/config` y los patrones de módulos actuales.

| Componente | Estado encontrado | Trabajo pendiente |
| --- | --- | --- |
| Inicio HTTP | Prefijo configurable, CORS con credenciales, Helmet, compresión, cookies, validación global, respuesta `{ success, path, data }`, escucha en `0.0.0.0`. | Mantener contratos; completar tratamiento de errores, trazabilidad y protección de mutaciones web. |
| Base de datos | `DatabaseService` usa Prisma y adaptador PostgreSQL. | Sus hooks solo escriben logs: verificar conexión inicial y cierre efectivo del cliente/pool con el comportamiento del adaptador instalado. |
| Configuración | `src/config/env.config.ts` usa Zod; se integra mediante `validationSchema`. | Ampliar el esquema por etapa. El `@nestjs/config` instalado contiene soporte de Standard Schema: no sustituir Zod por Joi por copiar la guía anterior. |
| Auth | Registro por DNI/teléfono; login, refresh rotatorio y logout web/móvil; cookies HttpOnly; JWT por Bearer o cookie. | Logout global, recuperación de contraseña y flujo de correo no están expuestos. Revisar restricciones del login web a personal municipal. |
| Seguridad JWT | Consulta rol y estado actuales del usuario en BD. | Conservar esta comprobación para que bloqueos/cambios de rol afecten las peticiones siguientes. |
| Usuarios | Perfil propio, edición, listado/detalle administrativo, cambio de rol y estado, auditoría y revocación de refresh al cambiar acceso. | Validación concurrente del último administrador y flujos de correo/contraseña posteriores. |
| Áreas | Crear, listar, consultar, editar y activar/desactivar. | Mantener normalización, unicidad, auditoría y bloqueo de desactivación con asignaciones activas. |
| Miembros | Alta/reactivación, listado y baja lógica; control de manager y asignaciones activas. | Pantallas completas; revisar conflictos concurrentes con futuras asignaciones. |
| Auditoría | `AuditService.record` admite cliente transaccional. | Consulta administrativa, filtros y política de retención. |
| Incidencias | Creación idempotente, consultas, historial y cancelación de RECEIVED implementados y probados por el usuario. | Envío IA, revisión y ciclo operativo posteriores. |
| Salud | `GET /health` consulta PostgreSQL y Redis/cola si IA está habilitada; Redis caído degrada y BD caída responde 503. | MinIO, métricas de outbox y readiness ampliada posteriores. |
| Limpieza de tokens | Existe servicio con `@Cron`; scheduler activado al incorporar evidencias. | Seguimiento operativo de tareas periódicas. |
| MinIO/evidencias | StorageModule y EvidenceModule implementados, solo memoria/MinIO; tipos y paquetes ya instalados por el usuario. | Aceptación manual de endpoints y galería web. |
| Configuración IA | Endpoints ADMIN de prompts, contratos, rutas y diagnóstico implementados con AJV y auditoría. | Aplicar migración preparada y aceptación manual; interfaz web pendiente. |
| BullMQ y proveedores IA | Etapa 5 implementada: submit, outbox, worker con leases, clasificación validada, fallback y reintentos auditados. | Aceptación con proveedores reales en Postman; panel pendiente. Ver `docs/postman-incidencias-ia.md`. |
| Conocimiento/chat/notificaciones | Modelos presentes. | Módulos y endpoints pendientes. |

### 2.2 Panel: `willariq-web-admin`

React 19, Vite, React Router, Axios, TanStack Query, Zustand, React Hook Form, Zod, Tailwind y DaisyUI ya están declarados. Reutilizar `core/entities`, `core/contracts`, `infrastructure/services`, `infrastructure/hooks` y `presentation/features`.

| Componente | Estado encontrado |
| --- | --- |
| Sesión | Login, Axios con `withCredentials`, refresh compartido entre peticiones y limpieza de sesión. Zustand persiste información del usuario, no tokens JWT. |
| Acceso | Guards y layouts para ADMIN, SUPERVISOR y OPERATOR. |
| Usuarios | Listado, detalle con cambio de rol/estado y perfil propio. |
| Áreas/miembros | Contratos, entidades y servicios en archivos nuevos; página de áreas de ejemplo sin ruta conectada. Falta completar interfaz. |
| Dashboards | Vistas iniciales de ejemplo para los tres roles; no son tableros operativos. |
| Incidencias, IA, asignaciones, conocimiento y auditoría | No se encontraron funcionalidades implementadas. |

Ajustes concretos para la primera entrega web:

- `MuniAreasService.updateStatus` llama `PATCH /municipal-areas/:id`; el backend espera `PATCH /municipal-areas/:id/status`.
- `lastName` puede ser `null` en BD; los tipos web y accesos como `user.lastName[0]` deben contemplarlo.
- El tipo compartido de rol web solo contempla personal municipal. Separar `StaffRole` para navegación de `UserRole`, que también incluye `CITIZEN` al administrar usuarios. No agregar una zona ciudadana al panel por esta corrección.
- Confirmar que el identificador enviado al quitar miembro sea `userId`, porque el backend no recibe el ID de la fila de membresía.
- Revalidar la sesión con `/users/me` al cargar; los datos persistidos en el navegador no conceden permisos.

### 2.3 Infraestructura: `willariq-infrastructure`

| Componente | Estado encontrado | Pendiente |
| --- | --- | --- |
| PostgreSQL | Compose con `pgvector/pgvector:pg18`, volumen en `/var/lib/postgresql`. | Activación reproducible de extensión `vector`, healthcheck, red privada y configuración de producción. La imagen por sí sola no demuestra que la extensión esté creada en cada BD. |
| Redis | Redis 7, contraseña, AOF y volumen, healthcheck. | Política `noeviction`, nombres coherentes y red interna de producción. |
| MinIO | Servicio, volumen e inicializador que crea el bucket de evidencias. | Bucket de conocimiento, credencial limitada para API, imágenes fijadas, revisar healthcheck y separar dirección de consola de API S3. |
| Documentación/SQL | README y `prisma_manual_extensions.sql` todavía describen PostGIS, `location`, trigger e índice GIST. | Actualizarlos en una entrega de infraestructura: no ejecutar ese SQL sobre este esquema. |
| Esquema duplicado | Hay otro `schema.prisma` en infraestructura. | Tomar como canónico el de API; retirar o identificar la copia como histórica en una entrega posterior. |
| Despliegue | No se encontraron Dockerfiles de API/panel ni Compose conjunto de producción en la revisión. | Prepararlos en la etapa de Dokploy. |

Esta revisión fue de archivos y código. No certifica que los contenedores estén activos, que las migraciones estén aplicadas, que las credenciales funcionen o que los endpoints hayan pasado pruebas reales.

## 3. Decisiones de arquitectura

### 3.1 Coordenadas normales, sin PostGIS

El modelo actual ya tiene `latitude` y `longitude` como `Decimal(10,7)`. Mantenerlo: latitud entre -90 y 90, longitud entre -180 y 180, valores finitos y validación en DTO; agregar restricciones SQL si faltan. La API devolverá coordenadas como números de forma explícita para evitar contratos variables por la serialización de Decimal.

No se necesita geometría, columna `location`, trigger `ST_MakePoint`, extensión PostGIS ni índice GIST. Un mapa web puede dibujar marcadores a partir de las coordenadas normales. La búsqueda por distancia puede añadirse después con un alcance y costo definidos; no promete capacidades espaciales que aún no existen.

pgvector es distinto de PostGIS y se conserva para el RAG futuro. `KnowledgeChunk.embedding` ya existe como `Unsupported("vector")`; la migración inicial usa `vector` pero no contiene `CREATE EXTENSION`. Antes de aplicar el historial en BD nueva o shadow se debe resolver esa dependencia de forma reproducible. No editar silenciosamente una migración aplicada ni copiar el historial del proyecto anterior. Verificar estado real y diseñar un bootstrap de extensión compatible con las dos bases; una migración posterior no corrige por sí sola un fallo de replay en la inicial.

### 3.2 Archivos: cliente → API → MinIO privado

```text
Postman / panel / futuro móvil
        | multipart/form-data, autenticado
        v
NestJS: permisos → Multer → validación → StorageService
        |                                       |
        | metadatos                             | objeto privado
        v                                       v
    PostgreSQL                                 MinIO
```

El cliente hará una sola petición de carga a la API por archivo. No solicitará URLs presignadas ni confirmará uploads directos. `StorageModule` encapsulará MinIO; `EvidenceModule` aplicará las reglas de incidencias. Los documentos de conocimiento usarán el mismo almacenamiento con validaciones distintas.

Multer se integra con `MulterModule.registerAsync`, `FileInterceptor('file')`, `@UploadedFile()` y `memoryStorage()`. Por decisión del usuario, no guardar archivos en disco de la API ni usar carpetas temporales. Recibir una imagen por petición en RAM acotada y enviarla a MinIO; al habilitar documentos grandes evaluar streaming con límites explícitos. Referencia: [carga de archivos en NestJS](https://docs.nestjs.com/techniques/file-upload).

La descarga también pasa por API con verificación de propiedad/alcance y stream privado. No se necesita `MINIO_PUBLIC_ENDPOINT` para este flujo. No guardar URLs temporales en BD, ni aceptar `bucket`/`objectKey` suministrados por el cliente. Conservar el archivo como objeto y su referencia como metadatos.

### 3.3 IA configurable y revisión humana

Las claves van en variables de entorno del backend. Los prompts, versiones, modelos, prioridades y timeouts van en BD y se administran por endpoints ADMIN. No se requieren claves IA para implementar la creación/listado de incidencias; se necesitan al integrar el análisis automático.

La IA sugiere clasificación y redacción; no acepta, rechaza, asigna o cierra incidencias automáticamente. El texto ciudadano se conserva. Los fallos de proveedor no impiden la revisión manual.

### 3.4 Consistencia y contratos

- Mutación de negocio + historial + auditoría + notificación/outbox dentro de una misma transacción PostgreSQL cuando correspondan.
- Redis y MinIO no forman parte de una transacción SQL: usar outbox para colas y compensación/reconciliación para archivos.
- Las mutaciones operativas envían `expectedVersion`; la actualización exige coincidencia e incrementa `version`. Un conflicto devuelve 409.
- La autorización se comprueba en servicios y consultas, además del guard de rol. Los filtros de interfaz nunca reemplazan permisos.
- Mantener `{ success, path, data }` para JSON; omitir el envoltorio en streams. Serializar `BigInt` como cadena decimal y fechas como ISO 8601.
- Listados con paginación limitada, orden determinista y filtros validados; no devolver textos de prompts, respuestas crudas o datos personales innecesarios en bandejas.

## 4. Orden de desarrollo y dependencias

| Etapa | Entrega | Dependencia | Integración web |
| --- | --- | --- | --- |
| 0 | Ajustes base, contratos y configuración | Código actual | Sesión, tipos y correcciones existentes |
| 1 | Completar áreas y miembros en panel | API actual + etapa 0 | CRUD y miembros por permisos |
| 2 | Incidencias: creación, consultas e historial | Etapa 0 | Bandeja y detalle inicial |
| 3 | Storage/MinIO y evidencias por Multer | Etapa 2 | Galería privada; ciudadano por Postman |
| 4 | Configuración IA: prompts y rutas | Etapas 0 y 2 | Configuración ADMIN |
| 5 | Redis/BullMQ, outbox y clasificación IA | Etapas 2–4 | Seguimiento de análisis, revisión y errores |
| 6 | Revisión humana y asignaciones | Etapa 5 | Bandejas ADMIN/SUPERVISOR/OPERATOR |
| 7 | Notificaciones internas y auditoría consultable | Escrituras desde etapas anteriores | Bandeja y bitácora |
| 8 | Correo y ciclo de cuenta completo | Auth existente | Perfil y recuperación |
| 9 | Conocimiento, procesamiento y embeddings | Storage + colas + configuración IA | Documentos y publicación ADMIN |
| 10 | Chatbot con seguimiento y RAG | Etapa 9 | Prueba web y Postman |
| 11 | Tableros, integración y pruebas de aceptación | Flujo operativo completo | Panel completo por rol |
| 12 | Docker y despliegue privado en Dokploy | Etapas verificadas | Panel productivo |
| 13 | React Native | Incorporar carpeta cuando tú lo indiques | Aplicación ciudadana al final |

La etapa 2 es el siguiente módulo de negocio. Las etapas 3–5 completan su flujo con archivos e IA; no acoplar una primera creación de incidencia a todos los proveedores externos.

## 5. Etapa 0 — Estabilizar la base sin rehacerla

**Paquetes:** ninguno nuevo para los ajustes actuales. Ya están Zod, Prisma, scheduler, JWT y validadores.

**Variables existentes que debes verificar en API:**

```dotenv
NODE_ENV=development
PORT=8000
API_PREFIX=api
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=postgresql://USUARIO:CLAVE@localhost:5432/BASE
RATE_LIMIT_LIMIT=100
RATE_LIMIT_TTL=60000
JWT_SECRET=REEMPLAZAR_POR_SECRETO_ALEATORIO
JWT_ISSUER=willariq-api
JWT_AUDIENCE=willariq
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
AUTH_ACCESS_COOKIE_NAME=willariq_access
AUTH_REFRESH_COOKIE_NAME=willariq_refresh
AUTH_COOKIE_SECURE=false
AUTH_COOKIE_SAME_SITE=lax
```

Valores de ejemplo, no secretos reales ni configuración ya aplicada. `RATE_LIMIT_TTL` se interpreta en milisegundos en la integración actual. API_PREFIX debe seguir la convención del código; los ejemplos de rutas siguientes omiten `/api`.

**Variable del panel:** `VITE_API_URL=http://localhost:8000/api`. Debe incluir el prefijo una sola vez. Ninguna API key, contraseña o secreto de MinIO se coloca en `VITE_*`, cuyos valores se incorporan al cliente. Referencia: [variables de Vite](https://vite.dev/guide/env-and-mode).

**Implementación prevista:** activar scheduler una vez; completar lifecycle de BD; validar configuración con las versiones instaladas; distinguir liveness de readiness; normalizar errores y contratos de paginación; corregir nullables y rutas del panel. Proteger mutaciones con cookie mediante validación de origen y estrategia CSRF, contemplando refresh/login; CORS y HttpOnly no bastan por sí solos. Postman móvil usa Bearer y no debe confundirse con el flujo de cookies.

Preparar un bootstrap administrativo controlado: comando local idempotente y documentado que cree el primer ADMIN con contraseña hasheada y sin credenciales públicas fijas. No exponer un registro público con selección de rol. No pedir inserciones SQL manuales como flujo habitual.

**Tus pruebas:** login/refresh/logout web y móvil; refresh usado dos veces; cuenta bloqueada; rol actualizado; 401/403/429; origen permitido/rechazado; campos extra en DTO. Los endpoints de auth actuales deben seguir funcionando.

**Cierre:** servidor inicia con configuración válida, falla claramente si falta una variable obligatoria y permite validar el resto de etapas con los cuatro roles de prueba. No basta con compilar.

## 6. Etapa 1 — Áreas y miembros en el panel

**Paquetes y variables nuevos:** ninguno. Reutilizar las librerías actuales y `VITE_API_URL`.

**API existente que se mantiene:**

| Método | Ruta |
| --- | --- |
| POST / GET | `/municipal-areas` |
| GET / PATCH | `/municipal-areas/:id` |
| PATCH | `/municipal-areas/:id/status` |
| POST / GET | `/municipal-areas/:id/members` |
| DELETE | `/municipal-areas/:id/members/:userId` |

ADMIN gestiona áreas. ADMIN o miembro activo MANAGER gestiona miembros; SUPERVISOR no obtiene automáticamente permiso de gestión de miembros por su rol global. Conservar las reglas actuales del servicio. SUPERVISOR puede consultar miembros; OPERATOR consulta según membresía/estado de área.

**Panel:** conectar rutas, menú, listado con filtros, formularios, detalle, estado, miembros y mensajes de conflicto. Para seleccionar operadores/managers, un ADMIN puede usar `/users`; si un MANAGER no administrador necesita buscar personal elegible, añadir un endpoint acotado como `GET /municipal-areas/:id/eligible-members`, con autorización de gestión y proyección mínima. No abrir el listado administrativo completo de usuarios a operadores.

**Tus pruebas:** duplicados normalizados, alta/reactivación/baja de miembro, manager ajeno, baja propia del manager, ciudadano no elegible y área inactiva. Reprobar bloqueos de desactivación/baja cuando existan asignaciones.

**Cierre:** gestión de áreas y miembros desde el panel sin usar SQL ni romper permisos actuales.

## 7. Etapa 2 — Núcleo de incidencias

**Paquetes:** ninguno nuevo. DTO con class-validator/class-transformer; persistencia con el `DatabaseService` existente.

**Variables nuevas propuestas:**

```dotenv
INCIDENT_TRACKING_PREFIX=WIL
INCIDENT_TRACKING_TIME_ZONE=America/Lima
```

**Modelos existentes:** `Incident`, `IncidentTrackingCounter`, `IncidentHistory`, `IncidentEntity`. Reutilizar `UserRole`, no el nombre antiguo `AppRole`.

**Carpetas previstas:** ampliar `src/modules/incidents/` con `dto/`, políticas de acceso, servicio de código correlativo y reglas de transición. Exportar servicios concretos para asignaciones, evidencias e IA; evitar dependencias circulares entre módulos.

| Endpoint propuesto | Alcance |
| --- | --- |
| `POST /incidents` | CITIZEN crea su reporte. |
| `GET /incidents` | Bandeja paginada: ciudadano solo los propios; personal según alcance. |
| `GET /incidents/:id` | Detalle autorizado con versión y metadatos operativos. |
| `GET /incidents/:id/history` | Historial autorizado y paginado. |
| `POST /incidents/:id/cancel` | Ciudadano propietario en RECEIVED; ADMIN/SUPERVISOR según política y estado definidos abajo. |

Creación con `clientRequestId`, `originalMessage`, coordenadas, dirección y referencia opcionales. El servidor determina `reporterId` y el origen según el canal autorizado; no permite suplantar al reportante. Durante Postman se usa el contrato ciudadano/móvil, aunque no exista todavía React Native.

Ejemplo de cuerpo previsto:

```json
{
  "clientRequestId": "reporte-prueba-001",
  "originalMessage": "Hay acumulación de basura junto al mercado",
  "latitude": -12.0464,
  "longitude": -77.0428,
  "address": "Referencia de prueba",
  "addressReference": "Frente a la entrada principal"
}
```

Generar correlativo por prefijo/año atómicamente, tomando año en America/Lima. Usar unicidad `(reporterId, clientRequestId)` y `requestFingerprint`: misma clave y mismo contenido devuelven el mismo recurso; contenido diferente devuelve 409. La creación guarda RECEIVED, historial inicial y auditoría en la misma transacción. No usar `count + 1` para códigos.

Filtros: estado, tipo, categoría, urgencia, fechas, código y, cuando existan asignaciones, área/operador. ADMIN y SUPERVISOR tienen alcance global operativo. OPERATOR solo asignaciones propias o alcance de MANAGER activo; no obtiene la bandeja global previa a la asignación. El ciudadano solo sus recursos. Aplicar estas reglas también a estadísticas, historial, archivos y trabajos.

**Panel:** bandeja por rol, detalle, filtros persistentes en URL, paginación, estados vacíos, errores y recarga por 409. Inicialmente mostrará reportes creados desde Postman.

**Tus pruebas:** repetición idempotente, clave con contenido distinto, coordenadas fuera de rango, usuario ajeno, código concurrente, filtros y paginación. Cancelar RECEIVED impide adjuntar/enviar después.

**Cierre:** puedes crear, listar y consultar incidencias reales con código e historial, sin requerir IA ni MinIO.

## 8. Etapa 3 — Storage y evidencias simples con Multer/MinIO

**Paquetes que instalarás en API:**

```bash
pnpm add minio multer
pnpm add -D @types/multer
```

`@nestjs/platform-express` ya existe. No se necesita `multer-s3`, AWS SDK ni un endpoint de upload directo al bucket para este diseño. Usar el cliente oficial [MinIO JavaScript SDK](https://github.com/minio/minio-js).

**Variables nuevas propuestas:**

```dotenv
MINIO_ENABLED=true
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=REEMPLAZAR_CREDENCIAL_DE_APLICACION
MINIO_SECRET_KEY=REEMPLAZAR_SECRETO
MINIO_REGION=us-east-1
MINIO_EVIDENCE_BUCKET=incident-evidence
MINIO_KNOWLEDGE_BUCKET=knowledge-base
EVIDENCE_MAX_IMAGE_BYTES=5242880
EVIDENCE_MAX_FILES_PER_INCIDENT=5
EVIDENCE_MAX_TOTAL_BYTES_PER_INCIDENT=26214400
UPLOAD_MAX_CONCURRENT_REQUESTS=4
```

Límites iniciales: imagen de 5 MiB, cinco imágenes, 25 MiB por incidencia y cuatro cargas simultáneas por proceso. No se usa `UPLOAD_TEMP_DIR`: las imágenes van de memoria a MinIO. `MINIO_KNOWLEDGE_BUCKET` corresponde a una fase posterior, no es necesario para evidencias. Convertir explícitamente booleanos de entorno; no usar coerción que convierta la cadena `false` en verdadero.

**Tu preparación:** levantar MinIO, crear buckets privados y credencial de servicio con acceso solo a ellos. `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` corresponden a infraestructura; la API no usa el administrador raíz. Configurar límites de proxy coherentes con archivo más sobrecarga multipart.

**Módulos previstos:** `src/infrastructure/storage/` con contrato y adaptador MinIO, y `src/modules/evidence/` para permisos, validación y persistencia.

| Endpoint propuesto | Comportamiento |
| --- | --- |
| `POST /incidents/:id/evidence` | `multipart/form-data`, un campo binario `file`; retorna evidencia persistida. |
| `GET /incidents/:id/evidence` | Lista metadatos autorizados, sin URL pública. |
| `GET /incidents/:id/evidence/:evidenceId/content` | Stream autenticado del objeto. |
| `DELETE /incidents/:id/evidence/:evidenceId` | Retirada lógica/según política; borrado físico reconciliable. |

Primera versión: ciudadano propietario agrega/retira solo en RECEIVED. ADMIN/SUPERVISOR y personal autorizado leen según alcance. Si se requieren fotos de resolución, habilitar su carga solo al responsable y en IN_PROGRESS mediante una evolución que identifique `purpose=REPORT/RESOLUTION`; ese campo no existe actualmente y requiere migración.

Flujo interno:

1. Autenticar y comprobar acceso antes de procesar la carga; limitar tamaño, campos, partes y cantidad con Multer.
2. Validar extensión y firma real mediante `FileTypeValidator` de Nest, sin confiar en el MIME del cliente. Esta entrega identifica JPEG/PNG/WebP por contenido; no incorpora un decoder/recodificador de imágenes. Rechazar SVG, ejecutables y formatos no implementados.
3. Calcular SHA-256, generar clave aleatoria segura y subir a bucket privado. No usar el nombre original como ruta.
4. Persistir metadatos, historial relevante y auditoría; revalidar versión/estado/cuota dentro de una sección transaccional serializada por incidencia. Si hubo submit/cancel o una carga concurrente agotó cuota, retirar el objeto y devolver conflicto.
5. Si falla la BD después del upload, compensar eliminando el objeto; si también falla la eliminación, registrar limpieza pendiente. Reconciliar objetos sin referencia después de una ventana de seguridad. Una caída de proceso no puede depender solo del `catch`.

No mantener abierta una transacción SQL durante el tráfico de archivos. Las altas/retiros incrementan la versión de incidencia. La idempotencia implementada es por SHA-256 de los bytes dentro de la incidencia: reenviar una imagen activa devuelve el mismo ID, sin incrementar cuota, versión ni historial. El multipart solo recibe `file`; no requiere clave ni confirmación adicional del cliente.

`EvidenceUploadIntent` se reutiliza internamente para seguir cada transferencia y recuperar eliminaciones pendientes, sin cambios de esquema ni exposición al cliente. PENDING expira tras una hora; CONFIRMED protege un objeto referenciado; REJECTED queda pendiente de limpieza y EXPIRED indica una limpieza completada. Un reconciliador cada minuto procesa hasta 25 entradas del prefijo exclusivo `evidence/api-v1/`. `KnowledgeUploadIntent` queda sin usar por ahora. La retirada lógica usa `IncidentEvidence.status=REJECTED`, conserva auditoría e impide descarga mientras se completa el borrado físico.

La respuesta de descarga debe saltar el interceptor JSON, enviar `Content-Type` seguro, `Content-Disposition` saneado y propagar/cerrar errores del stream. Postman permite guardar el binario; el panel carga Blob autenticado y libera sus Object URLs. No hacer públicos los buckets para resolver una imagen rota.

**Tus pruebas:** form-data `file`, tipo falso, exceso de tamaño/cuota, usuario ajeno, cargas concurrentes, submit durante upload, MinIO caído, BD fallida y descarga desde panel. La API no debe devolver éxito si falta el objeto o su referencia.

**Cierre:** una petición carga el archivo a través de API y otra descarga con permisos; no se necesitan URLs de MinIO en Postman/panel.

## 9. Etapa 4 — Administración de prompts y rutas IA

**Paquetes:** `ajv` ya instalado por el usuario y utilizado para validar esquemas y muestras de salida. Se reutilizan Zod, crypto y validadores existentes. No hacen falta SDK de proveedores en esta fase. El contrato persistible de incidencias es fijo y no se puede ampliar arbitrariamente mediante un prompt.

**Variables:** `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` son opcionales para guardar configuración inactiva y necesarias solo para habilitar rutas de su proveedor. Se comprueba presencia local, sin llamadas externas ni consumo de tokens. El panel no recibe ni modifica credenciales; el administrador las configura en el entorno/Dokploy. La integración real con proveedores sigue en etapa 5.

**Modelos existentes:** `PromptVersion` y `AiRoute`. El módulo `src/modules/ai-config/` ya implementa servicios separados de prompts, rutas, proveedores y validación de esquemas, con auditoría transaccional. La migración `20261015180000_ai_prompt_activation` fija default inactivo y unicidad parcial de activo por capacidad; se preparó y probó en un esquema aislado, sin aplicarla a las tablas de negocio del usuario.

| Endpoint propuesto, solo ADMIN | Función |
| --- | --- |
| `POST /admin/ai/prompts` | Crear versión inactiva de un prompt. |
| `GET /admin/ai/prompts` | Listar por capacidad/nombre/versión/activo. |
| `GET /admin/ai/prompts/:id` | Leer contenido y esquema. |
| `POST /admin/ai/prompts/:id/activate` | Activar versión atómicamente. |
| `POST /admin/ai/prompts/:id/deactivate` | Desactivar, con validación de dependencias. |
| `POST /admin/ai/routes` | Crear ruta de proveedor/modelo. |
| `GET /admin/ai/routes` | Listar rutas y estado habilitado. |
| `PATCH /admin/ai/routes/:id` | Editar modelo, timeout y habilitación. |
| `PUT /admin/ai/routes/priorities` | Reordenar una capacidad en una transacción sin chocar con prioridades únicas. |
| `GET /admin/ai/providers/status` | Mostrar solo si hay credencial configurada y disponibilidad conocida. |
| `POST /admin/ai/config/check` | Validar configuración utilizable sin consumir tokens. |

Una prueba que haga llamadas reales será un endpoint separado y limitado, implementado con etapa 5; indicará consumo y no modificará incidencias productivas.

Endpoints adicionales implementados: `GET /admin/ai/contracts/incident-classification` entrega el esquema canónico, y `POST /admin/ai/prompts/:id/validate-output` valida una muestra local sin consumir tokens. El diagnóstico diferencia configuración local válida de ejecución pendiente (`executionImplemented=false`) y disponibilidad no verificada (`NOT_CHECKED`).

El primer system prompt completo está en [incident-classification-v1.json](docs/ai/incident-classification-v1.json), listo para pegar como body en Postman. Se omite `responseSchema` para que la API asigne el contrato canónico; enviarlo explícitamente exige que coincida con ese contrato. Ejemplo de forma del body, usando el texto completo del archivo:

```json
{
  "name": "incident-classification",
  "version": 1,
  "capability": "INCIDENT_CLASSIFICATION",
  "systemPrompt": "PEGAR_EL_SYSTEM_PROMPT_COMPLETO_DEL_ARCHIVO"
}
```

Reglas de versionado:

- Conservar `@@unique([name, version])`. Contenido y esquema de toda versión creada son inmutables por API; editar significa crear otra versión. El endpoint fuerza `active=false` y la nueva migración también cambia ese default en BD.
- Para la primera versión del sistema, habrá un prompt activo por capacidad; la activación desactiva el anterior en la misma transacción. La BD actual no garantiza esa unicidad: añadir índice parcial único para filas activas y depurar conflictos antes. Si después se necesitan varias familias por capacidad, introducir selección explícita, no `findFirst` ambiguo.
- Calcular hashes del prompt/esquema; fijar el `promptVersionId`, hashes e instantánea de rutas en cada `AiJob`. Activar una nueva versión no altera un trabajo ya creado.
- Validar que las claves esperadas coincidan con el parser y los enums de la aplicación. El prompt y su JSON Schema no otorgan permiso para escribir cualquier campo de BD.
- No borrar versiones usadas por trabajos; desactivar conserva trazabilidad. Auditar autor, acción y versión. Añadir metadatos de autor/notas por migración si se requiere mostrarlos sin consultar la auditoría.
- Para rutas, respetar la unicidad actual `(capability, priority)` y límites de timeout. Reordenar usando prioridades temporales válidas o una estrategia equivalente dentro de transacción.
- Evitar habilitar una capacidad sin prompt/ruta/credencial utilizable; presentar el motivo en el panel. Puede guardarse configuración incompleta como inactiva.

**Panel ADMIN pendiente:** sección Configuración IA con lista y editor de prompts, historial, comparación de versiones, activación y tabla de rutas ordenables. Los endpoints ya están listos; esta entrega se valida por Postman. Mostrar proveedor/modelo, nunca API keys.

**Tus tareas:** redactar el prompt municipal real, pegarlo en el body o formulario, elegir modelos disponibles en tus cuentas, revisar esquema y activar. No insertar prompts directamente en BD ni cambiar código para cada versión.

**Tus pruebas:** versión duplicada, dos activaciones concurrentes, permisos de supervisor/operador denegados, esquema incompatible, ruta sin credencial y reordenamiento sin colisiones.

**Cierre:** puedes crear/activar una versión y configurar rutas completamente por endpoints y panel.

## 10. Etapa 5 — Redis, BullMQ y clasificación de incidencias

**Paquetes que instalarás en API:**

```bash
pnpm add @nestjs/bullmq bullmq ioredis
```

`ioredis` será dependencia directa si el código crea conexiones para salud/operación. Usar la integración [BullMQ de NestJS](https://docs.nestjs.com/techniques/queues); no introducir Bull antiguo en paralelo.

**Variables nuevas propuestas:**

```dotenv
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=REEMPLAZAR_SECRETO
REDIS_DB=0
BULLMQ_PREFIX=willariq-dev
AI_ENABLED=true
AI_WORKER_ENABLED=true
AI_WORKER_CONCURRENCY=2
AI_JOB_MAX_ROUNDS=2
AI_JOB_LEASE_SECONDS=120
AI_JOB_HEARTBEAT_SECONDS=30
AI_JOB_MAX_TOTAL_MS=180000
OUTBOX_POLL_INTERVAL_MS=2000
OUTBOX_BATCH_SIZE=25
OUTBOX_MAX_ATTEMPTS=10
CEREBRAS_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Las claves pueden faltar para proveedores deshabilitados. Validar al activar rutas que la credencial del proveedor esté disponible. Al menos un proveedor utilizable para demostrar análisis real; Cerebras principal y OpenRouter/Groq como alternativas solo si sus rutas están configuradas. Los modelos van en `AiRoute`, no en variables duplicadas.

No se requiere instalar tres SDK. La propuesta inicial es un contrato común con adaptadores HTTP y `fetch` nativo, cancelación y timeout. Verificar parámetros, salida estructurada y catálogo de cada proveedor antes de implementarlo: [OpenRouter](https://openrouter.ai/docs/api_reference/overview), [Groq](https://console.groq.com/docs/openai). La compatibilidad de un endpoint no garantiza que todos los modelos acepten el mismo JSON Schema.

**Implementación entregada (16/10/2026):** `src/infrastructure/queue/`, `src/modules/incident-ai/`, adaptador HTTP de proveedores, processor y dispatcher con reconciliación. Reutiliza `AiJob`, `AiAttempt`, `QueueOutbox` y el scheduler existente sin migración nueva. Pruebas y ejemplos completos: [Postman: clasificación IA](docs/postman-incidencias-ia.md). La siguiente tabla describe endpoints ya implementados, no solo propuestas. Reintento acotado a último trabajo FAILED en IN_REVIEW sin revisión humana; no reclasifica resultados exitosos.

| Endpoint propuesto | Alcance |
| --- | --- |
| `POST /incidents/:id/submit` | Ciudadano propietario envía RECEIVED con `expectedVersion`; devuelve 202 y job/código. |
| `GET /incidents/:id/ai-jobs` | Estado resumido según acceso a incidencia. |
| `GET /admin/ai/jobs/:id` | ADMIN/SUPERVISOR; diagnóstico saneado, sin claves. |
| `POST /incidents/:id/ai/retry` | ADMIN/SUPERVISOR o MANAGER autorizado, sin trabajo activo ni estado terminal. |
| `GET /admin/queues/outbox` | ADMIN: pendientes, antigüedad y errores. |
| `POST /admin/queues/outbox/:id/retry` | ADMIN: republicación controlada de DEAD, auditable. |

Secuencia prevista:

1. `submit` bloquea/actualiza la incidencia por versión y estado, congela el contenido enviado, crea `AiJob` con configuración fijada y `QueueOutbox` en una transacción. Si IA está deshabilitada por configuración operativa, usa revisión manual explícita y deja constancia; no simula éxito IA.
2. El dispatcher reclama outbox vencidas con bloqueo/lease, publica con `jobId` estable derivado del UUID de `AiJob` y marca PUBLISHED. El `aggregateId` debe ser el job, no la incidencia, porque una incidencia puede tener varios reintentos.
3. Un crash entre publicar y marcar puede duplicar la entrega; el worker debe ser idempotente mediante estado/lease en PostgreSQL. No prometer ejecución exactamente una vez.
4. El worker toma token de procesamiento, mantiene heartbeat y registra cada llamada en `AiAttempt`. Respeta prioridad, rondas y presupuesto total; no multiplicar sin límite reintentos de BullMQ por reintentos propios.
5. Parsear y validar salida con contrato estricto: tipo, categoría, urgencia, sentimiento, descripción mejorada, acción sugerida, confianza, entidades y `requiresSupervision`. Rechazar enums inválidos, texto fuera de límites y valores no finitos.
6. Aplicar resultado en transacción solo si el token sigue vigente, estado/versión siguen siendo compatibles y no se aplicó antes. Guardar clasificación, entidades, historial, auditoría y notificaciones; pasar a IN_REVIEW. Un trabajo antiguo nunca sobrescribe una revisión humana más reciente.
7. Agotados proveedores/presupuesto, job FAILED e incidencia IN_REVIEW con aviso y ruta manual. Recuperar PROCESSING abandonados y outbox con lease vencido. Una caída de Redis no revierte una incidencia ya guardada: queda pendiente de publicación.

Redis tendrá AOF, volumen y `maxmemory-policy=noeviction`. Separar los parámetros de conexión que deben fallar pronto en HTTP de los workers que esperan reconexión; usar prefijo BullMQ, no `keyPrefix` de ioredis. Referencia: [conexiones BullMQ](https://docs.bullmq.io/guide/connections).

**Panel:** estado de procesamiento con polling moderado solo mientras haya trabajo activo, diagnóstico y reintento por permisos. Nunca renderizar errores del proveedor que expongan Authorization o el contenido personal completo del reporte.

**Tus pruebas:** éxito, 429, timeout, JSON inválido, todos los proveedores caídos, Redis desconectado, reinicio de worker, entrega duplicada, cambio de prompt con job pendiente y reintento tras revisión. Reintentar crea otro `AiJob` vinculado por `retryOfJobId`, no borra intentos anteriores.

**Cierre:** ningún trabajo se pierde por un fallo entre SQL y Redis; toda incidencia enviada termina revisable o queda visiblemente pendiente con recuperación comprobada.

## 11. Etapa 6 — Revisión humana, asignación y atención

**Paquetes y variables nuevos:** ninguno obligatorio. Reutilizar Prisma, auditoría y notificaciones. `AssignmentsModule` consume políticas/transiciones exportadas por incidencias.

Flujo principal:

```text
RECEIVED → AI_ANALYSIS → IN_REVIEW → ACCEPTED → ASSIGNED
                            |                      |
                            v                      v
                         REJECTED             IN_PROGRESS → RESOLVED → CLOSED
```

El modo manual autorizado puede llevar RECEIVED a IN_REVIEW sin IA. `classificationSource` distingue AI, HUMAN y MANUAL_WITHOUT_AI. ACCEPTED es un estado de incidencia; la aceptación del operador se refleja en `IncidentAssignment.status=ACCEPTED` sin confundir ambos enums.

| Endpoint propuesto | Función |
| --- | --- |
| `POST /incidents/:id/review` | Completar/corregir clasificación, motivo y versión. |
| `POST /incidents/:id/accept` | Aceptar desde IN_REVIEW con campos requeridos completos. |
| `POST /incidents/:id/reject` | Rechazar con motivo/comentario. |
| `POST /incidents/:id/assignments` | Asignar área y, opcionalmente, operador elegible. |
| `GET /incidents/:id/assignments` | Historial autorizado. |
| `POST /incidents/:id/reassignments` | Reasignar conservando `replacesId`. |
| `GET /assignments/me` | Bandeja de trabajo propia. |
| `POST /assignments/:id/accept` | Responsable acepta asignación. |
| `POST /assignments/:id/cancel` | Cancelar asignación con motivo. |
| `POST /incidents/:id/start` | Iniciar trabajo de asignación aceptada. |
| `POST /incidents/:id/resolve` | Resolver con resumen obligatorio y evidencia si la política lo exige. |
| `POST /incidents/:id/close` | ADMIN/SUPERVISOR cierra RESOLVED con asignación completada. |

Política propuesta: ADMIN/SUPERVISOR revisan y deciden globalmente. MANAGER solo opera incidencias de su área ya autorizada; OPERATOR ordinario acepta/inicia/resuelve su asignación. La bandeja inicial sin área corresponde a ADMIN/SUPERVISOR. `requiresSupervision=true` exige decisión de SUPERVISOR o ADMIN. Ni ciudadanía ni IA pueden saltar este control.

Asignaciones: usuario y área activos, membresía activa, rol elegible, una sola asignación activa por incidencia. Añadir un índice parcial único SQL para estados activos, porque el esquema actual solo tiene índices normales. Comprobar versiones de incidencia y asignación en la misma transacción; ante colisión devolver 409. Cancelar asignación activa antes de resolver devuelve incidencia a ACCEPTED; reasignar sustituye la anterior y mantiene ASSIGNED. No eliminar trazabilidad.

Cancelación de incidencia: ciudadano solo RECEIVED; ADMIN/SUPERVISOR pueden cancelar RECEIVED, AI_ANALYSIS, IN_REVIEW o ACCEPTED con motivo, invalidando resultados IA pendientes. Desde ASSIGNED/IN_PROGRESS primero deben resolver/cancelar la asignación de forma transaccional según política operativa. RESOLVED, CLOSED y REJECTED no se cancelan por esta ruta. No añadir reapertura hasta definir su flujo y auditoría.

**Panel ADMIN:** bandeja global, detalle, revisión, asignación y cierre. **SUPERVISOR:** revisión priorizada, supervisión, asignaciones y cierre. **OPERATOR:** mis asignaciones, aceptar, iniciar, evidencias de resolución y resolver; funciones de manager solo si tiene esa membresía.

**Tus pruebas:** recorrido completo con cuatro cuentas, áreas ajenas, operador inactivo, dos asignaciones simultáneas, rechazo sin motivo, versión antigua, baja de miembro con trabajo activo y cierre anticipado.

**Cierre:** recorrido desde reporte ciudadano hasta CLOSED con historial y permisos comprobados en API y panel.

## 12. Etapa 7 — Notificaciones internas y consulta de auditoría

**Paquetes/variables nuevos:** ninguno en el primer alcance. Usar consultas/polling; WebSocket y push quedan para una necesidad posterior.

Crear desde etapas anteriores las notificaciones de cambios relevantes dentro de la transacción de negocio. Unicitarlas por evento/destinatario para que un retry no duplique la bandeja; el esquema actual no tiene esa restricción y puede necesitar `eventKey` y migración. Evitar notificar a todos los usuarios en cada acción.

| Endpoint propuesto | Acceso |
| --- | --- |
| `GET /notifications` | Bandeja propia paginada. |
| `GET /notifications/unread-count` | Conteo propio. |
| `PATCH /notifications/:id/read` | Solo destinatario. |
| `POST /notifications/read-all` | Solo propias. |
| `GET /admin/audit-logs` | ADMIN con filtros y paginación. |
| `GET /admin/audit-logs/:id` | ADMIN con proyección saneada. |

Definir semántica de `PENDING/SENT/READ`: para bandeja interna puede registrarse entregada al persistir, sin inventar un envío push. `readAt` indica lectura; la entrega externa futura tendrá su propia trazabilidad. Auditar decisiones operativas, cambios de acceso y configuración IA sin registrar contraseñas, tokens ni API keys.

**Panel:** campana, bandeja propia y bitácora ADMIN. **Tus pruebas:** acceso cruzado, lectura idempotente, conteo consistente y ausencia de duplicados tras retries. **Cierre:** cambios operativos producen avisos y pueden rastrearse por actor/entidad.

## 13. Etapa 8 — Correo y ciclo de cuenta

**Paquete propuesto en API:** `pnpm add resend` al elegir y configurar ese proveedor. No es necesario para incidencias iniciales.

**Variables propuestas:** `RESEND_API_KEY`, `RESEND_FROM`, `EMAIL_VERIFICATION_URL`, `PASSWORD_RESET_URL`, `EMAIL_TOKEN_TTL_MINUTES=60`, `PASSWORD_RESET_TOKEN_TTL_MINUTES=30`.

Crear MailModule; verificación/cambio de correo; recuperación y cambio de contraseña; logout global. Usar tablas `EmailVerificationToken` y `PasswordResetToken`; tokens aleatorios, hash, expiración, uso único y revocación. No invalidar una contraseña hasta que se confirme el restablecimiento. Respuestas de recuperación que no revelen existencia de cuenta; rate limit y enlaces de origen fijo.

Rutas propuestas: `PUT /users/me/email`, `POST /users/me/email/verification-requests`, `POST /users/email-verifications/confirm`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/logout-all` y `PATCH /users/me/password`.

**Tus tareas:** dominio/remitente verificado y URLs reales. **Panel:** formularios de perfil, verificación, olvido y cambio de contraseña. **Pruebas:** expiración, reutilización, token alterado, correo duplicado y revocación de sesiones. **Cierre:** recuperación funciona sin SQL ni intervención manual.

## 14. Etapa 9 — Conocimiento y embeddings

**Paquetes:** almacenamiento/colas ya instalados. Empezar con TXT y Markdown, sin parser nuevo. Si se habilita PDF, seleccionar y fijar un extractor mantenido después de comprobar su API; paquete propuesto `pdf-parse` (`pnpm add pdf-parse`), más dependencias/tipos solo si la versión elegida los requiere. PDF escaneado/OCR no forma parte de esa primera extracción.

**Variables propuestas:**

```dotenv
KNOWLEDGE_MAX_DOCUMENT_BYTES=10485760
KNOWLEDGE_CHUNK_TARGET_TOKENS=600
KNOWLEDGE_CHUNK_OVERLAP_TOKENS=100
KNOWLEDGE_WORKER_CONCURRENCY=1
OPENROUTER_EMBEDDING_MODEL=ELEGIR_MODELO_REAL
OPENROUTER_EMBEDDING_DIMENSIONS=ELEGIR_DIMENSION_REAL
OPENROUTER_EMBEDDING_TIMEOUT_MS=30000
OPENROUTER_EMBEDDING_BATCH_SIZE=16
```

Los valores `ELEGIR_*` son pendientes que debes resolver antes de activar el módulo; no son valores válidos para arrancar. Los límites/tokens son iniciales propuestos, no mediciones del proyecto.

Usar `KnowledgeDocument`, `KnowledgeChunk` y `AiJob` de embeddings. Añadir vínculo explícito del job al documento, fingerprint de versión y progreso si son necesarios: el `AiJob` actual no tiene `knowledgeDocumentId`. Un procesamiento largo devuelve 202, se ejecuta con BullMQ y permite consultar estado; no copiar el procesamiento síncrono de la guía antigua.

| Endpoint propuesto, ADMIN | Función |
| --- | --- |
| `POST /knowledge/documents` | Multipart `file`, título y tipo; API sube a MinIO privado. |
| `GET /knowledge/documents` / `GET /knowledge/documents/:id` | Listado y detalle/estado. |
| `GET /knowledge/documents/:id/content` | Descargar documento autenticado. |
| `POST /knowledge/documents/:id/process` | Crear job de extracción, fragmentación y embeddings. |
| `GET /knowledge/documents/:id/jobs` | Progreso/error de procesamiento. |
| `POST /knowledge/documents/:id/publish` | Publicar solo READY y versión procesada consistente. |
| `POST /knowledge/documents/:id/archive` | Excluir del RAG manteniendo historial. |

Elegir un modelo de embeddings, dimensión y métrica; documentos y consultas deben usar el mismo espacio vectorial. No heredar automáticamente 2048 de la guía antigua. Migrar `vector(N)` según el modelo y usar SQL parametrizado para el tipo no soportado. Validar longitud, números finitos, modelo y versión antes de guardar. Reprocesar una nueva versión no debe dejar publicada una mezcla incompleta de chunks.

El índice se elegirá con datos y dimensión concretos: HNSW sobre `vector` admite hasta 2000 dimensiones; no crear ese índice de forma automática para vectores de 2048. Evaluar menor dimensión admitida, búsqueda exacta o `halfvec` compatible cuando corresponda. Referencia: [pgvector e índices](https://github.com/pgvector/pgvector).

Documentos y consultas de conocimiento son datos no confiables: limitar extracción, tamaño descomprimido y contexto; evitar ejecutar enlaces o instrucciones contenidas en los archivos. Las fuentes WEB requieren un módulo posterior con protección SSRF; no habilitar descarga arbitraria de URLs por existir `sourceUrl`.

**Tus tareas:** elegir modelo/dimensión y aportar documentos municipales autorizados. **Panel:** carga, progreso, errores, vista de chunks/metadatos, publicar/archivar. **Pruebas:** tipo inválido, job repetido, error de embedding, dimensión incorrecta y exclusión de documentos archivados. **Cierre:** solo conocimiento listo y publicado es recuperable por RAG.

## 15. Etapa 10 — Chatbot municipal con fuentes

**Paquetes:** ninguno nuevo si se reutilizan adaptadores IA, colas y vector SQL. No se requiere incorporar LangChain para este alcance inicial.

**Variables propuestas:** `RAG_TOP_K=5`, `RAG_MIN_SIMILARITY=0.70`, `RAG_MAX_CONTEXT_TOKENS=4000`, `CHAT_MAX_MESSAGE_CHARS=4000`, `CHAT_MAX_HISTORY_MESSAGES=20`. Ajustar umbral según evaluaciones reales y la métrica elegida; no tratarlo como precisión garantizada.

Usar PromptVersion/AiRoute con capacidad CHATBOT; el prompt específico se carga por los endpoints ADMIN. No reutilizar el prompt del clasificador para conversación.

Rutas propuestas: `POST/GET /chat/sessions`, `GET /chat/sessions/:id`, `GET/POST /chat/sessions/:id/messages`, `POST /chat/sessions/:id/close` y `GET /chat/jobs/:id`. Solo propietario puede acceder a sesión/job. Mensajes con `clientRequestId` idempotente; encolar respuesta y devolver 202 + job para no mantener la conexión HTTP esperando al proveedor.

Seguimiento por código: consultar BD con autorización sobre la incidencia; un código conocido no concede acceso público a detalles personales. Para preguntas municipales: embedding de consulta, chunks publicados, límite de contexto, respuesta con fuentes e IDs guardados en `AiJobKnowledgeChunk`. Sin evidencia suficiente, decir que no hay información y ofrecer el canal municipal configurado; no inventar trámites, plazos o números de emergencia.

**Panel:** prueba de chatbot para ADMIN y consulta de fuentes; no ofrecer historial privado de ciudadanos a operadores por defecto. **Tus pruebas:** código ajeno, sesión ajena, falta de fuentes, prompt injection dentro de un PDF, timeout e idempotencia. **Cierre:** seguimiento autorizado y respuestas municipales con fuentes verificables.

## 16. Etapa 11 — Panel completo y aceptación funcional

**Paquetes y variables:** ninguno obligatorio. Para un mapa, evaluar `leaflet`, `react-leaflet` y tipos compatibles solo cuando se implemente esa vista; acordar proveedor de teselas y sus condiciones antes de producción. No hace falta PostGIS para dibujar coordenadas.

Rutas web previstas, adaptadas a los layouts actuales:

| Área web | Secciones |
| --- | --- |
| ADMIN | Usuarios, áreas, miembros, incidencias, asignaciones, Configuración IA, trabajos/outbox, conocimiento, auditoría, notificaciones, perfil. |
| SUPERVISOR | Bandeja global y supervisión, revisión, seguimiento de áreas, asignaciones, cierre, notificaciones, perfil. |
| OPERATOR | Mis asignaciones, detalle autorizado, aceptar/iniciar/resolver, notificaciones, perfil; gestión de miembros si es MANAGER. |

Sustituir dashboards de ejemplo por métricas reales calculadas por API con los mismos permisos. Endpoint propuesto `GET /dashboard/summary` con conteos por estado, prioridad y tiempos definidos; un operador no debe inferir métricas de áreas ajenas. Definir desde qué fecha se mide cada duración y su zona horaria.

Para cada función añadir entidad/contrato, servicio HTTP, hook Query y pantalla; invalidar queries afectadas por cambios. Formularios con errores del servidor, botón deshabilitado mientras se procesa y manejo claro de 401, 403, 404, 409, 413 y 429. No almacenar archivos/Blob permanentes en Zustand ni llaves del servidor en el bundle.

**Pruebas conjuntas:** reporte → evidencia → submit → IA → revisión → aceptación → asignación → aceptación de operador → inicio → resolución → cierre; notificaciones, auditoría y consultas. Repetir sin IA y con proveedor principal fallido. Verificar concurrencia en decisiones y ausencia de exposición de datos entre roles.

**Cierre:** ADMIN, SUPERVISOR y OPERATOR pueden trabajar desde el panel; Postman cubre aún el rol ciudadano.

## 17. Etapa 12 — Docker, VPS privado y Dokploy

Infraestructura es un repositorio de servicios, no un único contenedor que deba contener todas las bases. La topología objetivo será:

| Servicio/contenedor | Responsabilidad | Exposición |
| --- | --- | --- |
| PostgreSQL | Datos relacionales y pgvector | Solo red privada. |
| Redis | BullMQ y persistencia de colas | Solo red privada. |
| MinIO | Objetos y volúmenes | S3 interno; consola solo acceso administrativo restringido. |
| API NestJS | HTTP, negocio, dispatcher y worker inicial | Dominio HTTPS de API mediante proxy Dokploy. |
| Panel | Build estático Vite servido por Nginx u otro servidor estático | Dominio HTTPS del panel. |
| Worker opcional posterior | Misma imagen de API, proceso de colas independiente | Sin dominio público. |

Inicialmente API y worker pueden convivir en un contenedor con concurrencia limitada; disponer de entrypoint/contexto separado para independizarlo si aumenta carga. Si se separa, desactivar worker en HTTP y evitar duplicar schedulers no diseñados para múltiples instancias. Los leases y claves únicas siguen siendo necesarios.

**Paquetes Node nuevos:** ninguno obligatorio para contenerización. Preparar Dockerfiles multi-stage, `.dockerignore`, runtime compatible con Prisma/Nest instalados, usuario sin privilegios, límites de recursos y apagado ordenado. Fijar versión de Node, pnpm e imágenes probadas; no basar producción en `latest`.

**Variables de producción:** mismas por módulo, con hostnames de servicios privados, no `localhost`; `NODE_ENV=production`, cookies Secure, CORS exacto del panel y DATABASE_URL privada. Dominio sugerido `admin.tu-dominio` y `api.tu-dominio`, ajustando SameSite según dominios reales. Ejemplos de host: `postgres`, `redis`, `minio`, si esos nombres existen en la red compartida.

Si Dokploy despliega repos separados, crear red compartida explícita y aliases verificables; los nombres locales de Compose no garantizan conectividad entre stacks. Evitar publicar puertos de BD/Redis/S3 al público. Revisar nombres fijos `container_name` antes de tener staging/producción.

**Panel productivo:** `VITE_API_URL` se fija durante build, no basta con cambiar una variable del contenedor estático ya compilado. Servir SPA con fallback a `index.html`, cache apropiada para assets versionados y sin usar `vite dev` o `vite preview` como servidor productivo.

**Secuencia CI/CD por repositorio:**

1. Instalar con lockfile congelado y versiones fijadas.
2. API: validar esquema, generar Prisma y compilar; ejecutar verificaciones pertinentes. Panel: typecheck/build y lint de lectura.
3. Construir imágenes reproducibles etiquetadas por commit.
4. Preparar respaldo antes de cambios de datos; aplicar migraciones como tarea única de despliegue con CLI disponible, no desde cada réplica.
5. Desplegar API y comprobar readiness; desplegar panel y ejecutar smoke test de sesión/flujo crítico.
6. Si falla, volver a imagen anterior compatible. Una reversión de imagen no revierte automáticamente una migración SQL; diseñar cambios compatibles y restauración por separado.

Dokploy puede gestionar los servicios y sus despliegues desde Compose; ajustar redes y dominios al mecanismo concreto elegido. Referencia: [Docker Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose).

**Tu preparación:** VPS, DNS, HTTPS, repositorios conectados, ramas de despliegue, secretos en Dokploy y presupuesto de recursos. **Implementación del asistente:** archivos de contenedor/red, healthchecks, pipeline verificable, runbook y documentación de backup/restore; sin desplegar hasta que se solicite esa etapa.

Persistencia: volúmenes separados para PostgreSQL, Redis y MinIO; respaldos coordinados de BD y objetos fuera del VPS, cifrados y con retención. Redis AOF no reemplaza un backup; la BD/outbox permite reconciliar publicación pendiente, y los jobs publicados perdidos deben poder detectarse/reencolarse. Probar restauración completa con referencias de archivos, no solo crear copias.

Readiness distinguirá dependencias críticas: BD indisponible → 503; Redis/IA caídos pueden degradar análisis manteniendo reportes/outbox; upload reporta indisponibilidad si MinIO falla. No marcar saludable todo el sistema por responder el proceso HTTP. Incluir logs con requestId/jobId, antigüedad de outbox, jobs fallidos y uso de disco/RAM sin secretos.

**Cierre:** los tres repositorios se despliegan en servicios separados, reinician sin perder datos, el panel opera por HTTPS y se demuestra restauración desde backup.

## 18. Etapa 13 — React Native, al final

No crear todavía la carpeta móvil ni elegir librerías en tu nombre. Cuando la agregues, revisar si usa Expo o React Native nativo y documentar paquetes exactos compatibles. No confundir una app nativa con un servicio Docker: se distribuye como build móvil; API y panel sí viven en el VPS.

Funciones: registro/login, almacenamiento seguro de tokens, rotación, crear reporte con `clientRequestId`, ubicación con permiso, imágenes por multipart a API, envío/seguimiento, historial, notificaciones y chatbot con fuentes. Implementar reintentos sin duplicar reportes/archivos y experiencia con conectividad intermitente.

Variable pública: URL HTTPS de API según el mecanismo del proyecto móvil. Ningún secreto de proveedores o MinIO en el APK/IPA. Usar Keychain/Keystore para tokens, no almacenamiento plano. `UserDevice` y push requieren endpoints y proveedor específicos que se decidirán aquí; push y notificación interna son canales diferentes.

**Tus tareas:** agregar repositorio, elegir framework/dispositivos y aportar credenciales de distribución/push cuando corresponda. **Cierre:** ciudadano completa el flujo real desde dispositivo sin alterar contratos del panel/API ya verificados.

## 19. Cambios de base de datos previstos y manejo de Prisma

No recrear todo el esquema: muchas tablas finales ya existen. Introducir migraciones pequeñas solo para necesidades comprobadas:

| Necesidad | Acción prevista |
| --- | --- |
| Replay de `vector` en BD nueva/shadow | Bootstrap reproducible de extensión revisado contra historial aplicado. |
| Un prompt activo por capacidad | Índice parcial único y activación transaccional; conservar versiones. |
| Una asignación activa por incidencia | Índice parcial único para estados activos y reglas transaccionales. |
| Cuotas de evidencias/idempotencia | Serialización por incidencia y campo/registro de clave si se necesita. |
| Archivos de resolución | Propósito de evidencia si se habilita esa función. |
| Notificaciones sin duplicados | Clave de evento/destinatario y unicidad. |
| Jobs de documentos | Relación documento/job y progreso/versionado necesarios. |
| Embeddings | Dimensión/modelo/índice elegidos por medición, sin dimensión heredada. |
| Tablas de upload antiguas | Retiro posterior solo tras comprobar datos y dependencias. |

El archivo de configuración actual se llama `prisma7.config.ts`; los comandos deben indicarlo explícitamente mientras conserve ese nombre. Ejecutar desde la raíz de API, después de revisar el SQL y preparar las extensiones:

```bash
pnpm exec prisma validate --config prisma7.config.ts
pnpm exec prisma migrate dev --config prisma7.config.ts --name nombre_de_la_etapa --create-only
```

Después de revisar la migración, en desarrollo:

```bash
pnpm exec prisma migrate dev --config prisma7.config.ts
pnpm exec prisma generate --config prisma7.config.ts
pnpm run build
```

En producción usar `pnpm exec prisma migrate deploy --config prisma7.config.ts`, con las migraciones incluidas en la imagen/tarea y backup preparado. Generar Prisma explícitamente antes del build; no asumir que migrar genera el cliente. No utilizar reset, borrado de volumen ni `db push` con pérdida de datos como procedimiento de migración. Si aparece drift, analizarlo antes de actuar.

## 20. Pruebas, seguimiento y siguiente entrega

Colección Postman prevista por carpetas: Auth, Usuarios, Áreas, Miembros, Incidencias, Evidencias, Configuración IA, Trabajos, Asignaciones, Notificaciones, Auditoría, Conocimiento y Chat. Entorno con `baseUrl`, tokens de prueba por rol, IDs y versiones; no exportar secretos reales en colecciones compartidas.

Para cada módulo registrar al menos: caso correcto, datos inválidos, usuario sin permiso, recurso ajeno, conflicto de estado/versión y dependencia externa fallida si aplica. Las pruebas automáticas se centrarán en transiciones, autorización, idempotencia y concurrencia; las pruebas manuales del usuario complementan esas garantías.

El script actual `pnpm run lint` de API usa `--fix`; para una revisión sin cambios usar una invocación de ESLint sin `--fix`. La existencia de `dist` o `node_modules` no demuestra que el código fuente actual compile ni que haya pasado pruebas.

| Entrega | Estado al crear esta guía |
| --- | --- |
| Revisión de los tres repositorios y sustitución de guía | Completada documentalmente. |
| Etapa 0: ajustes base | Pendiente de implementación. |
| Etapa 1: áreas/miembros web | Pendiente de completar. |
| Etapa 2: incidencias | Implementada en API y validada manualmente por el usuario. Bandeja/detalle web pendientes. |
| Etapa 3: evidencias | Implementada y validada manualmente por el usuario: RAM → MinIO, listado, descarga, retirada y limpieza. |
| Etapa 4: configuración IA | API implementada; primer prompt preparado; migración y pruebas manuales del usuario pendientes. Panel web pendiente. |
| Etapa 5: Redis, BullMQ y clasificación | API implementada y flujo IA validado manualmente por el usuario. |
| Etapa 6: revisión humana y asignaciones | API implementada y validada por el usuario en Postman, incluidas cancelación y reasignación. Panel pendiente. |
| Etapa 7: notificaciones y auditoría | API implementada. Migración en base de negocio y pruebas HTTP en Postman pendientes. [Guía de pruebas](docs/notificaciones-auditoria-postman.md). |
| Etapas 8–12 | Planificadas, todavía pendientes. |
| React Native | En espera de que incorpores su carpeta. |

El usuario validó la etapa 6 de la API en Postman, incluido el recorrido de revisión y atención, cancelación y reasignación. La [guía Postman de revisión y asignaciones](docs/revision-asignaciones-postman.md) documenta cómo reproducir esas pruebas. El siguiente alcance de backend es la etapa 7, notificaciones internas y consulta de auditoría. Las pantallas siguen pendientes de su entrega web.

Verificación de etapa 6: compilación TypeScript aislada, ESLint y Prisma validate correctos; pruebas de DTO, metadatos de guardas, composición de módulos y transacciones PostgreSQL en esquema temporal. Incluye versiones, permisos, índice único, competencia entre asignaciones/baja de miembro, rollback de auditoría, supervisión y cancelación con invalidación IA. La validación manual de la API se registró por separado en el estado de la etapa.

Verificación histórica de incidencias y evidencias: build/lint y pruebas de integración correctos en sus entregas; el usuario confirmó ambos módulos en Postman. En configuración IA se verificaron build, ESLint sin advertencias, validación del esquema Prisma y 17 escenarios HTTP/PostgreSQL en `test/ai-config.integration.test.cjs` (18 resultados contando la prueba contenedora). Incluyen índice y migración, permisos de los trece endpoints, hashes, schemas y muestras, activaciones/prioridades concurrentes, referencias de jobs y rollback por auditoría. Se regeneró Prisma Client. Los esquemas de prueba se eliminaron al terminar; la migración de configuración IA no se aplicó a las tablas de negocio. Falta aplicar esa migración y tu aceptación manual de esta fase.

Esta guía se actualizará al cerrar cada etapa con endpoints reales, paquetes/versiones instaladas, variables efectivamente validadas y resultados de pruebas. Un elemento del plan solo pasa a implementado cuando exista código y se haya verificado su comportamiento.
