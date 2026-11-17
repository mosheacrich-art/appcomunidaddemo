/**
 * @file eventos-comun.js
 * @description Lógica compartida por eventos.html (lista) y evento.html (ficha):
 * carga de datos (instantánea + Supabase), cartel del evento, compartir,
 * inscripción (modales, familiares/hijos, pago Stripe, donativo), lista de
 * espera, cancelación y confeti.
 *
 * Cada página define `onEventosChange()`, que se llama cada vez que cambian
 * los datos (carga, inscripción, cancelación) para que se repinte.
 *
 * Depende de: data.js (MOCK_EVENTOS, eventoPasado), nav.js (escHtml,
 * showToast), auth.js (getSupabase, getValidSession, getCurrentUser,
 * trackEvent, SUPABASE_URL), familia.js (getFamilyLinks), media.js
 * (resolveMediaFields).
 */

/* ─── Estado ─── */
const inscrito = new Set();          // ids (string) de eventos en los que estoy inscrito
const SUBGRUPO_NOMBRE = {};          // id → nombre, para la etiqueta «Dirigido a»
let pendingEv = null;

const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_S = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS_LARGO = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

/* ─── Utilidades ─── */
function evRefresh() { if (typeof onEventosChange === 'function') onEventosChange(); }
function evFind(id) { return MOCK_EVENTOS.find(e => String(e.id) === String(id)); }
function evEstaInscrito(ev) { return !!ev && inscrito.has(String(ev.id)); }
function evDate(ev) { return new Date(String(ev.fecha).slice(0, 10) + 'T00:00:00'); }
function evHora(ev) { return ev.hora ? String(ev.hora).slice(0, 5) : ''; }
function evFechaLarga(ev) {
  const d = evDate(ev);
  return `${DIAS_LARGO[d.getDay()]}, ${d.getDate()} de ${MESES_FULL[d.getMonth()].toLowerCase()}`;
}
function evPrecio(ev) { return parseFloat(ev?.precio) || 0; }
function evPrecioTxt(ev) {
  const p = evPrecio(ev);
  if (!p) return 'Gratis';
  return (Number.isInteger(p) ? String(p) : p.toFixed(2).replace('.', ',')) + ' €';
}
function evLleno(ev) { return !!ev.aforo && (ev.aforo - (ev.inscritos || 0)) <= 0; }
function evPlazasLibres(ev) { return ev.aforo ? Math.max(0, ev.aforo - (ev.inscritos || 0)) : null; }
function evLugarCorto(ev) { return ev.lugar ? String(ev.lugar).split(',')[0] : 'Por confirmar'; }
function evUrl(id) { return 'evento.html?id=' + encodeURIComponent(id); }
function evImg(ev) {
  const u = ev.imagen_url_signed;
  return u && /^https?:\/\//i.test(u) ? u : '';
}
function evCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function evDirigidoA(ev) { return ev.subgrupo_id ? (SUBGRUPO_NOMBRE[ev.subgrupo_id] || 'Grupo') : 'Para todos'; }

const EV_CAT_COLOR = {
  Shabat: '#7C3AED', Estudio: '#3B82F6', Festividad: '#C9A84C', Educación: '#10B981',
  Infantil: '#10B981', Cultura: '#EC4899', Comunidad: '#1B2E5E'
};
function evCatColor(cat) { return EV_CAT_COLOR[cat] || '#1B2E5E'; }

/** Nombre de view-transition único por evento (identificador CSS válido). */
function evVtName(id) { return 'evp-' + String(id).replace(/[^a-zA-Z0-9_-]/g, ''); }

const EV_ICON = {
  cal:   '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>',
  clock: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
  pin:   '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>',
  users: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>',
  share: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"/></svg>',
  ticket:'<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z"/></svg>',
  check: '<svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>',
  plus:  '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>',
  back:  '<svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></svg>',
  close: '<svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:18px;height:18px;" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>',
};

/* ─── Cartel ─── */
const EV_POSTER_BG = ['#1B2E5E', '#12204A', '#2A4080', '#33295F', '#1D4A5A', '#5A2A3E'];
function _evHash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

/**
 * HTML del cartel del evento. Mismo view-transition-name en la lista y en la
 * ficha, para que el cartel "vuele" de una página a otra.
 * @param {object} ev
 * @param {{badge?: string, badgeClass?: string, eager?: boolean}} [opts]
 */
function evPosterHTML(ev, opts = {}) {
  const vt = `view-transition-name:${evVtName(ev.id)}`;
  const badge = opts.badge ? `<span class="ev-poster-badge ${opts.badgeClass || ''}">${escHtml(opts.badge)}</span>` : '';
  const img = evImg(ev);
  if (img) {
    const cssUrl = img.replace(/["'()\\\s]/g, c => encodeURIComponent(c));
    return `<div class="ev-poster" style="${vt}">
      <div class="ev-poster-blur" style="background-image:url('${escHtml(cssUrl)}')"></div>
      <img class="ev-poster-img" src="${escHtml(img)}" alt="Cartel: ${escHtml(ev.titulo)}" ${opts.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      ${badge}
    </div>`;
  }
  const h = _evHash(ev.id);
  const bg = EV_POSTER_BG[h % EV_POSTER_BG.length];
  const shapes = [
    '<circle cx="360" cy="70" r="150" fill="#C9A84C" opacity=".22"/><circle cx="30" cy="470" r="120" fill="#000" opacity=".16"/><circle cx="340" cy="360" r="40" fill="#fff" opacity=".08"/>',
    '<rect x="200" y="-60" width="280" height="280" rx="70" transform="rotate(22 340 80)" fill="#fff" opacity=".09"/><circle cx="60" cy="430" r="96" fill="#C9A84C" opacity=".25"/>',
    '<path d="M0 320 Q200 240 400 330 L400 500 L0 500Z" fill="#000" opacity=".16"/><circle cx="320" cy="110" r="78" fill="#C9A84C" opacity=".28"/><circle cx="70" cy="90" r="22" fill="#fff" opacity=".12"/>'
  ][h % 3];
  const hora = evHora(ev) ? ` · ${escHtml(evHora(ev))}` : '';
  return `<div class="ev-poster ev-poster--gen" style="${vt};background:${bg}">
    <svg class="ev-poster-shapes" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${shapes}</svg>
    <div class="ev-poster-inner">
      <span class="ev-poster-brand">{{name}}<small><i style="background:${evCatColor(ev.categoria)}"></i>${escHtml(ev.categoria || 'Evento')}</small></span>
      ${ev.emoji ? `<span class="ev-poster-emoji" aria-hidden="true">${escHtml(ev.emoji)}</span>` : ''}
      <h3 class="ev-poster-title">${escHtml(ev.titulo)}</h3>
      <p class="ev-poster-meta">${EV_ICON.cal}${escHtml(evCap(evFechaLarga(ev)))}${hora}</p>
      <p class="ev-poster-meta">${EV_ICON.pin}${escHtml(evLugarCorto(ev))}</p>
      ${opts.badge ? '' : `<span class="ev-poster-cta">${evPrecio(ev) ? 'Inscríbete · ' + escHtml(evPrecioTxt(ev)) : 'Inscríbete gratis'}</span>`}
    </div>
    ${badge}
  </div>`;
}

/** Badge de estado para el cartel: inscrito / completo / nada. */
function evPosterBadge(ev) {
  if (evEstaInscrito(ev)) return { badge: '✓ Inscrito' };
  if (evLleno(ev)) return { badge: 'Completo', badgeClass: 'is-full' };
  return {};
}

/* ─── Datos: instantánea en localStorage + Supabase ───
   La instantánea pinta al instante (sin esperar a la red). Guarda URLs
   firmadas de fotos, por eso caduca un poco antes que ellas (ver media.js). */
const EVENTOS_SNAP_KEY = 'kehila_snap_eventos_v2';
const EVENTOS_SNAP_SAVED_AT = 'kehila_snap_eventos_v2_saved_at';
const EVENTOS_SNAP_MAX_AGE_MS = (typeof MEDIA_URL_MIN_VALIDITY_MS === 'number'
  ? MEDIA_URL_MIN_VALIDITY_MS : 60 * 60 * 1000) - 2 * 60 * 60 * 1000;
const INSCRITO_SNAP_KEY = 'kehila_snap_inscrito_v1';

/** Pinta desde memoria o desde la instantánea. Devuelve true si había datos. */
function evPintarInstantanea() {
  try {
    const ins = JSON.parse(localStorage.getItem(INSCRITO_SNAP_KEY) || '[]');
    if (Array.isArray(ins)) ins.forEach(id => inscrito.add(String(id)));
  } catch (_) {}
  if (MOCK_EVENTOS.length) { evRefresh(); return true; }
  const savedAt = Number(localStorage.getItem(EVENTOS_SNAP_SAVED_AT)) || 0;
  if (Date.now() - savedAt > EVENTOS_SNAP_MAX_AGE_MS) return false;
  try {
    const snap = JSON.parse(localStorage.getItem(EVENTOS_SNAP_KEY) || 'null');
    if (Array.isArray(snap) && snap.length) {
      snap.forEach(ev => MOCK_EVENTOS.push(ev));
      evRefresh();
      return true;
    }
  } catch (_) { /* instantánea corrupta: se ignora */ }
  return false;
}

function _evGuardarInscritos() {
  try { localStorage.setItem(INSCRITO_SNAP_KEY, JSON.stringify([...inscrito])); } catch (_) {}
}

let evCargado = false;   // true cuando ya respondió Supabase (aunque sea con error)

/** Carga eventos, inscripciones y subgrupos desde Supabase. */
async function evCargar() {
  const sb = getSupabase();
  if (sb) {
    try {
      // inscripciones no tiene GRANT de SELECT para anon: sin sesión real
      // confirmada esa consulta devuelve 42501.
      const session = typeof getValidSession === 'function' ? await getValidSession() : null;
      const [evRes, insRes, allInsRes, sgRes] = await Promise.all([
        sb.from('eventos').select('*').order('fecha', { ascending: true }),
        session ? sb.from('inscripciones').select('evento_id').eq('usuario_id', session.user.id) : Promise.resolve({ data: null }),
        session ? sb.from('inscripciones').select('evento_id') : Promise.resolve({ data: [] }),
        sb.from('subgrupos').select('id, nombre')
      ]);
      (sgRes.data || []).forEach(g => { SUBGRUPO_NOMBRE[g.id] = g.nombre; });
      const conteos = {};
      (allInsRes.data || []).forEach(r => { conteos[r.evento_id] = (conteos[r.evento_id] || 0) + 1; });
      if (evRes.data?.length && typeof resolveMediaFields === 'function') {
        await resolveMediaFields(evRes.data, [{ bucket: 'community media', field: 'imagen_url' }]);
      }
      if (evRes.data) {
        // Se limpia antes de repoblar (MOCK_EVENTOS puede venir de la instantánea).
        MOCK_EVENTOS.length = 0;
        evRes.data.forEach(ev => {
          ev.inscritos = conteos[String(ev.id)] || 0;
          MOCK_EVENTOS.unshift(ev);
        });
        try {
          localStorage.setItem(EVENTOS_SNAP_KEY, JSON.stringify(MOCK_EVENTOS));
          localStorage.setItem(EVENTOS_SNAP_SAVED_AT, String(Date.now()));
        } catch (_) {}
      }
      if (insRes.data) {
        inscrito.clear();
        insRes.data.forEach(r => inscrito.add(String(r.evento_id)));
        _evGuardarInscritos();
      }
    } catch (_) {}
  }
  evCargado = true;
  evRefresh();
}

/* Hijos registrados (tabla children), para inscribirlos desde el modal. */
let _hijosEvCache = [];
async function loadHijosParaEventos() {
  const sb = getSupabase();
  const user = getCurrentUser();
  if (!sb || !user?.userId) return;
  try {
    const { data } = await sb.from('children').select('id, nombre, apellidos').eq('parent_id', user.userId).order('nombre');
    _hijosEvCache = data || [];
  } catch (_) {}
}

/* ─── Compartir: «Copiar enlace», WhatsApp, email y apps ─── */
let _shareData = null;

function compartirEvento(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const ev = evFind(id);
  if (!ev) return;
  // Dominio público canónico de la comunidad. Quien no tenga sesión pasa
  // por el login y vuelve aquí.
  const url = `{{url}}/evento.html?id=${encodeURIComponent(id)}`;
  const fecha = evDate(ev);
  let linea = `${fecha.getDate()} ${MESES_S[fecha.getMonth()]}`;
  if (ev.hora) linea += ` · ${evHora(ev)}`;
  const partes = [`*${ev.titulo}*`, linea];
  if (ev.lugar) partes.push(`📍 ${evLugarCorto(ev)}`);
  partes.push('', `Apúntate aquí: ${url}`);
  _shareData = { titulo: ev.titulo, linea, url, texto: partes.join('\n') };
  abrirCompartir('Compartir evento', `${ev.titulo} · ${linea}`);
}

function abrirCompartir(titulo, sub) {
  let m = document.getElementById('share-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'share-modal';
    m.className = 'share-overlay';
    m.onclick = (ev2) => { if (ev2.target === m) cerrarCompartir(); };
    document.body.appendChild(m);
  }
  const ic = (d) => `<svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
  m.innerHTML = `
    <div class="share-sheet" role="dialog" aria-label="${escHtml(titulo)}">
      <div class="share-head">
        <div><div class="share-title">${escHtml(titulo)}</div><div class="share-sub">${escHtml(sub)}</div></div>
        <button class="share-x" onclick="cerrarCompartir()" aria-label="Cerrar">&times;</button>
      </div>
      <div class="share-link">
        <input id="share-url" readonly value="${escHtml(_shareData.url)}" onclick="this.select()">
        <button class="btn btn-primary btn-sm" onclick="copiarEnlaceEvento()">Copiar</button>
      </div>
      <div class="share-opts">
        <button onclick="compartirPor('whatsapp')"><span class="share-ic" style="background:#25D366;color:#fff;"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/></svg></span>WhatsApp</button>
        <button onclick="compartirPor('email')"><span class="share-ic">${ic('M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75')}</span>Email</button>
        <button onclick="compartirPor('texto')"><span class="share-ic">${ic('M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184')}</span>Copiar mensaje</button>
        ${navigator.share ? `<button onclick="compartirPor('nativo')"><span class="share-ic">${EV_ICON.share}</span>Más apps</button>` : ''}
      </div>
    </div>`;
  m.classList.add('open');
}

function cerrarCompartir() { document.getElementById('share-modal')?.classList.remove('open'); }

/** Copia al portapapeles con respaldo para WebViews sin Clipboard API. */
async function _copiar(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (_) { return false; }
}

async function copiarEnlaceEvento() {
  if (!_shareData) return;
  const ok = await _copiar(_shareData.url);
  showToast(ok ? 'Enlace copiado' : 'Mantén pulsado el enlace para copiarlo', ok ? 'success' : 'info');
  if (ok) cerrarCompartir();
}

function _abrirExterno(url) {
  // En la app (Capacitor) las URLs externas se abren navegando; en web, pestaña nueva.
  if (window.Capacitor?.isNativePlatform?.()) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

async function compartirPor(via) {
  const d = _shareData; if (!d) return;
  if (via === 'whatsapp') _abrirExterno('https://wa.me/?text=' + encodeURIComponent(d.texto));
  else if (via === 'email') window.location.href = `mailto:?subject=${encodeURIComponent(d.titulo)}&body=${encodeURIComponent(d.texto.replace(/\*/g, ''))}`;
  else if (via === 'texto') {
    const ok = await _copiar(d.texto);
    showToast(ok ? 'Mensaje copiado: pégalo donde quieras' : 'No se pudo copiar', ok ? 'success' : 'error');
  } else if (via === 'nativo' && navigator.share) {
    navigator.share({ title: d.titulo, text: d.texto.replace(/\*/g, '') }).catch(() => {});
  }
  if (typeof trackEvent === 'function') trackEvent('evento_compartido', { via });
  cerrarCompartir();
}

/* ─── Modales (inyectados una vez en cada página) ─── */
function _evInyectarModales() {
  if (document.getElementById('modal-inscripcion')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay modal-centered hidden" id="modal-inscripcion">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 class="modal-title">Confirmar inscripción</h3>
      <button class="modal-close" onclick="closeModal('modal-inscripcion')" aria-label="Cerrar">${EV_ICON.close}</button>
    </div>
    <div class="modal-body">
      <p style="font-size:.875rem;color:var(--color-text-muted);margin-bottom:14px;">¿Confirmar inscripción a:</p>
      <p style="font-size:1rem;font-weight:700;color:var(--color-text);margin-bottom:8px;" id="modal-ev-titulo"></p>
      <div style="background:var(--color-bg);border-radius:var(--radius-sm);padding:12px 14px;font-size:.875rem;color:var(--color-text-muted);display:flex;flex-direction:column;gap:4px;">
        <span id="modal-ev-fecha"></span>
        <span id="modal-ev-lugar"></span>
        <span id="modal-ev-precio"></span>
      </div>
      <div id="modal-familia-wrap" style="display:none;margin-top:16px;border-top:1px solid var(--color-border);padding-top:14px;">
        <p style="font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-muted);margin-bottom:10px;">Inscribir también a familiares</p>
        <div id="modal-familia-checks" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('modal-inscripcion')">Cancelar</button>
      <button class="btn btn-primary" id="btn-confirm-inscripcion">${EV_ICON.check.replace('aria-hidden="true"', 'style="width:16px;height:16px;" aria-hidden="true"')} Confirmar inscripción</button>
    </div>
  </div>
</div>

<div class="modal-overlay modal-centered hidden" id="modal-post-inscripcion">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 class="modal-title">¡Inscripción confirmada!</h3>
      <button class="modal-close" onclick="closeModal('modal-post-inscripcion')" aria-label="Cerrar">${EV_ICON.close}</button>
    </div>
    <div class="modal-body">
      <div style="display:flex;align-items:center;gap:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
        <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:22px;height:22px;color:#16a34a;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
        <span style="font-size:.9rem;font-weight:600;color:#15803d;" id="post-ev-titulo">Estás inscrito</span>
      </div>
      <p id="post-ev-mensaje" style="font-size:.875rem;color:var(--color-text-muted);margin-bottom:18px;line-height:1.55;display:none;"></p>
      <div id="post-pago-section" style="display:none;border-top:1px solid var(--color-border);padding-top:16px;">
        <p style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-muted);margin-bottom:10px;">Resumen del pago</p>
        <div id="post-pago-desglose" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--color-primary);border-radius:var(--radius-sm);">
          <span style="font-size:.875rem;font-weight:600;color:#fff;">Total a pagar</span>
          <span id="post-pago-total" style="font-family:var(--font-brand);font-size:1.1rem;font-weight:700;color:#C9A84C;"></span>
        </div>
      </div>
      <div id="post-don-section" style="border-top:1px solid var(--color-border);padding-top:16px;">
        <p style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-muted);margin-bottom:10px;">Donativo voluntario</p>
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;" id="post-don-chips">
          <button class="don-chip" data-amount="18" onclick="selectDonChip(this,18)">18 €</button>
          <button class="don-chip" data-amount="50" onclick="selectDonChip(this,50)">50 €</button>
          <button class="don-chip don-chip-otro" data-amount="0" onclick="selectDonChip(this,0)">Otra cantidad</button>
        </div>
        <div id="post-don-custom" style="display:none;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" id="post-don-input" min="1" placeholder="Cantidad en €" style="flex:1;padding:8px 12px;border:1px solid var(--color-border);border-radius:8px;font-size:.9rem;font-family:inherit;">
            <span style="font-size:.9rem;color:var(--color-text-muted);">€</span>
          </div>
        </div>
      </div>
    </div>
    <div id="post-stripe-step" style="display:none;padding:0 var(--spacing-xl) 4px;">
      <p style="font-size:.75rem;color:var(--color-text-muted);margin-bottom:10px;display:flex;align-items:center;gap:5px;">
        <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:13px;height:13px;"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>
        Pago seguro con Stripe
      </p>
      <div id="post-stripe-card" style="border:1.5px solid #E2E8F0;border-radius:10px;padding:12px 14px;background:#fff;"></div>
      <div id="post-stripe-error" style="color:#e53e3e;font-size:.78rem;margin-top:7px;min-height:14px;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="btn-post-back" onclick="backPostDon()" style="display:none;">← Atrás</button>
      <button class="btn btn-ghost" onclick="closeModal('modal-post-inscripcion')" id="btn-post-skip">Ahora no</button>
      <button class="btn btn-primary" id="btn-post-donar" onclick="pagarODonar()" disabled>
        <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 21Z"/></svg>
        <span id="btn-post-donar-label">Pagar</span>
      </button>
    </div>
  </div>
</div>

<div class="modal-overlay modal-centered hidden" id="modal-espera">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 class="modal-title">Lista de espera</h3>
      <button class="modal-close" onclick="closeModal('modal-espera')" aria-label="Cerrar">${EV_ICON.close}</button>
    </div>
    <div class="modal-body">
      <div class="auth-info-banner">
        <svg fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" style="width:17px;height:17px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
        <span>El evento está completo. Puedes apuntarte a la lista de espera y te avisaremos si se libera una plaza.</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('modal-espera')">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmEspera()">Apuntarme a la lista</button>
    </div>
  </div>
</div>`);

  document.getElementById('btn-confirm-inscripcion').addEventListener('click', confirmarInscripcion);
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id)); });
  document.addEventListener('input', e => {
    if (e.target.id !== 'post-don-input') return;
    const val = parseFloat(e.target.value);
    document.getElementById('btn-post-donar').disabled = !(val > 0);
  });
}

/* body.style.overflow='hidden' no bloquea el scroll táctil en Safari iOS: se
   fija el body (position:fixed + top negativo) y se restaura al cerrar. */
let _modalScrollY = 0;
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  _modalScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_modalScrollY}px`;
  document.body.style.width = '100%';
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, _modalScrollY);
}

/* ─── Inscripción ─── */
function openInscripcion(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const ev = evFind(id);
  if (!ev || eventoPasado(ev)) { showToast('Este evento ya ha pasado.', 'warning'); evRefresh(); return; }
  pendingEv = String(ev.id);
  const fecha = evDate(ev);
  const ic = (svg) => svg.replace('aria-hidden="true"', 'style="width:16px;height:16px;display:inline-block;vertical-align:middle" aria-hidden="true"');
  document.getElementById('modal-ev-titulo').textContent = ev.titulo;
  document.getElementById('modal-ev-fecha').innerHTML = `${ic(EV_ICON.cal)} ${fecha.getDate()} de ${MESES_FULL[fecha.getMonth()]}${ev.hora ? ' · ' + escHtml(evHora(ev)) : ''}`;
  document.getElementById('modal-ev-lugar').innerHTML = `${ic(EV_ICON.pin)} ${escHtml(ev.lugar || 'Por confirmar')}`;
  const precioEl = document.getElementById('modal-ev-precio');
  if (evPrecio(ev)) {
    precioEl.innerHTML = `${ic(EV_ICON.ticket)} <strong style="color:var(--color-text);">${escHtml(evPrecioTxt(ev))} por persona</strong>`;
    precioEl.style.display = '';
  } else {
    precioEl.style.display = 'none';
  }

  // Familiares vinculados + hijos registrados en Supabase
  const currentUser = getCurrentUser();
  const userId = currentUser?.userId || currentUser?.email;
  const adultLinks = userId && typeof getFamilyLinks === 'function' ? getFamilyLinks(userId) : [];
  const childLinks = _hijosEvCache.map(h => ({
    id: 'child-' + h.id,
    name: h.nombre + ' ' + h.apellidos,
    initials: ((h.nombre?.[0] || '') + (h.apellidos?.[0] || '')).toUpperCase() || '?',
    is_child: true
  }));
  const familyLinks = [...adultLinks, ...childLinks];
  const familyWrap = document.getElementById('modal-familia-wrap');
  const familyChecks = document.getElementById('modal-familia-checks');
  if (familyLinks.length) {
    familyChecks.innerHTML = familyLinks.map(f => `
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 8px;border-radius:var(--radius-xs);">
        <input type="checkbox" data-familia-id="${escHtml(f.id)}" data-familia-name="${escHtml(f.name)}" style="width:16px;height:16px;flex-shrink:0;accent-color:var(--color-primary);cursor:pointer;">
        <div class="avatar" data-color="${f.is_child ? '5' : (typeof getAvatarColor === 'function' ? getAvatarColor(f.name) : '1')}" style="width:28px;height:28px;font-size:.7rem;flex-shrink:0;">${escHtml(f.initials)}</div>
        <span style="font-size:.875rem;color:var(--color-text);font-weight:500;">${escHtml(f.name)}${f.is_child ? ' <span style="font-size:.7rem;color:#1D4ED8;font-weight:600;background:#EFF6FF;padding:1px 4px;border-radius:3px;border:1px solid #BFDBFE;">Menor</span>' : ''}</span>
      </label>`).join('');
    familyWrap.style.display = '';
  } else {
    familyWrap.style.display = 'none';
  }

  openModal('modal-inscripcion');
  if (typeof trackEvent === 'function') trackEvent('inscripcion_inicio', { evento: String(id) });
}

let postInscripcionEvId = null;
let postInscripcionFamilia = [];

async function confirmarInscripcion() {
  const evId = pendingEv;
  const ev = evFind(evId);
  if (!ev || eventoPasado(ev)) {
    closeModal('modal-inscripcion');
    showToast('Este evento ya ha pasado.', 'warning');
    evRefresh();
    return;
  }

  const familiaChecked = [...document.querySelectorAll('#modal-familia-checks input[type=checkbox]:checked')];
  const totalInscritos = 1 + familiaChecked.length;

  const sb = getSupabase();
  const session = typeof getValidSession === 'function' ? await getValidSession() : null;
  if (!sb || !session) {
    showToast('No se pudo confirmar tu sesión. Vuelve a intentarlo.', 'error');
    return;
  }

  inscrito.add(evId);
  ev.inscritos = (ev.inscritos || 0) + totalInscritos;
  closeModal('modal-inscripcion');
  evRefresh();
  pendingEv = null;

  const uid = session.user.id;
  const rows = [{ usuario_id: uid, evento_id: evId, evento_titulo: ev.titulo }];
  familiaChecked.forEach(ck => {
    rows.push({ usuario_id: uid, evento_id: evId, evento_titulo: ev.titulo, familiar_nombre: ck.dataset.familiaName });
  });
  const { error } = await sb.from('inscripciones').insert(rows);
  if (error) {
    inscrito.delete(evId);
    ev.inscritos = Math.max(0, (ev.inscritos || totalInscritos) - totalInscritos);
    evRefresh();
    showToast('Error al guardar inscripción: ' + error.message, 'error');
    if (typeof trackEvent === 'function') trackEvent('inscripcion_error', { evento: evId, msg: String(error.message).slice(0, 120) });
    return;
  }
  _evGuardarInscritos();
  if (typeof trackEvent === 'function') trackEvent('inscripcion_ok', { evento: evId, personas: totalInscritos });
  evConfeti();

  // Modal post-inscripción: pago (evento de precio) o donativo (gratuito)
  postInscripcionEvId = evId;
  postInscripcionFamilia = familiaChecked.map(ck => ck.dataset.familiaName);

  document.getElementById('post-ev-titulo').textContent = `¡Estás inscrito en "${ev.titulo}"!`;
  const msgEl = document.getElementById('post-ev-mensaje');
  const msg = ev.mensaje_inscripcion || '';
  if (msg) { msgEl.textContent = msg; msgEl.style.display = ''; }
  else { msgEl.style.display = 'none'; }

  const precio = evPrecio(ev);
  const pagoSection = document.getElementById('post-pago-section');
  const donSection = document.getElementById('post-don-section');
  const btnDonar = document.getElementById('btn-post-donar');
  const btnLabel = document.getElementById('btn-post-donar-label');
  const btnSkip = document.getElementById('btn-post-skip');

  if (precio > 0) {
    pagoSection.style.display = '';
    donSection.style.display = 'none';
    const userName = getCurrentUser()?.name || 'Tú';
    const personas = [{ name: userName }, ...postInscripcionFamilia.map(n => ({ name: n }))];
    const total = precio * personas.length;
    document.getElementById('post-pago-desglose').innerHTML = personas.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:.875rem;color:var(--color-text-muted);">
        <span>${escHtml(p.name)}</span>
        <span style="font-weight:500;color:var(--color-text);">${precio.toFixed(2)} €</span>
      </div>`).join('');
    document.getElementById('post-pago-total').textContent = `${total.toFixed(2)} €`;
    btnLabel.textContent = personas.length > 1 ? `Pagar ${total.toFixed(2)} € (${personas.length} personas)` : `Pagar ${total.toFixed(2)} €`;
    btnSkip.textContent = 'Pagar después';
    btnDonar.disabled = false;
  } else {
    pagoSection.style.display = 'none';
    donSection.style.display = '';
    document.querySelectorAll('.don-chip').forEach(c => c.classList.remove('selected'));
    document.getElementById('post-don-custom').style.display = 'none';
    document.getElementById('post-don-input').value = '';
    btnLabel.textContent = 'Donar';
    btnSkip.textContent = 'No gracias';
    btnDonar.disabled = true;
  }
  openModal('modal-post-inscripcion');
}

function selectDonChip(btn, amount) {
  document.querySelectorAll('.don-chip').forEach(c => c.classList.remove('selected'));
  btn.classList.add('selected');
  const customDiv = document.getElementById('post-don-custom');
  const donarBtn = document.getElementById('btn-post-donar');
  if (amount === 0) {
    customDiv.style.display = '';
    const val = parseFloat(document.getElementById('post-don-input').value);
    donarBtn.disabled = !(val > 0);
  } else {
    customDiv.style.display = 'none';
    donarBtn.disabled = false;
  }
}

const STRIPE_PK = '{{integrations.stripePublishableKey}}';
let _evStripe = null, _evCardEl = null, _evClientSecret = null, _evAmount = 0, _evNombre = '';

function getEvStripe() {
  if (!_evStripe && typeof Stripe !== 'undefined') _evStripe = Stripe(STRIPE_PK);
  return _evStripe;
}

function backPostDon() {
  document.getElementById('post-stripe-step').style.display = 'none';
  document.getElementById('post-don-section').style.display = '';
  document.getElementById('post-pago-section').style.display = '';
  document.getElementById('btn-post-back').style.display = 'none';
  document.getElementById('btn-post-skip').style.display = '';
  document.getElementById('post-stripe-error').textContent = '';
  if (_evCardEl) { _evCardEl.destroy(); _evCardEl = null; }
  _evClientSecret = null;
  const precio = evPrecio(evFind(postInscripcionEvId));
  if (precio > 0) document.getElementById('post-don-section').style.display = 'none';
  else document.getElementById('post-pago-section').style.display = 'none';
  document.getElementById('btn-post-donar-label').textContent = precio > 0 ? 'Pagar' : 'Donar';
  document.getElementById('btn-post-donar').disabled = precio > 0 ? false : !document.querySelector('.don-chip.selected');
}

async function pagarODonar() {
  const ev = evFind(postInscripcionEvId);
  const precio = evPrecio(ev);
  const sb = getSupabase();
  const user = getCurrentUser();
  const isStripeStep = document.getElementById('post-stripe-step').style.display !== 'none';

  if (!isStripeStep) {
    let amount, campana_nombre;
    if (precio > 0) {
      amount = precio * (1 + postInscripcionFamilia.length);
      campana_nombre = `Pago evento: ${ev?.titulo || ''}`;
    } else {
      const selectedChip = document.querySelector('.don-chip.selected');
      amount = selectedChip ? parseFloat(selectedChip.dataset.amount) : 0;
      if (amount === 0) amount = parseFloat(document.getElementById('post-don-input').value) || 0;
      if (!amount || amount <= 0) return;
      campana_nombre = `Donativo evento: ${ev?.titulo || ''}`;
    }
    _evAmount = amount;
    _evNombre = campana_nombre;

    const btn = document.getElementById('btn-post-donar');
    btn.disabled = true;
    document.getElementById('btn-post-donar-label').textContent = 'Preparando...';
    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(SUPABASE_URL + '/functions/v1/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ amount, campana_nombre }),
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) throw new Error(data.error || 'Error');
      _evClientSecret = data.clientSecret;

      document.getElementById('post-don-section').style.display = 'none';
      document.getElementById('post-pago-section').style.display = 'none';
      document.getElementById('post-stripe-step').style.display = '';
      document.getElementById('btn-post-back').style.display = '';
      document.getElementById('btn-post-skip').style.display = 'none';
      document.getElementById('btn-post-donar-label').textContent = `Pagar ${amount} €`;
      btn.disabled = false;

      const elements = getEvStripe().elements();
      _evCardEl = elements.create('card', {
        style: { base: { fontSize: '15px', color: '#1B2E5E', fontFamily: 'inherit', '::placeholder': { color: '#9CA3AF' } } },
      });
      _evCardEl.mount('#post-stripe-card');
      _evCardEl.on('change', e => {
        document.getElementById('post-stripe-error').textContent = e.error ? e.error.message : '';
      });
    } catch (err) {
      btn.disabled = false;
      document.getElementById('btn-post-donar-label').textContent = precio > 0 ? 'Pagar' : 'Donar';
      showToast(err.message || 'Error iniciando el pago', 'error');
    }
    return;
  }

  const btn = document.getElementById('btn-post-donar');
  btn.disabled = true;
  document.getElementById('btn-post-donar-label').textContent = 'Procesando...';
  const { error, paymentIntent } = await getEvStripe().confirmCardPayment(_evClientSecret, {
    payment_method: { card: _evCardEl },
  });
  if (error) {
    document.getElementById('post-stripe-error').textContent = error.message;
    btn.disabled = false;
    document.getElementById('btn-post-donar-label').textContent = `Pagar ${_evAmount} €`;
    return;
  }
  if (paymentIntent && paymentIntent.status === 'succeeded') {
    if (sb && user) {
      await sb.from('donaciones').insert({
        usuario_id: user.userId || null,
        usuario_nombre: user.name || 'Anónimo',
        campana_nombre: _evNombre,
        campana_id: null,
        cantidad: _evAmount,
        recurrente: false,
        dedicatoria: postInscripcionFamilia.length ? `Incluye: ${[user.name, ...postInscripcionFamilia].join(', ')}` : null,
      });
    }
    closeModal('modal-post-inscripcion');
    showToast(`¡Pago de ${_evAmount} € completado! Toda raba.`, 'success');
  }
}

async function cancelarInscripcion(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const sb = getSupabase();
  const session = typeof getValidSession === 'function' ? await getValidSession() : null;
  if (!sb || !session) {
    showToast('No se pudo confirmar tu sesión. Vuelve a intentarlo.', 'error');
    return;
  }
  const key = String(id);
  const ev = evFind(key);
  inscrito.delete(key);
  if (ev) ev.inscritos = Math.max(0, (ev.inscritos || 1) - 1);
  evRefresh();

  const { error } = await sb.from('inscripciones').delete().eq('usuario_id', session.user.id).eq('evento_id', key);
  if (error) {
    // No mostrar éxito si el backend denegó la baja: revertir estado local.
    inscrito.add(key);
    if (ev) ev.inscritos = (ev.inscritos || 0) + 1;
    evRefresh();
    showToast('Error al cancelar inscripción: ' + error.message, 'error');
    return;
  }
  _evGuardarInscritos();
  showToast(`Inscripción cancelada en "${ev?.titulo || 'el evento'}".`, 'warning');
}

function openEspera(id, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const ev = evFind(id);
  if (!ev || eventoPasado(ev)) { showToast('Este evento ya ha pasado.', 'warning'); evRefresh(); return; }
  pendingEv = String(ev.id);
  openModal('modal-espera');
}

async function confirmEspera() {
  const evId = pendingEv;
  const ev = evFind(evId);
  closeModal('modal-espera');
  pendingEv = null;
  // Se guarda de verdad: si se libera una plaza, el primero de la lista recibe un aviso.
  const sb = getSupabase();
  const session = typeof getValidSession === 'function' ? await getValidSession() : null;
  if (!sb || !session) { showToast('No se pudo confirmar tu sesión. Vuelve a intentarlo.', 'error'); return; }
  const { error } = await sb.from('lista_espera').insert({ evento_id: String(evId), usuario_id: session.user.id });
  if (error && error.code !== '23505') {   // 23505 = ya estaba en la lista
    showToast('No se pudo apuntarte a la lista de espera. Inténtalo de nuevo.', 'error');
    return;
  }
  if (typeof trackEvent === 'function') trackEvent('espera_ok', { evento: String(evId) });
  showToast(`Apuntado a la lista de espera de "${ev?.titulo || 'el evento'}". Te avisaremos si se libera una plaza.`, 'info');
}

/** Botón principal de un evento según su estado (lista y ficha). */
function evAccion(ev) {
  if (eventoPasado(ev)) return { tipo: 'pasado' };
  if (evEstaInscrito(ev)) return { tipo: 'inscrito' };
  if (evLleno(ev)) return { tipo: 'espera' };
  return { tipo: 'abierto' };
}

/* ─── Confeti (canvas propio, ~1,2 s, sin librerías) ─── */
function evConfeti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'ev-confeti';
  document.body.appendChild(c);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
  const ctx = c.getContext('2d');
  const colores = ['#C9A84C', '#1B2E5E', '#F5EDD6', '#2A4080', '#A8892E'];
  const piezas = Array.from({ length: 110 }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .3, y: H * .55,
    vx: (Math.random() - .5) * 26 * dpr, vy: (-Math.random() * 26 - 12) * dpr,
    w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
    r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4,
    col: colores[(Math.random() * colores.length) | 0]
  }));
  const t0 = performance.now();
  (function frame(t) {
    const p = (t - t0) / 1400;
    ctx.clearRect(0, 0, W, H);
    piezas.forEach(o => {
      o.vy += .9 * dpr; o.vx *= .985; o.x += o.vx; o.y += o.vy; o.r += o.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p * p);
      ctx.translate(o.x, o.y); ctx.rotate(o.r);
      ctx.fillStyle = o.col; ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h * Math.abs(Math.cos(o.r * 2)));
      ctx.restore();
    });
    if (p < 1) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

/* ─── Init común ─── */
_evInyectarModales();
loadHijosParaEventos();
