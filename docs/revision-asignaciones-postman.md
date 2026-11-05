# Etapa 6: revisión humana, asignación y atención — Postman

Implementado en la API: revisión, aceptación/rechazo, asignación y reasignación, bandeja propia, aceptación del responsable, inicio, evidencias durante la atención, resolución y cierre. Incluye permisos, versiones, historial, auditoría y notificaciones internas en PostgreSQL. No incorpora pantallas ni entrega push/email.

## 1. Preparación

No necesitas paquetes ni variables de entorno nuevos. Reutiliza PostgreSQL, autenticación, auditoría, Redis/IA y RustFS existentes. La atención y revisión humanas no requieren llamar a un proveedor IA.

Se preparó la migración `20261105030000_active_incident_assignment`: índice parcial único sobre `incident_assignments.incidentId` para estados ASSIGNED, ACCEPTED e IN_PROGRESS. No se aplica automáticamente a tu base. Si ya existen dos asignaciones activas para un caso, falla sin elegir ni borrar registros; revisa esos casos antes de repetirla.

Desde la raíz del proyecto, revisa y aplica las migraciones pendientes tú mismo:

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm exec prisma migrate deploy --config prisma7.config.ts
pnpm run build
```

`migrate deploy` aplica **todas** las pendientes, así que revisa primero el estado. No uses reset ni db push para reemplazar esta migración. El modelo no añade campos, por lo que esta entrega no exige regenerar el cliente. Después enciende tú el servidor con tu comando habitual.

Prepara cuentas activas ADMIN, SUPERVISOR, OPERATOR y CITIZEN. Para pruebas de alcance, agrega un segundo operador ajeno. Crea un área activa y una membresía activa del responsable. Un encargado tiene rol de usuario OPERATOR y membresía MANAGER; ambos roles son distintos. Un SUPERVISOR también puede ser responsable si pertenece al área.

## 2. Postman

Environment privado:

```text
UrlBase = http://localhost:8000/api
adminToken
supervisorToken
operatorToken
managerToken
citizenToken
incidentId
incidentVersion
areaId
operatorId
assignmentId
assignmentVersion
```

Usa Authorization → Bearer Token con la cuenta indicada y Body → raw → JSON, salvo archivos. No mezcles cookies de otra cuenta con los tokens de la prueba.

Las respuestas conservan `{ success, path, data }`. Las acciones nuevas devuelven:

```json
{
  "incident": {
    "id": "UUID",
    "status": "ACCEPTED",
    "version": 5,
    "classificationSource": "AI",
    "reviewedAt": "FECHA"
  },
  "assignment": null
}
```

Es un ejemplo parcial de `data`. Cuando existe asignación, `data.assignment` contiene su ID, estado y versión además de área, responsable y fechas. Después de cada acción exitosa guarda las versiones actuales. Puedes usar este script en **Scripts → Post-response** de las acciones:

```javascript
pm.test('Operación exitosa', () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));
if (pm.response.code >= 200 && pm.response.code < 300) {
  const data = pm.response.json().data;
  pm.environment.set('incidentVersion', data.incident.version);
  if (data.assignment) {
    pm.environment.set('assignmentId', data.assignment.id);
    pm.environment.set('assignmentVersion', data.assignment.version);
  }
}
```

Los cuerpos JSON usan números sin comillas para las versiones: `{{incidentVersion}}`. Si consultas el detalle habitual `GET /incidents/:id`, la versión está en `data.version`, sin el objeto `incident`.

## 3. Revisar o confirmar la propuesta IA

Empieza con tu incidencia IN_REVIEW. `GET {{UrlBase}}/incidents/{{incidentId}}` permite leer la propuesta. Guarda su versión actual; el ejemplo de tu prueba tenía versión 4, pero no la reutilices si ya cambió.

ADMIN o SUPERVISOR pueden aceptar una propuesta completa sin corregirla: la aceptación registra quién la revisó y cuándo, y conserva `classificationSource=AI` porque los campos proceden de IA.

Para corregir o completar una clasificación, usa ADMIN/SUPERVISOR:

`POST {{UrlBase}}/incidents/{{incidentId}}/review`

```json
{
  "expectedVersion": {{incidentVersion}},
  "reason": "Se revisó el reporte y se confirmó su clasificación municipal.",
  "improvedDescription": "Se reporta basura acumulada frente al mercado municipal desde ayer.",
  "recommendedAction": "Inspeccionar el lugar y coordinar la recolección de los residuos.",
  "type": "ENVIRONMENT",
  "category": "GARBAGE_ACCUMULATION",
  "urgency": "LOW",
  "sentiment": "NEUTRAL",
  "requiresSupervision": false,
  "keywords": ["basura", "mercado municipal"],
  "entities": []
}
```

**200**: permanece IN_REVIEW, `classificationSource=HUMAN`, `reviewedAt` registrado y versión incrementada. Este endpoint recibe la clasificación completa, no un PATCH. Las entidades reemplazan el conjunto actual; `[]` lo vacía. El mensaje original, ubicación y confianza histórica IA no se reescriben. Si urgency es CRITICAL se exige requiresSupervision=true. Una revisión manual no solicita nueva aiConfidence.

También permite completar un caso MANUAL_WITHOUT_AI tras fallo o desactivación de IA. Una incidencia en RECEIVED se envía primero por `/submit`; con IA desactivada pasa al flujo manual autorizado existente.

`requiresSupervision=false` nunca autoriza al ciudadano a decidir. Con true, las decisiones siguen reservadas a ADMIN/SUPERVISOR. Un operador no accede a la bandeja inicial global.

## 4. Aceptar o rechazar

Con ADMIN/SUPERVISOR:

`POST {{UrlBase}}/incidents/{{incidentId}}/accept`

```json
{ "expectedVersion": {{incidentVersion}} }
```

**200**, IN_REVIEW → ACCEPTED. Exige tipo, categoría, urgencia, sentimiento, descripción mejorada y acción recomendada completos. Actualiza versión y registra revisión humana aunque se conserve la clasificación IA. ACCEPTED significa que la incidencia puede asignarse.

Alternativa para un caso distinto en IN_REVIEW:

`POST {{UrlBase}}/incidents/{{incidentId}}/reject`

```json
{
  "expectedVersion": {{incidentVersion}},
  "rejectionReason": "OUT_OF_SCOPE",
  "reason": "El reporte corresponde a un asunto fuera del alcance municipal."
}
```

**200**, pasa a REJECTED y guarda motivo y comentario. `rejectionReason` es un código de texto de hasta 80 caracteres; `reason`, comentario obligatorio hasta 1000. No se permite continuar con asignación ni reabrir por estas rutas.

## 5. Asignar

ADMIN/SUPERVISOR, desde ACCEPTED:

`POST {{UrlBase}}/incidents/{{incidentId}}/assignments`

```json
{
  "expectedVersion": {{incidentVersion}},
  "areaId": "{{areaId}}",
  "operatorId": "{{operatorId}}",
  "note": "Atender la acumulación de residuos frente al mercado."
}
```

**201**, incidencia ASSIGNED y asignación ASSIGNED, versión inicial de asignación 1. Guarda ambos ID/versiones. El área, usuario y membresía deben estar activos; el responsable debe tener rol OPERATOR o SUPERVISOR.

Puedes omitir operatorId para asignar solo al área. En ese caso no puede aceptarse ni iniciarse hasta designar responsable mediante reasignación. ADMIN no es un rol elegible como responsable.

`GET {{UrlBase}}/incidents/{{incidentId}}/assignments?page=1&limit=20`

**200**, historial paginado, más reciente primero. Acceden el propietario y personal con acceso actual a la incidencia. La tabla conserva asignaciones canceladas y sustituidas; una asignación anterior no concede acceso por sí sola.

`GET {{UrlBase}}/assignments/me?page=1&limit=20`

Con token del responsable: **200**, solo asignaciones propias no canceladas ni sustituidas y dentro de su alcance vigente. Incluye completadas. No es la bandeja de todo el área del manager; para ese alcance utiliza el listado de incidencias con `areaId`.

## 6. El responsable acepta e inicia

Token del usuario asignado:

`POST {{UrlBase}}/assignments/{{assignmentId}}/accept`

```json
{
  "expectedVersion": {{incidentVersion}},
  "assignmentId": "{{assignmentId}}",
  "expectedAssignmentVersion": {{assignmentVersion}}
}
```

**200**. La asignación pasa a ACCEPTED; **la incidencia permanece ASSIGNED**. Ambas versiones se incrementan. Se exige que el ID del body coincida con el de la ruta.

`POST {{UrlBase}}/incidents/{{incidentId}}/start`

Mismo body, con las versiones actualizadas.

**200**. Incidencia y asignación pasan a IN_PROGRESS. Solo el responsable activo puede aceptar, iniciar y resolver: ADMIN, SUPERVISOR o MANAGER no sustituyen al responsable por tener más permisos. Un SUPERVISOR designado sí puede realizar su propio trabajo.

## 7. Evidencias y resolución

Mientras esté IN_PROGRESS, el responsable puede adjuntar una imagen:

`POST {{UrlBase}}/incidents/{{incidentId}}/evidence`

Token del responsable, **form-data**, campo `file` de tipo File. Reutiliza formatos, tamaños y límites existentes, almacenamiento privado y validación de contenido. El personal no puede eliminar evidencias. Las imágenes siguen en la colección de evidencias del caso; autor y fechas quedan en auditoría.

Después de subir una imagen, guarda el `data.incidentVersion` devuelto o consulta el detalle. La versión de asignación no cambia por la imagen. En esta entrega la evidencia de resolución es opcional: no se inventa un requisito municipal no definido en la guía. No se permite resolver mientras existan cargas vigentes pendientes de confirmar.

`POST {{UrlBase}}/incidents/{{incidentId}}/resolve`

```json
{
  "expectedVersion": {{incidentVersion}},
  "assignmentId": "{{assignmentId}}",
  "expectedAssignmentVersion": {{assignmentVersion}},
  "resolutionSummary": "Se retiraron los residuos y se realizó la limpieza del lugar."
}
```

**200**. Incidencia RESOLVED y asignación COMPLETED. El resumen es obligatorio; registra responsable y fechas. Guarda nuevas versiones.

## 8. Cerrar

ADMIN/SUPERVISOR:

`POST {{UrlBase}}/incidents/{{incidentId}}/close`

```json
{ "expectedVersion": {{incidentVersion}} }
```

**200**, RESOLVED → CLOSED. Exige resumen y asignación completada no sustituida. Un operador no puede cerrar. No hay reapertura en esta etapa.

Consulta detalle, historial y asignaciones para comprobar el recorrido. Se generan notificaciones internas; esta entrega no envía correo ni push.

## 9. Reasignación y cancelaciones

### Reasignar desde ASSIGNED o IN_PROGRESS

ADMIN/SUPERVISOR pueden cambiar área y responsable. MANAGER activo solo puede reasignar casos ya autorizados dentro de su misma área, y únicamente si no requieren supervisión.

`POST {{UrlBase}}/incidents/{{incidentId}}/reassignments`

```json
{
  "expectedVersion": {{incidentVersion}},
  "assignmentId": "{{assignmentId}}",
  "expectedAssignmentVersion": {{assignmentVersion}},
  "areaId": "{{areaId}}",
  "operatorId": "{{operatorId}}",
  "reason": "Se designa un nuevo responsable para atender el caso."
}
```

**201**. La anterior pasa a REASSIGNED; la nueva apunta a ella con replacesId y nace ASSIGNED. La incidencia queda ASSIGNED, incluso si ya estaba IN_PROGRESS: el nuevo responsable debe aceptar e iniciar. Guarda el **nuevo assignmentId** y ambas versiones. No se elimina el historial anterior.

### Cancelar una asignación activa

ADMIN/SUPERVISOR, o MANAGER autorizado del área si el caso no requiere supervisión:

`POST {{UrlBase}}/assignments/{{assignmentId}}/cancel`

```json
{
  "expectedVersion": {{incidentVersion}},
  "assignmentId": "{{assignmentId}}",
  "expectedAssignmentVersion": {{assignmentVersion}},
  "reason": "Se cancela esta asignación para reorganizar la atención."
}
```

**200**. Asignación CANCELLED e incidencia ACCEPTED, preparada para una nueva asignación. Un operador ordinario no cancela ni siquiera su propio trabajo. Las completadas no se cancelan por esta ruta.

### Cancelar la incidencia

`POST {{UrlBase}}/incidents/{{incidentId}}/cancel`

```json
{
  "expectedVersion": {{incidentVersion}},
  "reason": "Reporte duplicado confirmado."
}
```

Ciudadano propietario: únicamente RECEIVED. ADMIN/SUPERVISOR: RECEIVED, AI_ANALYSIS, IN_REVIEW o ACCEPTED. Si está ASSIGNED/IN_PROGRESS, cancela primero su asignación y usa la nueva versión para cancelar la incidencia. RESOLVED, CLOSED y REJECTED no se cancelan por esta ruta. La cancelación administrativa invalida trabajos IA pendientes/en ejecución para impedir que apliquen resultados tardíos; no deshace una llamada al proveedor que ya haya empezado.

## 10. Errores y pruebas

| Prueba | Resultado |
| --- | --- |
| Sin sesión válida | 401 |
| Ciudadano intenta revisar/asignar/atender/cerrar | 403 |
| Operador ajeno intenta ver historial/asignaciones o trabajar un caso | 404, sin revelar el caso |
| Responsable intenta iniciar antes de aceptar | 409 |
| Versión anterior de incidencia o asignación | 409, sin cambios parciales |
| Falta motivo, resumen, versión, UUID válido o hay campos extra | 400 |
| Área inactiva, responsable inactivo/no miembro/no elegible | 409 |
| Dos asignaciones simultáneas con la misma versión | Una gana, la otra 409; una sola activa |
| MANAGER intenta cambiar de área o decidir caso con supervisión | 403 |
| Rechazo sin motivo | 400 |
| Cierre anticipado | 409 |
| Baja de miembro responsable, inactivación del área o cambio de rol/estado del responsable con trabajo activo | 409 |
| Cambiar rol/estado de usuario sin trabajo activo | Conserva reglas de administración existentes |
| Cancelar un caso con asignación vigente | 409; cancela primero la asignación |
| Repetir aceptación, resolución o cierre con versión antigua | 409 |

Las operaciones de negocio y auditoría se confirman juntas. Un fallo de auditoría revierte la decisión. No hay reintento idempotente automático de acciones: consulta estado y versiones antes de repetir una operación cuya respuesta se perdió.

## 11. Verificación automatizada

```bash
pnpm run build
RUN_INCIDENT_WORKFLOW_INTEGRATION_TESTS=1 node --test test/incident-workflow.integration.test.cjs
```

La prueba no inicia Nest, servidor HTTP, Redis, RustFS ni proveedores. Crea un esquema PostgreSQL aleatorio `willariq_workflow_test_*`, aplica las migraciones exclusivamente allí y lo elimina al terminar. Requiere permisos de creación de esquema y la extensión vector disponible, igual que las pruebas previas. No aplica la migración a tus tablas de negocio ni consume tokens IA.

Cubre recorrido completo, revisión manual, permisos de servicio, validación de DTO, versiones antiguas, índice único, reasignación, cancelación, fallo de auditoría y concurrencia de asignación con baja de miembro. Las pruebas manuales de esta guía verifican además JWT y HTTP reales en el servidor que tú enciendas.
