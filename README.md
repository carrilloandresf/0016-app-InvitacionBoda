# Invitación de boda · Felipe & Sarita

Aplicación dockerizada para crear enlaces de invitación personalizados, recibir confirmaciones RSVP y consultar los resultados desde una pantalla administrativa.

## Arquitectura

La aplicación usa una sola pieza desplegable, suficiente para el tamaño y la vida útil de una boda:

- Un servidor Node.js sirve la invitación, el panel y una API pequeña.
- SQLite guarda familias, invitados, respuestas, menús y solicitudes de hospedaje.
- Un volumen de Docker conserva la base de datos aunque se reconstruya el contenedor.
- `/admin` está protegido con usuario y contraseña.

No hay servicios separados ni una base de datos externa que administrar.

## Iniciar con Docker

Requisitos: Docker y Docker Compose.

1. Crea la configuración local:

   ```sh
   cp .env.example .env
   ```

2. Edita `.env` y reemplaza `ADMIN_PASSWORD` por una clave larga y única. La aplicación rechaza la clave de ejemplo.

3. Construye e inicia:

   ```sh
   docker compose up --build -d
   ```

4. Abre:

   - Invitación: `http://localhost:3016`
   - Administración: `http://localhost:3016/admin`

El navegador pedirá el usuario y la contraseña definidos en `.env` al entrar al panel.

## Flujo de uso

Desde `/admin`:

1. Pulsa **Nueva invitación**.
2. Escribe el nombre de la familia y agrega sus integrantes.
3. Guarda y copia el enlace personalizado.
4. Envía ese enlace solamente a esa familia.

Cada invitado puede confirmar asistencia, plato, bebida y torta. También puede modificar su respuesta posteriormente desde el mismo enlace.

Al crear o editar una invitación, cada persona se clasifica como:

- **Adulto:** elige menú de adultos y cuenta en el inventario con licor.
- **Joven:** elige menú de adultos y cuenta en el inventario sin licor.
- **Niño:** recibe automáticamente menú infantil y cuenta en el inventario sin licor.

El panel muestra estos totales, conserva la categoría de cada persona y la incluye al exportar el CSV. Los invitados creados antes de esta funcionalidad se migran automáticamente como adultos y pueden reclasificarse desde **Editar**.

## Configuración

| Variable | Uso | Valor por defecto |
| --- | --- | --- |
| `APP_PORT` | Puerto publicado por Docker | `3016` |
| `ADMIN_USER` | Usuario del panel | `admin` |
| `ADMIN_PASSWORD` | Clave del panel, mínimo 12 caracteres | Obligatoria |
| `PUBLIC_URL` | URL pública usada en las previsualizaciones al compartir | `https://fys.nuestraboda.111labs.net` |

La información se guarda en el volumen `wedding-data`, montado en `/app/data` dentro del contenedor.

## Operación

Ver registros:

```sh
docker compose logs -f invitaciones
```

Actualizar después de cambiar el código:

```sh
docker compose up --build -d
```

Detener sin borrar las respuestas:

```sh
docker compose down
```

No uses `docker compose down -v` salvo que realmente quieras eliminar la base de datos.

Para respaldar la base, detén momentáneamente el servicio y copia el archivo:

```sh
docker compose stop invitaciones
docker compose cp invitaciones:/app/data/wedding.sqlite ./wedding-backup.sqlite
docker compose start invitaciones
```

## Desarrollo local

Requiere Node.js 22.13 o posterior:

```sh
npm ci
ADMIN_PASSWORD='una-clave-local-segura' npm start
```

La aplicación queda en `http://localhost:3016` y crea `data/wedding.sqlite`.

## Publicación

Para ponerla en Internet, ubica el contenedor detrás de un proxy inverso con un dominio y HTTPS (por ejemplo Caddy, Traefik o Nginx). HTTPS es especialmente importante porque protege tanto los enlaces familiares como las credenciales del panel durante el transporte.
