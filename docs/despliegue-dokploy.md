# Desplegar la API de Willariq en Dokploy

## 1. Red interna

Crea esta red una vez en el VPS. Si ya existe, reutilízala.

```sh
docker network create willariq-backend
```

Los Compose de infraestructura asignan estos alias en la red. Usa los puertos internos de los contenedores.

| Servicio | Dirección para la API dentro de Docker |
| --- | --- |
| PostgreSQL con pgvector | `willariq-postgres:5432` |
| Redis | `willariq-redis:6379` |
| RustFS con S3 | `http://willariq-rustfs:9000` |

Si la infraestructura ya está desplegada, puedes conectar los contenedores actuales con estos comandos. Sustituye cada nombre de ejemplo por el que muestra Docker.

```sh
docker ps --format "{{.Names}}"
docker network connect --alias willariq-postgres willariq-backend CONTENEDOR_POSTGRES
docker network connect --alias willariq-redis willariq-backend CONTENEDOR_REDIS
docker network connect --alias willariq-rustfs willariq-backend CONTENEDOR_RUSTFS
```

Para mantener los alias al recrearlos, usa los Compose actualizados de infraestructura o agrega la red externa y los alias a sus Compose de Dokploy. Si cambias `WILLARIQ_BACKEND_NETWORK`, usa ese mismo nombre para los cuatro servicios.

`localhost` dentro de la API se refiere al propio contenedor. Para llegar a los contenedores vecinos usa los alias Docker. Los puertos publicados de PostgreSQL, Redis y RustFS en las plantillas de infraestructura quedan asociados a `127.0.0.1` del host.

## 2. Variables y buckets

1. En el servicio **Docker Compose** de Dokploy, selecciona este repositorio y el archivo `compose.yml`. El servicio principal se llama `app-server`.
2. Usa [.env.docker.example](../.env.docker.example) como plantilla para **Environment** y reemplaza los valores de ejemplo con tus credenciales y dominios. Dokploy guarda ese contenido como `.env` y Compose lo inyecta en los contenedores mediante `env_file`. [Entorno de Docker Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose)
3. En `DATABASE_URL`, conserva las credenciales y la base de tu PostgreSQL y usa su alias de red. Escapa los caracteres reservados de la contraseña en la URL. Configura `REDIS_PASSWORD` con el valor de Redis.
4. En RustFS, comprueba que los buckets privados de evidencias y conocimiento existan y que la cuenta de la API pueda leer, escribir y borrar objetos en ellos. La API también verifica el acceso al bucket de evidencias al arrancar. Configura `RUSTFS_KNOWLEDGE_BUCKET` y `OPENROUTER_API_KEY` para conocimiento. Para clasificación activa `AI_ENABLED=true` y `AI_WORKER_ENABLED=true`.
5. En `CORS_ORIGINS` pon el origen HTTPS del panel sin ruta ni barra al final. Si el panel y la API están bajo el mismo sitio, conserva `AUTH_COOKIE_SAME_SITE=lax`. Revisa la configuración de cookies si los despliegas en sitios diferentes.

El `.env` de API que usas fuera de Docker puede conservar `127.0.0.1` y su puerto actual. Usa [.env.example](../.env.example) como referencia. El archivo real de entorno se mantiene fuera del repositorio y de la imagen Docker. En Dokploy basta el `.env` que administra **Environment** para la API. PostgreSQL, Redis y RustFS conservan su propia configuración de servicio.

### Nombres de RustFS

Las variables de almacenamiento usan `RUSTFS_ENABLED`, `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, `RUSTFS_REGION`, `RUSTFS_EVIDENCE_BUCKET` y `RUSTFS_KNOWLEDGE_BUCKET`. `RUSTFS_ENDPOINT` incluye protocolo y puerto, por ejemplo `http://willariq-rustfs:9000`. Sustituye las variables anteriores de MinIO en Dokploy antes del primer despliegue con esta versión.

Las evidencias y los documentos se siguen enviando y consultando mediante la API de Willariq. El endpoint S3 y sus credenciales quedan del lado del servidor.

## 3. Migración y despliegue

Desde el directorio del Compose de la API que contiene el `.env` de ese VPS, aplica las migraciones antes de arrancar o actualizar el servicio cuando haya cambios de esquema.

```sh
docker compose --profile tools run --rm --build migrate
```

Esto ejecuta `prisma migrate deploy` con `prisma7.config.ts`. En Dokploy puedes ejecutar el comando por SSH desde el directorio de trabajo del servicio, usando el mismo proyecto y archivo Compose que muestra Dokploy. Para desarrollo con Compose local, usa el mismo comando con el entorno local del contenedor.

En **Domains** de Dokploy, apunta tu dominio de API al servicio **app-server**, puerto del contenedor **7100**, ruta **/** y activa HTTPS. Mantener el dominio en la raíz permite que llegue tanto `/api` como `/socket.io`. Guarda y despliega. [Dominios de Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose/domains)

El Compose publica el puerto **7100** en `127.0.0.1` del VPS. Para el panel y la APK usa la URL HTTPS de Dokploy, por ejemplo `https://api.example.com/api`. Ajusta `VITE_API_URL` en web y `EXPO_PUBLIC_BASE_URL` en móvil. Si necesitas enlazar el puerto 7100 en otra interfaz del VPS, puedes definir `API_BIND_ADDRESS` con esa dirección.

## 4. Verificación

```sh
curl -fsS http://127.0.0.1:7100/api/health
curl -fsS https://api.example.com/api/health
docker compose logs --tail 100 app-server
```

Usa el prefijo que hayas configurado si difiere de `api`. Comprueba una subida y lectura de evidencia, una consulta del chatbot con un documento publicado y la conexión de Socket.IO del operador.
