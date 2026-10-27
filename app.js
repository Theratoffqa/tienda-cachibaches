'use strict';

const soles = n => 'S/ ' + Number(n).toFixed(2);

function chipStock(stock) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  if (stock <= 0) { chip.classList.add('bad'); chip.textContent = 'Agotado'; }
  else if (stock <= 3) { chip.classList.add('warn'); chip.textContent = `¡Últimas ${stock}!`; }
  else { chip.classList.add('ok'); chip.textContent = `Quedan ${stock}`; }
  return chip;
}

function tarjeta(p) {
  const art = document.createElement('article');
  art.className = 'producto' + (p.stock <= 0 ? ' agotado' : '');

  const foto = document.createElement('div');
  foto.className = 'foto';
  if (p.imagen) {
    const img = document.createElement('img');
    img.src = p.imagen;
    img.alt = p.nombre;
    img.loading = 'lazy';
    // Si la imagen falla, volvemos al emoji.
    img.onerror = () => { foto.textContent = p.emoji || '📦'; };
    foto.append(img);
  } else {
    foto.textContent = p.emoji || '📦';
  }

  const info = document.createElement('div');
  info.className = 'info';
  const h3 = document.createElement('h3');
  h3.textContent = p.nombre;
  const precio = document.createElement('div');
  precio.className = 'precio';
  precio.textContent = soles(p.precio);
  info.append(h3, precio, chipStock(p.stock));

  art.append(foto, info);
  return art;
}

async function cargar() {
  const grilla = document.getElementById('grilla');
  try {
    const res = await fetch('catalogo.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const catalogo = await res.json();
    const visibles = catalogo.productos
      .filter(p => p.activo !== false)
      // Primero lo que hay, luego lo agotado.
      .sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.nombre.localeCompare(b.nombre, 'es'));

    grilla.replaceChildren(...visibles.map(tarjeta));
    if (!visibles.length) grilla.innerHTML = '<p class="vacio">El cajón está vacío. Vuelve mañana 🥲</p>';

    if (catalogo.actualizado) {
      const fecha = new Date(catalogo.actualizado).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
      document.getElementById('actualizado').textContent = `Stock actualizado: ${fecha}`;
    }
  } catch {
    grilla.innerHTML = '<p class="vacio">No se pudo abrir el cajón. Recarga la página.</p>';
  }
}

cargar();
