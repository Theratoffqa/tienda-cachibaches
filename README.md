# 🍪 Tienda de Cachibaches S.A.C.

Vitrina y gerencia de las chucherías que vendo en el trabajo. Es un proyecto personal medio en broma, pero con las cuentas claras.

- **Vitrina pública** (`index.html`): qué hay, a cuánto y cuánto queda. Se publica con GitHub Pages.
- **Gerencia** (`admin.html`): pedidos, compras de reposición, costos, ganancia y fotos. Solo funciona con mi token.

## Cómo está armado

Son dos repos y no hay servidor:

| Repo | Visibilidad | Contenido |
|---|---|---|
| `tienda-cachibaches` | Público | Código, `catalogo.json` (nombre, precio, stock, emoji, foto) e `img/` |
| `tienda-cachibaches-datos` | **Privado** | `pedidos.json`, `compras.json`, `costos.json` |

`admin.html` usa la API de GitHub para leer y escribir esos JSON. Cada cambio es un commit, así que el historial de Git es también el libro contable.

En local, el repo privado vive en `datos/` (está en `.gitignore`).

## Primer uso del admin

1. Crea un token *fine-grained* en <https://github.com/settings/personal-access-tokens/new>:
   - **Repository access:** Only select repositories → `tienda-cachibaches` y `tienda-cachibaches-datos`.
   - **Permissions → Contents:** Read and write.
   - Expiración: la que quieras; cuando venza, creas otro.
2. Abre `https://<usuario>.github.io/tienda-cachibaches/admin.html` → **Ajustes**, pega el token y dale a **Conectar**.

El token se guarda solo en ese navegador. Usa **Cerrar sesión** para borrarlo.

## Flujo del día a día

- **Llegó mercadería** → *Compras*: unidades y costo total. El stock sube y se actualiza el costo por unidad.
- **Alguien pide** → *Pedidos*: cliente y productos. El stock baja. Luego marcas *Entregado* / *Pagado*.
- **Producto nuevo o foto** → *Productos*. Las fotos se reducen a 600 px en WebP y se guardan en `img/`. Si un producto no tiene foto, se muestra su emoji.
- **Resumen**: ganancia (solo de pedidos pagados), por cobrar, invertido y si ya recuperaste la inversión.

La vitrina tarda alrededor de 1 minuto en reflejar los cambios (lo que demora GitHub Pages en publicar).

## Probar en local

```bash
npx serve .
```

La vitrina lee `catalogo.json` local. El admin siempre lee y escribe en GitHub.
