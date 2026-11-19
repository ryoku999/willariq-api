# Etapa 7 · Notificaciones internas y auditoría en Postman

La bandeja pertenece al usuario autenticado. La bitácora se consulta con el rol ADMIN. El cliente puede consultar el contador periódicamente por HTTP. Los avisos se entregan en la bandeja al persistirlos en PostgreSQL.

## Preparación

Usa las dependencias y variables del backend que ya tienes. Desde la raíz de la API revisa las migraciones pendientes, aplícalas y genera el cliente Prisma.

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm exec prisma migrate deploy --config prisma7.config.ts
pnpm exec prisma generate --config prisma7.config.ts
```

`migrate deploy` aplica todas las migraciones pendientes. La nueva migración agrega una clave de evento opcional y un índice único por destinatario y evento. Las filas históricas conservan sus datos y su estado. Los avisos nuevos usan el ID y la versión de la incidencia como clave estable. Si se repite el evento, se conserva la fila original y su fecha de lectura.

Después arranca la API. En Postman configura `UrlBase` (por ejemplo, `http://localhost:8000/api`), `citizenToken`, `operatorToken` y `adminToken`. Usa **Authorization → Bearer Token**. Si probaste el login web, limpia las cookies al cambiar de cuenta para comprobar los permisos de cada token.

## Bandeja y lectura

| Método y ruta relativa a `{{UrlBase}}` | Respuesta 200 en `data` |
| --- | --- |
| `GET /notifications?page=1&limit=20` | `items` y `pagination`, del aviso más reciente al más antiguo. |
| `GET /notifications?unreadOnly=true` | Solo avisos propios sin `readAt`. |
| `GET /notifications/unread-count` | `{ "count": 2 }`, por ejemplo. |
| `PATCH /notifications/{{notificationId}}/read` | Aviso propio con `readAt`. |
| `POST /notifications/read-all` | `{ "updated": 2 }`, por ejemplo. |

Las dos acciones de lectura se envían sin body. La API conserva el envoltorio `{ success, path, data }`. La paginación usa `page` (1 por defecto) y `limit` (20 por defecto, máximo 100). Los resultados incluyen `id`, `type`, `title`, `body`, `data`, `createdAt` y `readAt`.

1. Con ADMIN o SUPERVISOR asigna una incidencia de prueba a un operador. Consulta la bandeja como ciudadano reportante y como operador. Cada cuenta recibe su aviso de asignación.
2. Con el token del ciudadano, guarda el ID de un aviso no leído como `notificationId` y consulta `unread-count`.
3. Envía `PATCH /notifications/{{notificationId}}/read` dos veces. Ambas devuelven la misma fecha de lectura. El aviso sigue en la bandeja general y desaparece de `unreadOnly=true`. El contador baja una sola vez si no llegan otros avisos.
4. Usa el token del operador o del ADMIN para marcar el aviso del ciudadano. Espera **404** y comprueba que el aviso solo aparece en la bandeja del ciudadano.
5. Envía `POST /notifications/read-all` como ciudadano. El contador propio queda en cero y el del operador conserva sus avisos. Repite y espera `updated: 0` si no hubo eventos nuevos.
6. Repite una asignación con la versión anterior de la incidencia. Espera **409** de la operación de negocio y comprueba que las bandejas no ganaron avisos duplicados.

`readAt` determina si un aviso está leído, incluidos los históricos que quedaron en PENDING. Los avisos nuevos se guardan como SENT al aparecer en bandeja. Al leerlos pasan a READ. `sentAt` representa la entrega interna de esta etapa.

## Consulta de auditoría

Con token ADMIN envía `GET {{UrlBase}}/admin/audit-logs`. Puedes combinar estos parámetros exactos en la pestaña **Params**.

| Parámetro | Ejemplo |
| --- | --- |
| `actorId` | UUID del usuario que realizó la acción. |
| `action` | `INCIDENT_ASSIGNED` o `USER_ROLE_CHANGED`. |
| `entityType` | `Incident`, `User` o `AiRoute`. |
| `entityId` | `{{incidentId}}` u otro identificador de entidad. |
| `from` | `2026-11-05T00:00:00-05:00`. |
| `to` | `2026-11-05T23:59:59.999-05:00`. |
| `page`, `limit` | `1`, `20`. |

Las fechas incluyen zona horaria y ambos extremos cuentan en el filtro. La lista devuelve metadatos y paginación. `userId` identifica al actor y puede ser `null` en eventos automáticos. Guarda un ID del listado como `auditLogId` y consulta `GET {{UrlBase}}/admin/audit-logs/{{auditLogId}}`. El detalle devuelve `oldValue` y `newValue` con campos operativos permitidos, como estado, versión, rol e identificadores. La proyección omite comentarios libres, IP, agente de usuario, contraseñas, tokens y claves.

1. Filtra por `entityType=Incident`, `entityId={{incidentId}}` y `action=INCIDENT_ASSIGNED`. Abre el detalle y verifica el cambio de ACCEPTED a ASSIGNED.
2. Añade el UUID del actor de la asignación. Prueba con otro actor y espera un listado vacío.
3. Consulta ambas rutas con un token SUPERVISOR o CITIZEN. Espera **403**. Sin sesión válida, ambas familias de rutas devuelven **401**.
4. Prueba un UUID inválido en la ruta, `limit=101`, `unreadOnly=si` o un rango de fechas invertido. Espera **400**. Un UUID válido sin registro devuelve **404** en el detalle.

La prueba automatizada usa un esquema PostgreSQL temporal y verifica la migración con un aviso histórico, el aislamiento entre cuentas, las lecturas concurrentes, la deduplicación y la proyección de auditoría. Desde una compilación actual puedes ejecutarla con:

```bash
pnpm run build
RUN_NOTIFICATION_AUDIT_INTEGRATION_TESTS=1 node --test test/notification-audit.integration.test.cjs
```
