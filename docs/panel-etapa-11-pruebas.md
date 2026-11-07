# Etapa 11 · Aceptación del panel operativo

El panel conserva los layouts por rol, los guards, el cliente Axios con cookies y las páginas con carga diferida. Las funcionalidades nuevas siguen la separación entre entidades, contratos, servicios, hooks de TanStack Query y presentación.

## Preparación

- Aplica las migraciones pendientes de las etapas anteriores. El resumen y el listado de trabajos de esta etapa usan el esquema existente.
- En el panel conserva `VITE_API_URL=http://localhost:8000/api` o el puerto y prefijo reales. Agrega el origen exacto del panel a `CORS_ORIGINS` de la API. Usa el mismo hostname para ambas aplicaciones.
- Mantén PostgreSQL, Redis y RustFS disponibles. La clasificación, el chat y el correo usan las credenciales ya configuradas en la API.
- Prepara cuentas ADMIN, SUPERVISOR, OPERATOR, OPERATOR con membresía MANAGER y otro OPERATOR en un área distinta. Usa CITIZEN en Postman para crear el reporte y adjuntar su evidencia.
- Usa perfiles separados del navegador o ventanas privadas al comparar cuentas. Así cada prueba conserva sus propias cookies.
- Arranca la API y el panel con sus comandos habituales.

### Mapa

Desde Incidencias selecciona **Ver mapa**. Los marcadores corresponden a los resultados de la página y respetan los mismos filtros y permisos de la bandeja. Al abrir el marcador, puedes entrar al detalle. El detalle también permite consultar una ubicación individual.

El mapa se carga al abrirlo. Usa las teselas estándar de OpenStreetMap por defecto y muestra su atribución. Para otro proveedor, define `VITE_MAP_TILE_URL` y `VITE_MAP_ATTRIBUTION` en el panel. Configura un proveedor acorde al uso de producción. [Política de teselas de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)

## Verificar el alcance de las métricas

1. Crea incidencias en dos áreas distintas y asigna una al operador de cada área. Mantén otra incidencia sin asignar.
2. En **Resumen operativo**, ADMIN y SUPERVISOR ven los casos de toda la operación. OPERATOR ve únicamente el alcance autorizado de sus asignaciones y de las áreas que administra como MANAGER. **Actualizar métricas** vuelve a consultar la API.
3. Compara la tabla de estados, urgencias y el total. Repite en Postman con `GET {{UrlBase}}/dashboard/summary` y el Bearer de cada cuenta. Un token CITIZEN debe recibir **403** y una petición sin sesión debe recibir **401**.
4. Comprueba el tiempo medio. Se mide desde el registro hasta la resolución, en minutos redondeados, para casos del mismo alcance resueltos dentro de los últimos 30 días corridos. Con cero resoluciones se muestra un guion. Las fechas visibles en el panel se muestran en hora de Lima.
5. Como operador, abre la URL de detalle de una incidencia del otro operador. La API debe devolver **404**. Comprueba que tampoco aparezca en el mapa ni en el resumen. Cambia a un operador MANAGER y comprueba el alcance adicional de su propia área.

## Flujo operativo

| Paso | Cuenta | Prueba |
| --- | --- | --- |
| Preparar responsables | ADMIN | En Usuarios revisa los roles y estados. En Áreas municipales crea y edita un área, agrega una membresía por UUID de usuario y comprueba su estado. |
| Reportar | CITIZEN, desde Postman | Crea una incidencia con coordenadas, adjunta evidencia y envíala a clasificación. Consulta la guía de la etapa correspondiente para los cuerpos. |
| Revisar | ADMIN o SUPERVISOR | Filtra Incidencias por código o activa **Solo requiere supervisión**. Abre el detalle, descarga la evidencia, revisa la clasificación y acepta. Usa otro caso para probar rechazo con motivo. |
| Asignar | ADMIN o SUPERVISOR | Selecciona área y un responsable activo. Comprueba la asignación y la notificación. Usa otro caso para probar reasignación o cancelación de la asignación. |
| Atender | OPERATOR responsable | Abre Mis asignaciones, acepta la asignación e inicia la atención. Adjunta una imagen de atención y resuelve con resumen. |
| Cerrar | ADMIN o SUPERVISOR | Cierra la incidencia resuelta. Confirma la secuencia en Historial, la notificación, la bitácora y el resumen. |
| Administrar membresía | MANAGER | Gestiona miembros de su área y verifica que la opción de gestión esté fuera del alcance de otra área. Usa un operador ordinario para comprobar la ausencia de estas acciones. |

Abre la misma acción en dos sesiones autorizadas y guarda primero en una. La segunda debe recibir **409** por versión desactualizada. Verifica el aviso y vuelve a abrir la acción sobre los datos nuevos. Repite el flujo con revisión manual y con un fallo de proveedor ya preparado en el entorno de pruebas.

## Pantallas administrativas y de cuenta

- **Configuración IA.** Selecciona una capacidad, crea una versión de prompt, revisa su esquema, valida una salida de ejemplo y activa el prompt. Crea o edita una ruta, ajusta la prioridad y ejecuta la comprobación. Usa modelos de prueba para evitar cambiar la configuración operativa.
- **Trabajos y outbox.** ADMIN y SUPERVISOR pueden consultar trabajos de clasificación e intentos de proveedor. Con ADMIN filtra despachos fallidos y reintenta un registro DEAD cuando Redis se haya recuperado. En Postman, `GET /admin/ai/jobs?page=1&limit=20` debe rechazar a OPERATOR con **403**.
- **Conocimiento y chatbot.** Carga un Markdown, procesa, revisa el trabajo y publica. Abre Chatbot como ADMIN y verifica una respuesta con citas. Archiva un documento de prueba y comprueba que quede fuera de nuevas búsquedas.
- **Auditoría.** Filtra por acción, entidad, actor o rango de fechas y abre los cambios registrados. Verifica que SUPERVISOR y OPERATOR no tengan acceso al módulo.
- **Notificaciones.** Marca una y luego todas como leídas. Comprueba el contador del menú y el aislamiento al cambiar de cuenta.
- **Mi perfil.** Edita datos, registra el correo, solicita verificación y abre el enlace. Prueba recuperación desde el login y cierre de sesiones. Las rutas de correo del panel son `/verificar-correo` y `/restablecer-contrasena`.

Registra cualquier fallo con el rol, ruta, acción, estado HTTP y un código de incidencia de prueba. El cierre de esta etapa requiere comprobar el recorrido en navegador con la API real.
