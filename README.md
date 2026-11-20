# Intercambio de Navidad · Team Tora No Maki

Aplicación web del intercambio de regalos del equipo: registro público, sorteo
sin que nadie se regale a sí mismo y consulta individual de a quién le toca
regalar.

- **Frontend:** HTML, CSS y JavaScript sin frameworks → GitHub Pages (gratis).
- **Backend:** Supabase (PostgreSQL + Auth + RLS).
- **Idioma:** español.
- **Diseño:** responsive, pensado para móvil Android y escritorio.

---

## Estructura

```
index.html               Página pública: registro y consulta
admin.html               Panel de administración
assets/
  config.js              URL y clave pública de Supabase (editar)
  supabase.js            Cliente de Supabase y llamadas RPC
  app.js                 Lógica pública
  admin.js               Lógica del panel
  utils.js               Utilidades compartidas
  styles.css             Estilos
  fonts.css, fonts/      Tipografías autoalojadas
  vendor/supabase.js     supabase-js 2.x (UMD, sin CDN)
supabase/schema.sql      Tablas, RLS y funciones RPC
tests/sql/               Pruebas de la base de datos
```

Las páginas usan módulos ES (`type="module"`), por lo que **no se pueden abrir
con doble clic** desde el disco: hay que servirlas por HTTP (ver abajo).

---

## 1. Configurar Supabase

1. Crea un proyecto gratuito en <https://supabase.com>.
2. Abre **SQL Editor**, pega el contenido completo de `supabase/schema.sql` y
   ejecútalo. Es idempotente: puedes volver a ejecutarlo sin duplicar datos.
3. En **Authentication → Users**, crea el usuario administrador con correo y
   contraseña (no hay registro público de administradores).
4. En el **SQL Editor**, autoriza ese usuario como administrador:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'TU-CORREO@EJEMPLO.COM'
   on conflict do nothing;
   ```

5. En **Authentication → Sign In / Providers**, desactiva **Allow new users to
   sign up**. Solo la cuenta creada a mano debe poder entrar al panel.
6. En **Project Settings → API**, copia el **Project URL** y la clave
   **anon public** (o **publishable**).

> La clave `anon` es pública y puede estar en el navegador; los permisos reales
> los imponen las políticas RLS y las funciones `security definer`.
> **Nunca** pongas la clave `service_role` en el frontend.

7. Edita `assets/config.js`:

   ```js
   export const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
   export const SUPABASE_KEY = 'tu-clave-anon-publica';
   ```

---

## 2. Probar en local

Cualquier servidor estático sirve:

```bash
python3 -m http.server 8080
# o: npx serve .
```

Abre <http://localhost:8080/>.

### Pruebas de base de datos

Requieren un PostgreSQL local. Los archivos de `tests/sql/` crean roles y un
esquema `auth` mínimos para poder ejecutar `schema.sql` fuera de Supabase:

```bash
export PGBIN="$HOME/.local/share/mise/installs/postgres/18.6/bin"
"$PGBIN/psql" -h 127.0.0.1 -p 55432 -U postgres -d exchange \
  -v ON_ERROR_STOP=1 -f tests/sql/00_bootstrap_local.sql \
  -f supabase/schema.sql -f tests/sql/test_schema.sql
```

La última línea debe imprimir `== TODAS LAS PRUEBAS PASARON ==`.

---

## 3. Publicar en GitHub Pages

1. Crea un repositorio **público** en GitHub (Pages gratis exige repositorio
   público en cuentas gratuitas).
2. Sube el proyecto:

   ```bash
   git init
   git add .
   git commit -m "Intercambio de Navidad 2026"
   git branch -M main
   git remote add origin https://github.com/USUARIO/REPO.git
   git push -u origin main
   ```

3. En el repositorio: **Settings → Pages → Build and deployment**,
   *Source*: **Deploy from a branch**, *Branch*: `main` / `/ (root)`.
4. La página queda en `https://USUARIO.github.io/REPO/`.

`admin.html` está enlazado desde el pie de la página pública y también se puede
abrir directamente en `https://USUARIO.github.io/REPO/admin.html`.

---

## 4. Uso

### Participantes

1. Entran a la página principal y llenan **nombre**, **apellido** y **talla de
   calzado**. Verán el mensaje *"Registro exitoso"*.
2. Cuando el organizador haya hecho el sorteo, consultan con los mismos tres
   datos y ven:

   > **Te toca regalarle a:** Nombre Apellido — talla de calzado

No hay códigos ni contraseñas: la verificación es nombre + apellido + talla.
Es cómodo, pero alguien que conozca esos datos de otra persona podría consultar
su asignación. Si se necesita más privacidad, habría que añadir un código
personal (cambio pequeño en el esquema y en el formulario).

### Administrador

En `admin.html`, inicia sesión con el usuario de Supabase Auth.

- **Participantes:** conteo total, pendientes y asignados.
- **Sorteo completo:** reparte a todos los registrados sin asignación. Usa un
  desordenamiento aleatorio (derangement): nadie se regala a sí mismo y nadie
  recibe dos regalos. Si falla el azar, aplica una rotación determinista.
- **Integrar nuevos:** para quienes se registraron después del primer sorteo.
  Corta **una sola** asignación existente `A → R` y la convierte en
  `A → nuevo1 → … → nuevoN → R`; el resto queda intacto.
- **Abrir / cerrar registro:** bloquea nuevas inscripciones.
- **Eliminar pendiente:** solo borra participantes que todavía no tienen
  asignación.
- **Exportar CSV:** descarga la lista de participantes y asignaciones.

---

## 5. Esquema y seguridad

Tablas:

- `participants` — nombre, apellido, talla normalizada, estado.
- `assignments` — `giver_id → receiver_id`, única por dador y por receptor,
  con `check (giver_id <> receiver_id)`.
- `settings` — ronda de sorteo, registro abierto/cerrado.
- `admins` — usuarios de Supabase Auth con permiso de administración.

Todo el acceso pasa por funciones RPC; las tablas tienen RLS activo y no
conceden permisos directos a `anon` ni a `authenticated`. Las funciones
públicas solo exponen lo mínimo (estado del evento, alta y consulta propia) y
las de administración validan `auth.uid()` contra `public.admins`.

El sorteo completo y la integración de nuevos se ejecutan en una sola
transacción: o se aplican todos los cambios, o ninguno.

---

## Créditos

- Tipografías: Bebas Neue y Manrope (SIL Open Font License, ver
  `assets/fonts/`).
- [supabase-js](https://github.com/supabase/supabase-js) (MIT, ver
  `assets/vendor/supabase-LICENSE.txt`).
