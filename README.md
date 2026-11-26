# Inventario Caracas

App de inventario del almacén de Caracas. Es una sola página (`index.html`).

Funciona en dos lugares con el mismo código:

- **Dentro de Claude** (artifact): los datos viven en la base del artifact.
- **En Vercel + Supabase** (esta rama): `adapter.js` reemplaza lo que daba Claude.

## Archivos

- `index.html`: la app.
- `adapter.js`: entrada con correo y clave, datos en Supabase, lectura de las hojas de Google.
- `api/config.js`: entrega a la página la dirección y la llave pública de Supabase.
- `api/gtoken.js`: entrega un permiso de solo lectura para las hojas de Google, solo a quien entró con su clave.
- `supabase.sql`: crea la base de datos y sus reglas. Se pega una vez en Supabase > SQL Editor.

## Qué NO está en este repositorio

- Los enlaces de las hojas de Google: en el código son marcadores (`ID_SHEET_...`); los reales viven en la base, en el documento `privado/hojas`.
- Los datos del inventario (catálogo, conteos, costos).
- Llaves: van en las variables de entorno de Vercel.

## Variables de entorno en Vercel

| Nombre | Qué es |
| --- | --- |
| `SUPABASE_URL` | Dirección del proyecto de Supabase |
| `SUPABASE_ANON_KEY` | Llave pública de Supabase (anon o publishable) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Contenido completo del archivo de llave de la cuenta de servicio de Google |

## Instalación

1. Supabase: crear un proyecto, pegar `supabase.sql` en SQL Editor y correrlo. En Authentication > Users crear el usuario de la dueña.
2. Google Cloud: activar "Google Sheets API", crear una cuenta de servicio y una llave JSON. Compartir cada hoja con el correo de esa cuenta como lector.
3. Vercel: importar este repositorio (sin framework) y poner las tres variables.
4. Abrir la página, entrar con el usuario y elegir el archivo de datos cuando lo pida. La primera persona que entra queda como dueña.

Para dar acceso a otra persona: crearla en Authentication > Users y correr la última línea de `supabase.sql` con su correo.
