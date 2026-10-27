'use strict';

/* ============================================================
   Configuración y almacenamiento del token
   ============================================================ */

const CFG_KEY = 'cachibaches.config';
const DEFAULTS = {
  owner: 'Theratoffqa',
  repoPublico: 'tienda-cachibaches',
  repoPrivado: 'tienda-cachibaches-datos',
  token: '',
};

// Qué archivo vive en qué repo.
const ARCHIVOS = {
  catalogo: { repo: 'repoPublico', path: 'catalogo.json' },
  pedidos: { repo: 'repoPrivado', path: 'pedidos.json' },
  compras: { repo: 'repoPrivado', path: 'compras.json' },
  costos: { repo: 'repoPrivado', path: 'costos.json' },
};

function almacenes() {
  const lista = [];
  try { lista.push(localStorage); } catch {}
  try { lista.push(sessionStorage); } catch {}
  return lista;
}

function cargarConfig() {
  for (const store of almacenes()) {
    try {
      const raw = store.getItem(CFG_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw), recordar: store === almacenes()[0] };
    } catch {}
  }
  return { ...DEFAULTS, recordar: true };
}

function guardarConfig(nueva) {
  const [local, sesion] = almacenes();
  const { recordar, ...datosCfg } = nueva;
  try { local?.removeItem(CFG_KEY); sesion?.removeItem(CFG_KEY); } catch {}
  try { (recordar ? local : sesion)?.setItem(CFG_KEY, JSON.stringify(datosCfg)); } catch {}
  cfg = nueva;
}

let cfg = cargarConfig();
const datos = {}; // nombre -> { data, sha }
let pestana = 'resumen';
let filtroPedidos = 'abiertos';

/* ============================================================
   Utilidades
   ============================================================ */

const $ = sel => document.querySelector(sel);
const soles = n => 'S/ ' + Number(n || 0).toFixed(2);
const fechaCorta = iso => new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Constructor de nodos DOM: nunca usa innerHTML con datos.
function h(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'for') e.htmlFor = v;
    else if (k === 'list' || k.startsWith('data-') || k.startsWith('aria-')) e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of hijos.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : String(c));
  }
  return e;
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), error ? 6000 : 2500);
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function fotoMini(p) {
  const caja = h('div', { class: 'mini-foto' });
  if (p.imagen) {
    const img = h('img', { src: p.imagen, alt: '' });
    img.onerror = () => { caja.textContent = p.emoji || '📦'; };
    caja.append(img);
  } else {
    caja.textContent = p.emoji || '📦';
  }
  return caja;
}

/* ============================================================
   GitHub API
   ============================================================ */

async function gh(ruta, opciones = {}) {
  const res = await fetch('https://api.github.com' + ruta, {
    ...opciones,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detalle = '';
    try { detalle = (await res.json()).message; } catch {}
    const err = new Error(`GitHub ${res.status}${detalle ? ': ' + detalle : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const rutaContenido = (repoKey, path) => `/repos/${cfg.owner}/${cfg[repoKey]}/contents/${path}`;

async function leer(nombre) {
  const a = ARCHIVOS[nombre];
  const d = await gh(rutaContenido(a.repo, a.path));
  return { data: JSON.parse(fromB64(d.content)), sha: d.sha };
}

async function guardar(nombre, mensaje) {
  const a = ARCHIVOS[nombre];
  if (nombre === 'catalogo') datos.catalogo.data.actualizado = new Date().toISOString();
  const r = await gh(rutaContenido(a.repo, a.path), {
    method: 'PUT',
    body: JSON.stringify({
      message: mensaje,
      content: toB64(JSON.stringify(datos[nombre].data, null, 2) + '\n'),
      sha: datos[nombre].sha,
    }),
  });
  datos[nombre].sha = r.content.sha;
}

async function shaSiExiste(repoKey, path) {
  try { return (await gh(rutaContenido(repoKey, path))).sha; }
  catch (e) { if (e.status === 404) return undefined; throw e; }
}

async function cargarTodo() {
  const pares = await Promise.all(Object.keys(ARCHIVOS).map(async k => [k, await leer(k)]));
  for (const [k, v] of pares) datos[k] = v;
}

/**
 * Ejecuta un cambio y lo guarda en GitHub.
 * `cambio()` modifica `datos` y devuelve la lista de archivos tocados.
 * Si algo falla (p. ej. editaste desde otro dispositivo), recarga todo.
 */
async function operar(mensaje, cambio, exito = 'Guardado ✔') {
  document.body.classList.add('ocupado');
  try {
    const tocados = cambio();
    for (const nombre of tocados) await guardar(nombre, mensaje);
    toast(exito);
  } catch (e) {
    console.error(e);
    const conflicto = e.status === 409 || e.status === 422;
    toast(conflicto
      ? 'Los datos cambiaron en otro lado. Recargué todo, inténtalo de nuevo.'
      : `No se pudo guardar (${e.message}). Recargué los datos.`, true);
    try { await cargarTodo(); } catch {}
  } finally {
    document.body.classList.remove('ocupado');
    render();
  }
}

/* ============================================================
   Acceso a datos
   ============================================================ */

const productos = () => datos.catalogo.data.productos;
const producto = id => productos().find(p => p.id === id);
const costoDe = id => (typeof datos.costos.data[id] === 'number' ? datos.costos.data[id] : null);
const totalPedido = p => p.items.reduce((s, i) => s + i.cantidad * i.precio, 0);

function opcionesProductos(seleccionado, conStock = false) {
  return productos()
    .filter(p => p.activo !== false || p.id === seleccionado)
    .map(p => h('option', { value: p.id, selected: p.id === seleccionado },
      `${p.emoji || ''} ${p.nombre}${conStock ? ` (${p.stock})` : ''}`));
}

/* ============================================================
   Pestaña: Resumen
   ============================================================ */

function kpi(etiqueta, valor, destacado = false) {
  return h('div', { class: 'kpi' + (destacado ? ' destacado' : '') },
    h('div', { class: 'valor' }, valor),
    h('div', { class: 'etiqueta' }, etiqueta));
}

function renderResumen() {
  const pedidos = datos.pedidos.data;
  const compras = datos.compras.data;

  let cobrado = 0, porCobrar = 0, ganancia = 0, unidadesSinCosto = 0;
  const vendidos = {};
  for (const p of pedidos) {
    const t = totalPedido(p);
    if (p.pagado) cobrado += t; else porCobrar += t;
    for (const i of p.items) {
      vendidos[i.productoId] = (vendidos[i.productoId] || 0) + i.cantidad;
      if (!p.pagado) continue;
      if (i.costo == null) unidadesSinCosto += i.cantidad;
      else ganancia += i.cantidad * (i.precio - i.costo);
    }
  }
  const invertido = compras.reduce((s, c) => s + c.costoTotal, 0);
  const porEntregar = pedidos.filter(p => !p.entregado).length;
  const balance = cobrado - invertido;

  const filas = productos().map(p => {
    const c = costoDe(p.id);
    return h('tr', {},
      h('td', {}, `${p.emoji || ''} ${p.nombre}`),
      h('td', { class: 'num' }, p.stock),
      h('td', { class: 'num' }, vendidos[p.id] || 0),
      h('td', { class: 'num' }, c == null ? '—' : soles(c)),
      h('td', { class: 'num' }, soles(p.precio)),
      h('td', { class: 'num' }, c == null ? '—' : soles(p.precio - c)));
  });

  return [
    h('div', { class: 'kpis' },
      kpi('Ganancia (pedidos pagados)', soles(ganancia), true),
      kpi('Cobrado', soles(cobrado)),
      kpi('Por cobrar', soles(porCobrar)),
      kpi('Invertido en compras', soles(invertido)),
      kpi(balance >= 0 ? '¿Ya recuperé la inversión? Sí 🎉' : '¿Ya recuperé la inversión? Aún no', soles(balance)),
      kpi('Pedidos sin entregar', porEntregar)),
    unidadesSinCosto
      ? h('p', { class: 'aviso' }, `${unidadesSinCosto} unidad(es) vendidas no tienen costo registrado, así que no cuentan en la ganancia. Ponles costo en Productos o registra una compra.`)
      : null,
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Por producto'),
      h('div', { class: 'tabla-scroll' },
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, 'Producto'), h('th', { class: 'num' }, 'Stock'), h('th', { class: 'num' }, 'Vendidos'),
            h('th', { class: 'num' }, 'Costo u.'), h('th', { class: 'num' }, 'Precio'), h('th', { class: 'num' }, 'Margen u.'))),
          h('tbody', {}, filas)))),
  ];
}

/* ============================================================
   Pestaña: Pedidos
   ============================================================ */

function filaLinea(lineas) {
  const fila = h('div', { class: 'linea' },
    h('select', { 'aria-label': 'Producto', class: 'sel-producto' }, opcionesProductos(null, true)),
    h('input', { type: 'number', min: 1, step: 1, value: 1, 'aria-label': 'Cantidad', class: 'cant' }),
    h('button', {
      type: 'button', class: 'btn sec chico', title: 'Quitar',
      onclick: () => { if (lineas.children.length > 1) fila.remove(); },
    }, '✕'));
  return fila;
}

function formPedido() {
  const clientes = [...new Set(datos.pedidos.data.map(p => p.cliente))].sort((a, b) => a.localeCompare(b, 'es'));
  const lineas = h('div', { class: 'lista' });
  lineas.append(filaLinea(lineas));
  const totalEl = h('span', { class: 'total' }, soles(0));

  const recalcular = () => {
    let t = 0;
    for (const f of lineas.children) {
      const p = producto(f.querySelector('.sel-producto').value);
      t += (p?.precio || 0) * (parseInt(f.querySelector('.cant').value, 10) || 0);
    }
    totalEl.textContent = soles(t);
  };

  const form = h('form', {
    oninput: recalcular,
    onsubmit: e => {
      e.preventDefault();
      const cliente = form.cliente.value.trim();
      if (!cliente) return toast('¿A quién le vendiste?', true);

      // Junta líneas repetidas del mismo producto.
      const cantidades = {};
      for (const f of lineas.children) {
        const id = f.querySelector('.sel-producto').value;
        const n = parseInt(f.querySelector('.cant').value, 10) || 0;
        if (id && n > 0) cantidades[id] = (cantidades[id] || 0) + n;
      }
      const ids = Object.keys(cantidades);
      if (!ids.length) return toast('Agrega al menos un producto.', true);
      for (const id of ids) {
        const p = producto(id);
        if (p.stock < cantidades[id]) return toast(`Solo quedan ${p.stock} de ${p.nombre}.`, true);
      }

      const pagado = form.pagado.checked;
      const entregado = form.entregado.checked;
      operar(`Pedido: ${cliente}`, () => {
        const items = ids.map(id => {
          const p = producto(id);
          p.stock -= cantidades[id];
          return { productoId: id, nombre: p.nombre, cantidad: cantidades[id], precio: p.precio, costo: costoDe(id) };
        });
        datos.pedidos.data.push({ id: nuevoId(), fecha: new Date().toISOString(), cliente, items, entregado, pagado });
        return ['pedidos', 'catalogo'];
      }, 'Pedido registrado 🧾');
    },
  },
    h('label', {}, 'Cliente',
      h('input', { name: 'cliente', list: 'clientes', autocomplete: 'off', placeholder: 'Ej. Ana de contabilidad' })),
    h('datalist', { id: 'clientes' }, clientes.map(c => h('option', { value: c }))),
    lineas,
    h('div', { class: 'acciones' },
      h('button', { type: 'button', class: 'btn sec chico', onclick: () => { lineas.append(filaLinea(lineas)); recalcular(); } }, '+ Otro producto')),
    h('div', { class: 'acciones' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'entregado', checked: true }), 'Ya entregado'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'pagado' }), 'Ya pagó')),
    h('div', { class: 'acciones' }, h('span', {}, 'Total:'), totalEl),
    h('button', { class: 'btn' }, 'Registrar pedido'));

  recalcular();
  return form;
}

function itemPedido(p) {
  const alternar = campo => operar(`Pedido ${p.cliente}: ${campo}`, () => { p[campo] = !p[campo]; return ['pedidos']; });
  return h('div', { class: 'item' },
    h('div', { class: 'cabeza' },
      h('strong', {}, p.cliente),
      h('span', { class: 'total' }, soles(totalPedido(p)))),
    h('div', { class: 'meta' }, fechaCorta(p.fecha)),
    h('ul', {}, p.items.map(i => h('li', {}, `${i.cantidad} × ${i.nombre} (${soles(i.precio)})`))),
    h('div', { class: 'acciones' },
      h('span', { class: 'chip ' + (p.entregado ? 'ok' : 'warn') }, p.entregado ? 'Entregado' : 'Por entregar'),
      h('span', { class: 'chip ' + (p.pagado ? 'ok' : 'bad') }, p.pagado ? 'Pagado' : 'Debe')),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn sec chico', onclick: () => alternar('entregado') }, p.entregado ? 'Marcar no entregado' : 'Marcar entregado'),
      h('button', { class: 'btn sec chico', onclick: () => alternar('pagado') }, p.pagado ? 'Marcar no pagado' : 'Marcar pagado'),
      h('button', {
        class: 'btn peligro chico',
        onclick: () => {
          if (!confirm(`¿Anular el pedido de ${p.cliente}? El stock se devuelve.`)) return;
          operar(`Anula pedido: ${p.cliente}`, () => {
            for (const i of p.items) { const prod = producto(i.productoId); if (prod) prod.stock += i.cantidad; }
            datos.pedidos.data = datos.pedidos.data.filter(x => x.id !== p.id);
            return ['pedidos', 'catalogo'];
          }, 'Pedido anulado');
        },
      }, 'Anular')));
}

function renderPedidos() {
  const todos = [...datos.pedidos.data].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const lista = filtroPedidos === 'abiertos' ? todos.filter(p => !p.entregado || !p.pagado) : todos;

  return [
    h('section', { class: 'tarjeta' }, h('h2', {}, 'Nuevo pedido'), formPedido()),
    h('section', { class: 'tarjeta' },
      h('div', { class: 'cabeza acciones', style: 'justify-content:space-between' },
        h('h2', {}, 'Pedidos'),
        h('select', {
          style: 'width:auto',
          onchange: e => { filtroPedidos = e.target.value; render(); },
        },
          h('option', { value: 'abiertos', selected: filtroPedidos === 'abiertos' }, 'Sin entregar o sin pagar'),
          h('option', { value: 'todos', selected: filtroPedidos === 'todos' }, 'Todos'))),
      lista.length
        ? h('div', { class: 'lista' }, lista.map(itemPedido))
        : h('p', { class: 'ayuda' }, filtroPedidos === 'abiertos' ? 'Todo entregado y cobrado. Así da gusto.' : 'Aún no hay pedidos.')),
  ];
}

/* ============================================================
   Pestaña: Compras (reposición)
   ============================================================ */

function renderCompras() {
  const unitario = h('span', { class: 'total' }, '—');
  const form = h('form', {
    oninput: () => {
      const n = parseInt(form.cantidad.value, 10);
      const t = parseFloat(form.costoTotal.value);
      unitario.textContent = n > 0 && t >= 0 ? soles(t / n) : '—';
    },
    onsubmit: e => {
      e.preventDefault();
      const productoId = form.producto.value;
      const cantidad = parseInt(form.cantidad.value, 10);
      const costoTotal = parseFloat(form.costoTotal.value);
      if (!(cantidad > 0) || !(costoTotal >= 0)) return toast('Revisa la cantidad y el costo.', true);
      const p = producto(productoId);
      operar(`Compra: ${cantidad} × ${p.nombre}`, () => {
        p.stock += cantidad;
        datos.costos.data[productoId] = Math.round((costoTotal / cantidad) * 10000) / 10000;
        datos.compras.data.push({
          id: nuevoId(), fecha: new Date().toISOString(), productoId, nombre: p.nombre,
          cantidad, costoTotal, nota: form.nota.value.trim(),
        });
        return ['compras', 'costos', 'catalogo'];
      }, `+${cantidad} ${p.nombre} al cajón 📦`);
    },
  },
    h('div', { class: 'fila' },
      h('label', {}, 'Producto', h('select', { name: 'producto' }, opcionesProductos())),
      h('label', {}, 'Unidades', h('input', { name: 'cantidad', type: 'number', min: 1, step: 1, required: true })),
      h('label', {}, 'Costo total (S/)', h('input', { name: 'costoTotal', type: 'number', min: 0, step: '0.01', required: true }))),
    h('label', {}, 'Nota (opcional)', h('input', { name: 'nota', placeholder: 'Ej. Makro, paquete x 24' })),
    h('div', { class: 'acciones' }, h('span', {}, 'Costo por unidad:'), unitario),
    h('button', { class: 'btn' }, 'Registrar compra'));

  const compras = [...datos.compras.data].sort((a, b) => b.fecha.localeCompare(a.fecha));

  return [
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Registrar compra'),
      h('p', { class: 'ayuda' }, 'Suma las unidades al stock y actualiza el costo por unidad del producto.'),
      form),
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Historial de compras'),
      compras.length
        ? h('div', { class: 'lista' }, compras.map(c => h('div', { class: 'item' },
          h('div', { class: 'cabeza' },
            h('strong', {}, `${c.cantidad} × ${c.nombre}`),
            h('span', { class: 'total' }, soles(c.costoTotal))),
          h('div', { class: 'meta' }, `${fechaCorta(c.fecha)} · ${soles(c.costoTotal / c.cantidad)} c/u${c.nota ? ' · ' + c.nota : ''}`),
          h('div', { class: 'acciones' },
            h('button', {
              class: 'btn peligro chico',
              onclick: () => {
                if (!confirm(`¿Borrar esta compra? Se restan ${c.cantidad} unidades del stock.`)) return;
                operar(`Borra compra: ${c.cantidad} × ${c.nombre}`, () => {
                  const p = producto(c.productoId);
                  if (p) p.stock = Math.max(0, p.stock - c.cantidad);
                  datos.compras.data = datos.compras.data.filter(x => x.id !== c.id);
                  return ['compras', 'catalogo'];
                }, 'Compra borrada');
              },
            }, 'Borrar')))))
        : h('p', { class: 'ayuda' }, 'Aún no registras compras.')),
  ];
}

/* ============================================================
   Pestaña: Productos (precios, costos, fotos)
   ============================================================ */

async function aImagenWeb(file, max = 600) {
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = h('canvas', { width: Math.round(bmp.width * escala), height: Math.round(bmp.height * escala) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const aBlob = (tipo, q) => new Promise(r => canvas.toBlob(r, tipo, q));
  let blob = await aBlob('image/webp', 0.82);
  // Safari antiguo no sabe generar WebP: usamos JPEG.
  if (!blob || blob.type !== 'image/webp') blob = await aBlob('image/jpeg', 0.85);
  return blob;
}

const blobAB64 = blob => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(r.result.split(',')[1]);
  r.onerror = mal;
  r.readAsDataURL(blob);
});

async function subirFoto(p, file) {
  document.body.classList.add('ocupado');
  try {
    const blob = await aImagenWeb(file);
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const ruta = `img/${p.id}.${ext}`;
    const r = await gh(rutaContenido('repoPublico', ruta), {
      method: 'PUT',
      body: JSON.stringify({
        message: `Foto: ${p.nombre}`,
        content: await blobAB64(blob),
        sha: await shaSiExiste('repoPublico', ruta),
      }),
    });
    // El ?v= obliga a los navegadores a pedir la foto nueva.
    await operar(`Foto: ${p.nombre}`, () => {
      p.imagen = `${ruta}?v=${r.content.sha.slice(0, 7)}`;
      return ['catalogo'];
    }, 'Foto subida 📸 (la vitrina la muestra en ~1 min)');
  } catch (e) {
    console.error(e);
    toast(`No se pudo subir la foto (${e.message}).`, true);
  } finally {
    document.body.classList.remove('ocupado');
  }
}

function tarjetaProducto(p) {
  const costo = costoDe(p.id);
  const form = h('form', {
    onsubmit: e => {
      e.preventDefault();
      const precio = parseFloat(form.precio.value);
      const stock = parseInt(form.stock.value, 10);
      const costoTxt = form.costo.value.trim();
      const nuevoCosto = costoTxt === '' ? null : parseFloat(costoTxt);
      if (!(precio >= 0) || !(stock >= 0) || (nuevoCosto !== null && !(nuevoCosto >= 0))) {
        return toast('Revisa precio, stock y costo.', true);
      }
      const cambios = {
        nombre: form.nombre.value.trim() || p.nombre,
        precio, stock,
        emoji: form.emoji.value.trim() || '📦',
        activo: form.activo.checked,
      };
      const cambiaCatalogo = Object.entries(cambios).some(([k, v]) => p[k] !== v);
      const cambiaCosto = nuevoCosto !== costo;
      if (!cambiaCatalogo && !cambiaCosto) return toast('No hay cambios.');
      operar(`Producto: ${cambios.nombre}`, () => {
        Object.assign(p, cambios);
        datos.costos.data[p.id] = nuevoCosto;
        return [cambiaCatalogo && 'catalogo', cambiaCosto && 'costos'].filter(Boolean);
      });
    },
  },
    h('div', { class: 'fila' },
      h('label', {}, 'Nombre', h('input', { name: 'nombre', value: p.nombre })),
      h('label', {}, 'Emoji', h('input', { name: 'emoji', value: p.emoji || '', maxLength: 8 }))),
    h('div', { class: 'fila' },
      h('label', {}, 'Precio venta (S/)', h('input', { name: 'precio', type: 'number', min: 0, step: '0.01', value: p.precio })),
      h('label', {}, 'Costo unidad (S/)', h('input', { name: 'costo', type: 'number', min: 0, step: '0.0001', value: costo ?? '', placeholder: '¿?' })),
      h('label', {}, 'Stock', h('input', { name: 'stock', type: 'number', min: 0, step: 1, value: p.stock }))),
    h('div', { class: 'acciones' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'activo', checked: p.activo !== false }), 'Visible en la vitrina'),
      h('button', { class: 'btn chico' }, 'Guardar'),
      h('label', { class: 'btn sec chico', style: 'display:inline-block;cursor:pointer' },
        p.imagen ? 'Cambiar foto' : 'Subir foto',
        h('input', {
          type: 'file', accept: 'image/*', hidden: true,
          onchange: e => { const f = e.target.files[0]; if (f) subirFoto(p, f); },
        })),
      p.imagen
        ? h('button', {
          type: 'button', class: 'btn sec chico',
          onclick: () => operar(`Quita foto: ${p.nombre}`, () => { p.imagen = null; return ['catalogo']; }, 'Ahora se muestra el emoji'),
        }, 'Usar emoji')
        : null));

  return h('section', { class: 'tarjeta' },
    h('div', { class: 'prod-cabeza' },
      fotoMini(p),
      h('div', {},
        h('h2', {}, p.nombre),
        h('div', { class: 'ayuda' }, costo == null ? 'Sin costo registrado' : `Margen: ${soles(p.precio - costo)} por unidad`))),
    form);
}

function formNuevoProducto() {
  const form = h('form', {
    onsubmit: e => {
      e.preventDefault();
      const nombre = form.nombre.value.trim();
      const precio = parseFloat(form.precio.value);
      const costoTxt = form.costo.value.trim();
      const id = slug(nombre);
      if (!id || !(precio >= 0)) return toast('Ponle nombre y precio.', true);
      if (producto(id)) return toast('Ya existe un producto con ese nombre.', true);
      operar(`Nuevo producto: ${nombre}`, () => {
        productos().push({ id, nombre, precio, stock: 0, emoji: form.emoji.value.trim() || '📦', imagen: null, activo: true });
        datos.costos.data[id] = costoTxt === '' ? null : parseFloat(costoTxt);
        return ['catalogo', 'costos'];
      }, `${nombre} agregado. Registra una compra para darle stock.`);
    },
  },
    h('div', { class: 'fila' },
      h('label', {}, 'Nombre', h('input', { name: 'nombre', required: true, placeholder: 'Ej. Chocosoda' })),
      h('label', {}, 'Emoji', h('input', { name: 'emoji', placeholder: '🍫', maxLength: 8 })),
      h('label', {}, 'Precio (S/)', h('input', { name: 'precio', type: 'number', min: 0, step: '0.01', value: 1 })),
      h('label', {}, 'Costo u. (opcional)', h('input', { name: 'costo', type: 'number', min: 0, step: '0.0001' }))),
    h('button', { class: 'btn' }, 'Agregar producto'));
  return form;
}

function renderProductos() {
  return [
    ...productos().map(tarjetaProducto),
    h('section', { class: 'tarjeta' }, h('h2', {}, 'Nuevo producto'), formNuevoProducto()),
  ];
}

/* ============================================================
   Pestaña: Ajustes
   ============================================================ */

function renderAjustes() {
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      guardarConfig({
        owner: form.owner.value.trim(),
        repoPublico: form.repoPublico.value.trim(),
        repoPrivado: form.repoPrivado.value.trim(),
        token: form.token.value.trim(),
        recordar: form.recordar.checked,
      });
      await iniciar();
    },
  },
    h('div', { class: 'fila' },
      h('label', {}, 'Usuario de GitHub', h('input', { name: 'owner', value: cfg.owner })),
      h('label', {}, 'Repo público', h('input', { name: 'repoPublico', value: cfg.repoPublico })),
      h('label', {}, 'Repo privado', h('input', { name: 'repoPrivado', value: cfg.repoPrivado }))),
    h('label', {}, 'Token de GitHub',
      h('input', { name: 'token', type: 'password', value: cfg.token, autocomplete: 'off', placeholder: 'github_pat_…' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'recordar', checked: cfg.recordar }), 'Recordar en este dispositivo'),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn' }, 'Conectar'),
      cfg.token
        ? h('button', {
          type: 'button', class: 'btn peligro',
          onclick: () => { guardarConfig({ ...cfg, token: '' }); toast('Token borrado de este dispositivo.'); mostrar('ajustes'); },
        }, 'Cerrar sesión')
        : null));

  return [
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Conexión con GitHub'),
      h('p', { class: 'ayuda' },
        'Necesitas un token "fine-grained" con permiso Contents: Read and write, limitado a los dos repos. ',
        h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'Crear token'),
        '. El token se queda solo en este navegador.'),
      form),
  ];
}

/* ============================================================
   Navegación
   ============================================================ */

const VISTAS = {
  resumen: renderResumen,
  pedidos: renderPedidos,
  compras: renderCompras,
  productos: renderProductos,
  ajustes: renderAjustes,
};

function render() {
  const listo = Object.keys(ARCHIVOS).every(k => datos[k]);
  if (!listo) pestana = 'ajustes';
  for (const b of document.querySelectorAll('.pestanas button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === pestana));
    b.disabled = !listo && b.dataset.tab !== 'ajustes';
  }
  $('#panel').replaceChildren(...[VISTAS[pestana]()].flat().filter(Boolean));
}

function mostrar(nombre) {
  pestana = nombre;
  try { sessionStorage.setItem('cachibaches.pestana', nombre); } catch {}
  render();
}

async function iniciar() {
  for (const k of Object.keys(datos)) delete datos[k];
  if (!cfg.token) return mostrar('ajustes');
  document.body.classList.add('ocupado');
  try {
    await cargarTodo();
    let guardada = null;
    try { guardada = sessionStorage.getItem('cachibaches.pestana'); } catch {}
    mostrar(guardada && guardada !== 'ajustes' && VISTAS[guardada] ? guardada : 'resumen');
  } catch (e) {
    console.error(e);
    toast(e.status === 401 ? 'Token inválido o vencido.'
      : e.status === 404 ? 'No encuentro los repos o archivos. Revisa nombres y permisos del token.'
        : `No se pudo conectar (${e.message}).`, true);
    mostrar('ajustes');
  } finally {
    document.body.classList.remove('ocupado');
  }
}

document.querySelector('.pestanas').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b && !b.disabled) mostrar(b.dataset.tab);
});

iniciar();
