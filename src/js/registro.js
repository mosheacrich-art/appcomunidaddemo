/**
 * @file registro.js
 * @description Flujo de registro de nuevo miembro en 4 pasos.
 *
 * Pasos del formulario:
 *  1. Datos personales  — nombre, apellidos, email, teléfono, contraseña
 *  2. Documento         — tipo doc, nº, fecha nacimiento, nacionalidad, subida de foto
 *  3. Comunidad         — dirección, comunidad, práctica, familiar
 *  4. Confirmación      — checkboxes RGPD (ck1-ck4) + envío
 *
 * Estado del formulario:
 *  Todo el estado se guarda en el objeto REG (en memoria durante la sesión).
 *  En el paso final se envía a Supabase y se limpia REG.
 *
 * DEPENDENCIAS (en orden de carga):
 *  - auth.js     → register(), getSupabase(), login()
 *  - nav.js      → NO requerido (página pública antes de login)
 *
 * RGPD (Art. 9 — datos religiosos, categoría especial):
 *  - ck1: Consentimiento tratamiento datos personales
 *  - ck2: Consentimiento datos religiosos (categoría especial)
 *  - ck3: Comunicaciones de la comunidad
 *  - ck4: Normativa de la comunidad
 *  Todos los checkboxes son obligatorios para completar el registro.
 *
 * SEGURIDAD:
 *  - La contraseña mínima es 6 caracteres + mayúscula + número + símbolo.
 *    Pendiente: subir mínimo a 8 caracteres (NIST SP 800-63B).
 *  - El documento de identidad se sube a Supabase Storage (bucket community-media).
 *  - Los datos de registro NO se guardan en localStorage permanentemente —
 *    solo en el objeto REG en memoria.
 *
 * FLUJO POST-REGISTRO:
 *  Usuario creado en Supabase Auth → perfil en tabla profiles con status='pending'
 *  → Admin aprueba en panel → status='active' → usuario puede acceder a todo.
 */

// ─── Estado del formulario ───────────────────
const REG = {
  step: 1,
  data: {
    // Paso 1
    nombre: '', apellidos: '', email: '', telefono: '',
    telefonoPrefijo: '+34', password: '',
    // Paso 2
    docTipo: '', docNumero: '', fechaNac: '',
    nacionalidad: '', paisNac: '', docFile: null, docFileName: '', docConfirmado: false,
    // Paso 3
    pais: '', ciudad: '', cp: '', direccion: '',
    comunidad: '', practica: '', familiar: false, familiarNombre: '',
    comoConocio: '',
    // Paso 4
    ck1: false, ck2: false, ck3: false, ck4: false
  }
};


// ─── Validación en vivo (nombres, teléfono, documento) ───
const RG_IC = {
  ok:   '<svg fill="none" viewBox="0 0 24 24" stroke-width="2.6" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>',
  info: '<svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"/></svg>',
  err:  '<svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg>'
};

/** Mensaje bajo el campo: tipo '' | 'ok' | 'warn' | 'err' */
function rgLive(id, tipo, msg, flash) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'rg-live' + (tipo ? ' ' + tipo : '');
  el.innerHTML = msg ? (tipo === 'ok' ? RG_IC.ok : tipo === 'err' ? RG_IC.err : RG_IC.info) + '<span>' + msg + '</span>' : '';
  if (flash) { void el.offsetWidth; el.classList.add('flash'); }
}

/** Marca el grupo del campo como correcto (tick verde junto a la etiqueta) */
function rgOk(fieldId, ok) {
  const g = document.getElementById(fieldId)?.closest('.form-group');
  if (!g) return;
  if (!g.querySelector('.rg-tick')) {
    const lab = g.querySelector('.form-label');
    if (lab) lab.insertAdjacentHTML('beforeend', `<span class="rg-tick" aria-hidden="true">${RG_IC.ok}</span>`);
  }
  g.classList.toggle('is-ok', !!ok);
}

function rgShake(fieldId) {
  const g = document.getElementById(fieldId)?.closest('.form-group');
  if (!g) return;
  g.classList.remove('rg-shake'); void g.offsetWidth; g.classList.add('rg-shake');
}

// Nombres: solo letras (con acentos, ñ, ç…), espacios, guion y apóstrofo
const RG_NOMBRE_OK = /^[\p{L}][\p{L}\p{M}'’\- ]*[\p{L}\p{M}]$/u;
function rgLimpiarNombre(v) { return v.replace(/[^\p{L}\p{M}'’\- ]/gu, '').replace(/ {2,}/g, ' '); }

// Teléfono: solo dígitos. Para España, 9 cifras que empiezan por 6, 7, 8 o 9.
function rgValidarTelefono(prefijo, num) {
  if (!num) return { ok: true, vacio: true };
  if (prefijo === '+34') {
    if (num.length < 9) return { ok: false, msg: `${(9 - num.length) === 1 ? 'Falta' : 'Faltan'} ${9 - num.length} número${(9 - num.length) === 1 ? '' : 's'} (son 9).` };
    if (num.length > 9) return { ok: false, msg: 'Un teléfono español tiene 9 números.' };
    if (!/^[6789]/.test(num)) return { ok: false, msg: 'Un teléfono español empieza por 6, 7, 8 o 9.' };
    return { ok: true };
  }
  if (num.length < 6) return { ok: false, msg: 'Parece demasiado corto.' };
  if (num.length > 15) return { ok: false, msg: 'Parece demasiado largo.' };
  return { ok: true };
}

// Documentos de identidad
const RG_LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const RG_DOCS = {
  'DNI español':            { ph: '12345678Z', max: 9,  hint: '8 números y una letra' },
  'NIE':                    { ph: 'X1234567L', max: 9,  hint: 'X, Y o Z, 7 números y una letra' },
  'Pasaporte':              { ph: 'PAA123456', max: 9,  hint: 'Entre 6 y 9 letras o números' },
  'Cédula de identidad':    { ph: '12345678',  max: 12, hint: 'Entre 6 y 12 caracteres' },
  'Otro documento oficial': { ph: 'Número del documento', max: 20, hint: 'Entre 5 y 20 letras o números' }
};
function rgNormalizarDoc(v) { return v.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function rgValidarDoc(tipo, v) {
  if (!tipo) return { ok: false, msg: 'Elige primero el tipo de documento.' };
  if (!v) return { ok: false, vacio: true, msg: RG_DOCS[tipo]?.hint || '' };
  if (tipo === 'DNI español') {
    const num = v.match(/^\d*/)[0];
    if (/[A-Z]/.test(v.slice(0, Math.min(v.length, 8))) && num.length < 8) return { ok: false, msg: 'El DNI empieza por 8 números.' };
    if (num.length < 8) return { ok: false, msg: `${(8 - num.length) === 1 ? 'Falta' : 'Faltan'} ${8 - num.length} número${(8 - num.length) === 1 ? '' : 's'} antes de la letra.` };
    if (num.length > 8) return { ok: false, msg: 'El DNI tiene 8 números, no más.' };
    if (v.length === 8) return { ok: false, warn: true, msg: 'Falta la letra del final.' };
    if (!/^\d{8}[A-Z]$/.test(v)) return { ok: false, msg: 'Formato: 8 números y una letra (12345678Z).' };
    const letra = RG_LETRAS_DNI[parseInt(v.slice(0, 8), 10) % 23];
    if (v[8] !== letra) return { ok: false, msg: 'La letra no corresponde a ese número. Revísalo.' };
    return { ok: true, msg: 'DNI correcto.' };
  }
  if (tipo === 'NIE') {
    if (!/^[XYZ]/.test(v)) return { ok: false, msg: 'El NIE empieza por X, Y o Z.' };
    const num = v.slice(1).match(/^\d*/)[0];
    if (num.length < 7) return { ok: false, msg: `${(7 - num.length) === 1 ? 'Falta' : 'Faltan'} ${7 - num.length} número${(7 - num.length) === 1 ? '' : 's'} después de la ${v[0]}.` };
    if (num.length > 7) return { ok: false, msg: 'El NIE tiene 7 números entre las dos letras.' };
    if (v.length === 8) return { ok: false, warn: true, msg: 'Falta la letra del final.' };
    if (!/^[XYZ]\d{7}[A-Z]$/.test(v)) return { ok: false, msg: 'Formato: X1234567L.' };
    const n = parseInt('XYZ'.indexOf(v[0]) + v.slice(1, 8), 10);
    if (v[8] !== RG_LETRAS_DNI[n % 23]) return { ok: false, msg: 'La letra no corresponde a ese número. Revísalo.' };
    return { ok: true, msg: 'NIE correcto.' };
  }
  if (tipo === 'Pasaporte') {
    if (v.length < 6) return { ok: false, msg: `Faltan caracteres: un pasaporte tiene entre 6 y 9.` };
    if (v.length > 9) return { ok: false, msg: 'Demasiado largo: un pasaporte tiene entre 6 y 9 caracteres.' };
    if (!/\d/.test(v)) return { ok: false, msg: 'El número de pasaporte lleva números.' };
    return { ok: true, msg: 'Formato válido.' };
  }
  if (tipo === 'Cédula de identidad') {
    const digitos = (v.match(/\d/g) || []).length;
    if (v.length < 6 || digitos < 6) return { ok: false, msg: 'Parece incompleta: lleva al menos 6 números.' };
    if (v.length > 12) return { ok: false, msg: 'Demasiado larga (máximo 12 caracteres).' };
    return { ok: true, msg: 'Formato válido.' };
  }
  if (v.length < 5) return { ok: false, msg: 'Parece incompleto (mínimo 5 caracteres).' };
  return { ok: true, msg: 'Formato válido.' };
}

function rgPintarDocs() {
  const box = document.getElementById('rg-docs');
  const sel = document.getElementById('r2-doc-tipo');
  if (!box || !sel) return;
  const ICONOS = {
    'DNI español': '<path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z"/>',
    'NIE': '<path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z"/>',
    'Pasaporte': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"/>',
    'Cédula de identidad': '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"/>',
    'Otro documento oficial': '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>'
  };
  const SUB = { 'DNI español': 'España', 'NIE': 'Extranjeros en España', 'Pasaporte': 'Cualquier país', 'Cédula de identidad': 'Latinoamérica y otros', 'Otro documento oficial': 'Otro oficial' };
  const NOMBRE = { 'DNI español': 'DNI', 'NIE': 'NIE', 'Pasaporte': 'Pasaporte', 'Cédula de identidad': 'Cédula', 'Otro documento oficial': 'Otro' };
  box.innerHTML = Object.keys(RG_DOCS).map((k, i) => `
    <button type="button" class="rg-doc${sel.value === k ? ' is-on' : ''}" role="radio" aria-checked="${sel.value === k}" data-doc="${k}" style="--i:${i}">
      <i><svg fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" aria-hidden="true">${ICONOS[k]}</svg></i>
      <span>${NOMBRE[k]}<small>${SUB[k]}</small></span>
    </button>`).join('');
  box.querySelectorAll('.rg-doc').forEach(b => b.addEventListener('click', () => {
    sel.value = b.dataset.doc;
    box.querySelectorAll('.rg-doc').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', x === b); });
    regClearFieldError('r2-doc-tipo', 'r2-doc-tipo-err');
    rgOk('r2-doc-tipo', true);
    const inp = document.getElementById('r2-doc-num');
    const cfg = RG_DOCS[b.dataset.doc];
    inp.placeholder = 'Ej.: ' + cfg.ph;
    inp.maxLength = cfg.max;
    inp.value = rgNormalizarDoc(inp.value).slice(0, cfg.max);
    rgDocInput();
    inp.focus({ preventScroll: true });
  }));
}

function rgDocInput() {
  const inp = document.getElementById('r2-doc-num');
  const tipo = document.getElementById('r2-doc-tipo')?.value || '';
  const limpio = rgNormalizarDoc(inp.value);
  if (limpio !== inp.value) inp.value = limpio;
  const r = rgValidarDoc(tipo, limpio);
  if (r.ok) rgLive('r2-doc-live', 'ok', r.msg);
  else if (r.vacio) rgLive('r2-doc-live', '', r.msg);
  else rgLive('r2-doc-live', r.warn ? 'warn' : (limpio.length >= (RG_DOCS[tipo]?.max || 9) ? 'err' : 'warn'), r.msg);
  rgOk('r2-doc-num', r.ok);
  if (r.ok) regClearFieldError('r2-doc-num', 'r2-doc-num-err');
}

function rgInitValidacionEnVivo() {
  // Nombre y apellidos
  [['r1-nombre', 'r1-nombre-live'], ['r1-apellidos', 'r1-apellidos-live']].forEach(([id, live]) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('input', () => {
      const antes = inp.value;
      const limpio = rgLimpiarNombre(antes);
      if (limpio !== antes) {
        const pos = inp.selectionStart - (antes.length - limpio.length);
        inp.value = limpio;
        try { inp.setSelectionRange(pos, pos); } catch (e) {}
        rgLive(live, 'warn', 'Solo letras: escríbelo como aparece en tu documento (sin números).', true);
      } else rgLive(live, '', '');
      rgOk(id, RG_NOMBRE_OK.test(inp.value.trim()) && inp.value.trim().length >= 2);
      if (inp.value.trim().length >= 2) regClearFieldError(id, id + '-err');
    });
  });
  // Email
  const em = document.getElementById('r1-email');
  if (em) em.addEventListener('input', () => rgOk('r1-email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim())));
  // Teléfono
  const tel = document.getElementById('r1-telefono');
  const pre = document.getElementById('r1-prefijo');
  const telCheck = (avisar) => {
    const antes = tel.value;
    let v = antes.trim();
    const pd = (pre?.value || '').replace('+', '');
    if (v.startsWith('+') && pd && v.replace(/\D/g, '').startsWith(pd)) v = v.replace(/\D/g, '').slice(pd.length);
    else if (pd && v.startsWith('00' + pd)) v = v.slice(2 + pd.length);
    let limpio = v.replace(/\D/g, '');
    // El prefijo tecleado a mano (34…, 0034…) sobra: ya está elegido a la izquierda
    if (pd && limpio.startsWith('00' + pd)) limpio = limpio.slice(2 + pd.length);
    else if (pd === '34' && limpio.length > 9 && limpio.startsWith('34')) limpio = limpio.slice(2);
    else if (pd && pd !== '34' && limpio.startsWith(pd) && limpio.length >= pd.length + 8) limpio = limpio.slice(pd.length);
    if (limpio !== antes) tel.value = limpio;
    const r = rgValidarTelefono(pre?.value || '+34', limpio);
    if (avisar && /[^\d\s+]/.test(antes)) rgLive('r1-telefono-live', 'warn', 'Solo números: el prefijo ya está elegido a la izquierda.', true);
    else if (!r.ok && limpio.length) rgLive('r1-telefono-live', 'warn', r.msg);
    else if (r.ok && !r.vacio) rgLive('r1-telefono-live', 'ok', 'Teléfono correcto.');
    else rgLive('r1-telefono-live', '', '');
    rgOk('r1-telefono', r.ok && !r.vacio);
    if (r.ok) regClearFieldError('r1-telefono', 'r1-telefono-err');
  };
  if (tel) { tel.addEventListener('input', () => telCheck(true)); pre?.addEventListener('change', () => telCheck(false)); }
  // Contraseñas
  const pw = document.getElementById('r1-password'), cf = document.getElementById('r1-confirm');
  const pwCheck = () => {
    const v = pw.value;
    rgOk('r1-password', v.length >= 8 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v));
    rgOk('r1-confirm', !!cf.value && cf.value === v);
  };
  pw?.addEventListener('input', pwCheck); cf?.addEventListener('input', pwCheck);
  // Documento
  rgPintarDocs();
  document.getElementById('r2-doc-num')?.addEventListener('input', rgDocInput);
  // Selects y textos del resto de pasos: tick al completarlos
  ['r2-nacionalidad', 'r2-pais-nac', 'r3-pais'].forEach(id => document.getElementById(id)?.addEventListener('change', e => rgOk(id, !!e.target.value)));
  const fechaCheck = () => rgOk('r2-dia', ['r2-dia', 'r2-mes', 'r2-anio'].every(i => document.getElementById(i)?.value));
  ['r2-dia', 'r2-mes', 'r2-anio'].forEach(id => document.getElementById(id)?.addEventListener('change', fechaCheck));
  [['r3-ciudad', 2], ['r3-direccion', 5]].forEach(([id, n]) => document.getElementById(id)?.addEventListener('input', e => rgOk(id, e.target.value.trim().length >= n)));
  document.getElementById('r3-cp')?.addEventListener('input', e => rgOk('r3-cp', e.target.value.trim().length >= 4));
}

// ─── Navegación entre pasos ──────────────────
/**
 * Avanza al siguiente paso si la validación del paso actual es correcta.
 * Si hay errores, los muestra en UI y no avanza.
 */
function regNextStep() {
  if (!regValidateCurrentStep()) return;
  if (REG.step < 4) {
    REG.step++;
    REG._dir = 'fwd';
    regRenderStep();
  }
}

/**
 * Retrocede al paso anterior sin validar. No se pierden los datos.
 */
function regPrevStep() {
  if (REG.step > 1) {
    REG.step--;
    REG._dir = 'back';
    regRenderStep();
  }
}

/**
 * Salta directamente a un paso anterior (no permite saltar hacia adelante).
 * @param {number} n - Número de paso destino (1-4)
 */
function regGoToStep(n) {
  // Only allow going back, not skipping forward
  if (n < REG.step) {
    REG.step = n;
    REG._dir = 'back';
    regRenderStep();
  }
}

/**
 * Muestra el panel del paso actual y oculta los demás.
 * Actualiza la barra de progreso y hace scroll al inicio del formulario.
 */
function regRenderStep() {
  // Embudo de registro (analytics): cada paso alcanzado, una vez por visita
  REG._pasosVistos = REG._pasosVistos || new Set();
  if (!REG._pasosVistos.has(REG.step) && typeof trackEvent === 'function') {
    REG._pasosVistos.add(REG.step);
    trackEvent('registro_paso', { paso: String(REG.step) });
  }
  // Show/hide step panels
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById(`reg-step-${i}`);
    if (!panel) continue;
    panel.style.display = (i === REG.step) ? '' : 'none';
    panel.classList.remove('rg-enter-fwd', 'rg-enter-back');
    if (i === REG.step && REG._dir) { void panel.offsetWidth; panel.classList.add('rg-enter-' + REG._dir); }
  }
  // Update progress bar
  regUpdateProgress();
  // Scroll to top of form
  const wrapper = document.querySelector('.auth-form-wrapper');
  if (wrapper) wrapper.scrollTop = 0;
}

/**
 * Actualiza visualmente los círculos de progreso (completado/activo/pendiente)
 * y la barra de progreso dorada según el paso actual (REG.step).
 */
function regUpdateProgress() {
  for (let i = 1; i <= 4; i++) {
    const circle = document.getElementById(`step-circle-${i}`);
    if (!circle) continue;
    const parent = circle.closest('.step');
    if (i < REG.step) {
      parent.className = 'step completed';
      circle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>`;
    } else if (i === REG.step) {
      parent.className = 'step active';
      circle.textContent = i;
    } else {
      parent.className = 'step';
      circle.textContent = i;
    }
  }
  // Avanzar la franja dorada: (paso actual - 1) / 3 * 100%
  const fill = document.getElementById('steps-track-fill');
  if (fill) {
    fill.style.width = ((REG.step - 1) / 3 * 100) + '%';
  }
}

// ─── Validación por paso ─────────────────────
function regValidateCurrentStep() {
  switch (REG.step) {
    case 1: return regValidateStep1();
    case 2: return regValidateStep2();
    case 3: return regValidateStep3();
    case 4: return regValidateStep4();
  }
  return true;
}

function regShowFieldError(fieldId, errorId, msg) {
  const field = document.getElementById(fieldId);
  const err = document.getElementById(errorId);
  if (field) field.classList.add('error');
  if (err) { err.textContent = msg; err.style.display = ''; }
  rgShake(fieldId);
}

function regClearFieldError(fieldId, errorId) {
  const field = document.getElementById(fieldId);
  const err = document.getElementById(errorId);
  if (field) field.classList.remove('error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
}

function regValidateStep1() {
  let ok = true;
  // Save values
  REG.data.nombre = document.getElementById('r1-nombre')?.value.trim() || '';
  REG.data.apellidos = document.getElementById('r1-apellidos')?.value.trim() || '';
  REG.data.email = document.getElementById('r1-email')?.value.trim().toLowerCase() || '';
  REG.data.telefonoPrefijo = document.getElementById('r1-prefijo')?.value || '+34';
  REG.data.telefono = (document.getElementById('r1-telefono')?.value || '').replace(/\D/g, '');
  if (REG.data.telefonoPrefijo === '+34' && REG.data.telefono.length === 11 && REG.data.telefono.startsWith('34')) REG.data.telefono = REG.data.telefono.slice(2);
  REG.data.password = document.getElementById('r1-password')?.value || '';
  const confirm = document.getElementById('r1-confirm')?.value || '';

  // Nombre: mínimo 2 palabras
  if (!REG.data.nombre || REG.data.nombre.length < 2) {
    regShowFieldError('r1-nombre', 'r1-nombre-err', t('err_nombre_completo'));
    ok = false;
  } else if (!RG_NOMBRE_OK.test(REG.data.nombre)) {
    regShowFieldError('r1-nombre', 'r1-nombre-err', 'El nombre solo puede llevar letras.');
    ok = false;
  } else { regClearFieldError('r1-nombre', 'r1-nombre-err'); }

  if (!REG.data.apellidos || REG.data.apellidos.length < 2) {
    regShowFieldError('r1-apellidos', 'r1-apellidos-err', t('err_apellidos'));
    ok = false;
  } else if (!RG_NOMBRE_OK.test(REG.data.apellidos)) {
    regShowFieldError('r1-apellidos', 'r1-apellidos-err', 'Los apellidos solo pueden llevar letras.');
    ok = false;
  } else { regClearFieldError('r1-apellidos', 'r1-apellidos-err'); }

  if (!REG.data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(REG.data.email)) {
    regShowFieldError('r1-email', 'r1-email-err', t('err_email_valido'));
    ok = false;
  } else { regClearFieldError('r1-email', 'r1-email-err'); }

  const telR = rgValidarTelefono(REG.data.telefonoPrefijo, REG.data.telefono);
  if (!telR.ok) {
    regShowFieldError('r1-telefono', 'r1-telefono-err', telR.msg || t('err_telefono_valido'));
    ok = false;
  } else { regClearFieldError('r1-telefono', 'r1-telefono-err'); }

  const pw = REG.data.password;
  const pwStrong = pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
  if (!pw || pw.length < 8) {
    regShowFieldError('r1-password', 'r1-password-err', t('err_pw_min'));
    ok = false;
  } else if (!pwStrong) {
    regShowFieldError('r1-password', 'r1-password-err', t('err_pw_reglas'));
    ok = false;
  } else { regClearFieldError('r1-password', 'r1-password-err'); }

  if (pw !== confirm) {
    regShowFieldError('r1-confirm', 'r1-confirm-err', t('err_pw_no_coincide'));
    ok = false;
  } else if (confirm) { regClearFieldError('r1-confirm', 'r1-confirm-err'); }

  return ok;
}

function regValidateStep2() {
  let ok = true;
  REG.data.docTipo = document.getElementById('r2-doc-tipo')?.value || '';
  REG.data.docNumero = rgNormalizarDoc(document.getElementById('r2-doc-num')?.value || '');
  const dia = document.getElementById('r2-dia')?.value || '';
  const mes = document.getElementById('r2-mes')?.value || '';
  const anio = document.getElementById('r2-anio')?.value || '';
  REG.data.fechaNac = `${anio}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
  REG.data.nacionalidad = document.getElementById('r2-nacionalidad')?.value || '';
  REG.data.paisNac = document.getElementById('r2-pais-nac')?.value || '';

  if (!REG.data.docTipo) {
    regShowFieldError('r2-doc-tipo', 'r2-doc-tipo-err', t('err_doctipo'));
    ok = false;
  } else { regClearFieldError('r2-doc-tipo', 'r2-doc-tipo-err'); }

  const docR = rgValidarDoc(REG.data.docTipo, REG.data.docNumero);
  if (!docR.ok) {
    regShowFieldError('r2-doc-num', 'r2-doc-num-err', REG.data.docNumero ? docR.msg : t('err_docnum'));
    ok = false;
  } else { regClearFieldError('r2-doc-num', 'r2-doc-num-err'); }

  if (!dia || !mes || !anio) {
    const err = document.getElementById('r2-fecha-err');
    if (err) { err.textContent = t('err_fecha_completa'); err.style.display = ''; }
    ok = false;
  } else {
    const birthDate = new Date(parseInt(anio), parseInt(mes)-1, parseInt(dia));
    const age = Math.floor((Date.now() - birthDate) / (365.25*24*60*60*1000));
    const err = document.getElementById('r2-fecha-err');
    if (age < 13) {
      if (err) { err.textContent = t('err_edad_min'); err.style.display = ''; }
      ok = false;
    } else if (err) { err.textContent = ''; err.style.display = 'none'; }
  }

  if (!REG.data.nacionalidad) {
    regShowFieldError('r2-nacionalidad', 'r2-nac-err', t('err_nacionalidad'));
    ok = false;
  } else { regClearFieldError('r2-nacionalidad', 'r2-nac-err'); }

  if (!REG.data.paisNac) {
    regShowFieldError('r2-pais-nac', 'r2-paisnac-err', t('err_paisnac'));
    ok = false;
  } else { regClearFieldError('r2-pais-nac', 'r2-paisnac-err'); }

  // La subida del documento se exige solo si el bloque está visible en el formulario
  // (se puede desactivar temporalmente con display:none en #r2-upload-block sin tocar esta lógica).
  const uploadBlock = document.getElementById('r2-upload-block');
  const uploadRequired = uploadBlock && uploadBlock.style.display !== 'none';
  if (uploadRequired && !REG.data.docFile) {
    const err = document.getElementById('r2-upload-err');
    if (err) { err.textContent = t('err_upload_doc'); err.style.display = ''; }
    ok = false;
  } else {
    const err = document.getElementById('r2-upload-err');
    if (err) { err.textContent = ''; err.style.display = 'none'; }
  }

  const ck = document.getElementById('r2-confirm-ck');
  if (!ck?.checked) {
    const err = document.getElementById('r2-ck-err');
    if (err) { err.textContent = t('err_ck_verdad'); err.style.display = ''; }
    ok = false;
  } else {
    const err = document.getElementById('r2-ck-err');
    if (err) { err.textContent = ''; err.style.display = 'none'; }
  }

  return ok;
}

function regValidateStep3() {
  let ok = true;
  REG.data.pais = document.getElementById('r3-pais')?.value || '';
  REG.data.ciudad = document.getElementById('r3-ciudad')?.value.trim() || '';
  REG.data.cp = document.getElementById('r3-cp')?.value.trim() || '';
  REG.data.direccion = document.getElementById('r3-direccion')?.value.trim() || '';
  REG.data.familiar = false;
  REG.data.familiarNombre = '';

  if (!REG.data.pais) {
    regShowFieldError('r3-pais', 'r3-pais-err', t('err_paisres'));
    ok = false;
  } else { regClearFieldError('r3-pais', 'r3-pais-err'); }

  if (!REG.data.ciudad || REG.data.ciudad.length < 2) {
    regShowFieldError('r3-ciudad', 'r3-ciudad-err', t('err_ciudad'));
    ok = false;
  } else { regClearFieldError('r3-ciudad', 'r3-ciudad-err'); }

  if (!REG.data.cp || REG.data.cp.length < 4) {
    regShowFieldError('r3-cp', 'r3-cp-err', t('err_cp_valido'));
    ok = false;
  } else { regClearFieldError('r3-cp', 'r3-cp-err'); }

  if (!REG.data.direccion || REG.data.direccion.length < 5) {
    regShowFieldError('r3-direccion', 'r3-dir-err', t('err_direccion'));
    ok = false;
  } else { regClearFieldError('r3-direccion', 'r3-dir-err'); }


  return ok;
}

function regValidateStep4() {
  REG.data.ck1 = document.getElementById('r4-ck1')?.checked || false;
  REG.data.ck2 = document.getElementById('r4-ck2')?.checked || false;
  REG.data.ck3 = document.getElementById('r4-ck3')?.checked || false;
  REG.data.ck4 = document.getElementById('r4-ck4')?.checked || false;
  if (!REG.data.ck1 || !REG.data.ck2 || !REG.data.ck3 || !REG.data.ck4) {
    const err = document.getElementById('r4-ck-err');
    if (err) { err.textContent = t('err_ck_todos'); err.style.display = ''; }
    return false;
  }
  const err = document.getElementById('r4-ck-err');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  return true;
}

// ─── Resumen paso 4 ──────────────────────────
function regRenderSummary() {
  const d = REG.data;
  const birthDate = d.fechaNac ? new Date(d.fechaNac) : null;
  const age = birthDate ? Math.floor((Date.now() - birthDate) / (365.25*24*60*60*1000)) : '—';
  const docMask = d.docNumero ? d.docNumero.slice(0,-3).replace(/[A-Za-z0-9]/g,'*') + d.docNumero.slice(-3) : '—';

  const el = document.getElementById('r4-summary');
  if (!el) return;
  el.innerHTML = `
    <div class="summary-section">
      <div class="summary-title">${t('sum_datos_personales')}</div>
      <div class="summary-row"><span>${t('sum_nombre')}</span><strong>${d.nombre} ${d.apellidos}</strong></div>
      <div class="summary-row"><span>${t('sum_email')}</span><strong>${d.email}</strong></div>
      ${d.telefono ? `<div class="summary-row"><span>${t('sum_telefono')}</span><strong>${d.telefonoPrefijo} ${d.telefono}</strong></div>` : ''}
      <div class="summary-row"><span>${t('sum_edad')}</span><strong>${age} ${t('sum_anios')}</strong></div>
    </div>
    <div class="summary-section">
      <div class="summary-title">${t('sum_documento')}</div>
      <div class="summary-row"><span>${t('sum_tipo')}</span><strong>${d.docTipo || '—'}</strong></div>
      <div class="summary-row"><span>${t('sum_numero')}</span><strong>${docMask}</strong></div>
      ${d.docFileName ? `<div class="summary-row"><span>${t('sum_archivo')}</span><strong style="display:flex;align-items:center;gap:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
        ${d.docFileName}
      </strong></div>` : ''}
    </div>
    <div class="summary-section">
      <div class="summary-title">${t('sum_residencia')}</div>
      <div class="summary-row"><span>${t('sum_pais')}</span><strong>${d.pais || '—'}</strong></div>
      <div class="summary-row"><span>${t('sum_ciudad')}</span><strong>${d.ciudad || '—'}</strong></div>
      <div class="summary-row"><span>${t('sum_cp')}</span><strong>${d.cp || '—'}</strong></div>
      <div class="summary-row"><span>${t('sum_comunidad')}</span><strong>${d.comunidad || '—'}</strong></div>
    </div>
  `;
}

// ─── Envío de solicitud ───────────────────────
async function regSubmit() {
  if (!regValidateStep4()) return;

  const btn = document.getElementById('r4-submit-btn');
  const label = document.getElementById('r4-submit-label');
  btn.disabled = true;
  label.innerHTML = `<span class="reg-spinner"></span> ${t('reg_enviando')}`;

  // ── Registrar en Supabase ──
  const fullName = (REG.data.nombre + ' ' + REG.data.apellidos).trim();
  if (typeof register === 'function') {
    const result = await register(REG.data.email, REG.data.password, fullName);
    if (!result.ok) {
      if (typeof trackEvent === 'function') trackEvent('registro_error', { msg: String(result.error || '').slice(0, 120) });
      btn.disabled = false;
      label.innerHTML = 'Enviar solicitud';
      const errEl = document.getElementById('r4-submit-err');
      if (errEl) { errEl.textContent = result.error || t('err_registro_generico'); errEl.style.display = 'block'; }
      return;
    }
    if (typeof trackEvent === 'function') trackEvent('registro_enviado');
    // ── Guardar campos extra en profiles ──
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;
    if (sb && result.userId) {
      await new Promise(r => setTimeout(r, 2000));

      // ── Subir foto del documento a Storage ──
      // Si el email requiere confirmación, signUp() todavía no da sesión y el
      // Storage (RLS: auth.uid() IS NOT NULL) rechaza la subida. En ese caso
      // guardamos el documento localmente y se sube en el primer login
      // confirmado (ver completePendingDocUpload en auth.js).
      let doc_url = null;
      let uploadOk = false;
      const hasSession = !!result.data?.session;
      if (REG.data.docFile && hasSession) {
        try {
          const ext = REG.data.docFileName.split('.').pop();
          const fileBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(REG.data.docFile);
          });
          // Subida vía Edge Function: cifra el documento antes de guardarlo
          // (ver supabase/functions/upload-document) en vez de subirlo en
          // claro directamente desde el cliente.
          const token = result.data.session.access_token;
          const res = await fetch(SUPABASE_URL + '/functions/v1/upload-document', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: result.userId, fileBase64, fileExt: ext }),
          });
          const upData = await res.json();
          if (res.ok && upData.path) {
            doc_url = upData.path; // Guardar solo el path — bucket privado, cifrado, ver via admin
            uploadOk = true;
          } else {
            console.error('Error subiendo foto (cifrado):', upData.error);
          }
        } catch (e) {
          console.error('Error subiendo foto (cifrado):', e.message);
        }
      }
      if (REG.data.docFile && !uploadOk) {
        // Sin sesión (email sin confirmar) o fallo de red: guardar localmente
        // y reintentar en el primer login (ver completePendingDocUpload en auth.js).
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(REG.data.docFile);
          });
          localStorage.setItem(`kehila_pending_doc_${result.userId}`, JSON.stringify({
            fileName: REG.data.docFileName,
            contentType: REG.data.docFile.type,
            dataUrl
          }));
        } catch (e) {
          console.error('Error guardando documento pendiente:', e);
        }
      }

      const initials = fullName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const { error: upsertErr } = await sb.from('profiles').upsert({
        id:              result.userId,
        name:            fullName,
        email:           REG.data.email,
        initials:        initials,
        role:            'miembro',
        status:          'pending',
        comunidad:       '{{name}}',
        telefono:        REG.data.telefono ? (REG.data.telefonoPrefijo || '+34') + ' ' + REG.data.telefono : null,
        doc_tipo:        REG.data.docTipo        || null,
        doc_numero:      REG.data.docNumero      || null,
        fecha_nac:       REG.data.fechaNac       || null,
        nacionalidad:    REG.data.nacionalidad   || null,
        pais_nac:        REG.data.paisNac        || null,
        doc_filename:    REG.data.docFileName    || null,
        doc_url:         doc_url,
        pais:            REG.data.pais           || null,
        ciudad:          REG.data.ciudad         || null,
        cp:              REG.data.cp             || null,
        direccion:       REG.data.direccion      || null,
        practica:        REG.data.practica       || null,
        familiar:        REG.data.familiar       || false,
        familiar_nombre: REG.data.familiarNombre || null,
        como_conocio:    REG.data.comoConocio    || null
      }, { onConflict: 'id', ignoreDuplicates: false });
      if (upsertErr) console.error('Error guardando perfil:', upsertErr.message);

      // Send welcome email (fire and forget — don't block the success screen)
      sb.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          fetch(SUPABASE_URL + '/functions/v1/send-registration-email', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }
          }).catch(() => {});
        }
      }).catch(() => {});

      // Pedir permiso de notificaciones ya en el registro (fire and forget):
      // así, si el usuario no vuelve a abrir la app hasta que le aprueben,
      // el push de aprobación igual le llega. Solo tiene sentido si hay
      // sesión real (signUp sin confirmación de email pendiente).
      if (hasSession && typeof initPush === 'function') {
        initPush(result.userId).catch(() => {});
      }
    }
  }

  // Generar número de solicitud
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  const solicitudNum = `#KEH-${ym}-${rand}`;

  // Guardar en localStorage
  const solicitudData = {
    ...REG.data,
    docFile: null, // No serializar el File object
    solicitudNum,
    status: 'PENDING',
    timestamp: now.toISOString(),
    riesgo: 'amarillo' // Por defecto: revisar documento
  };
  delete solicitudData.password; // No guardar contraseña en claro
  // No duplicar en claro en el dispositivo los datos de verificación de
  // identidad ni la dirección postal: ya quedan guardados de forma protegida
  // en Supabase (documento cifrado + RLS sobre profiles). Ver perfil.html,
  // que ahora lee estos campos directamente de Supabase en vez de este cache.
  delete solicitudData.docTipo;
  delete solicitudData.docNumero;
  delete solicitudData.fechaNac;
  delete solicitudData.nacionalidad;
  delete solicitudData.paisNac;
  delete solicitudData.pais;
  delete solicitudData.ciudad;
  delete solicitudData.cp;
  delete solicitudData.direccion;

  const pending = JSON.parse(localStorage.getItem('kehila_pending') || '[]');
  pending.push(solicitudData);
  localStorage.setItem('kehila_pending', JSON.stringify(pending));

  // Mostrar confirmación
  regShowConfirmacion(solicitudNum);
}

function regShowConfirmacion(num) {
  // Ocultar todos los pasos
  for (let i = 1; i <= 4; i++) {
    const p = document.getElementById(`reg-step-${i}`);
    if (p) p.style.display = 'none';
  }
  const bar = document.getElementById('reg-progress-bar');
  if (bar) bar.style.display = 'none';

  const conf = document.getElementById('reg-confirmacion');
  if (conf) {
    conf.style.display = '';
    document.getElementById('conf-num').textContent = num;
    document.getElementById('conf-email').textContent = REG.data.email;
    const seal = conf.querySelector('.rg-seal');
    if (seal) { seal.classList.remove('play'); void seal.offsetWidth; seal.classList.add('play'); }
  }
}

// ─── Upload de documento ─────────────────────
function regInitUpload() {
  const zone = document.getElementById('r2-upload-zone');
  const input = document.getElementById('r2-file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) regHandleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) regHandleFile(input.files[0]);
  });
}

function regHandleFile(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const err = document.getElementById('r2-upload-err');

  if (file.size > maxSize) {
    if (err) { err.textContent = t('err_file_5mb'); err.style.display = ''; }
    return;
  }
  const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
  if (!allowed.includes(file.type)) {
    if (err) { err.textContent = t('err_file_formato'); err.style.display = ''; }
    return;
  }
  if (err) { err.textContent = ''; err.style.display = 'none'; }

  REG.data.docFile = file;
  REG.data.docFileName = file.name;

  const zone = document.getElementById('r2-upload-zone');
  zone.classList.add('has-file');

  const sizeMB = (file.size / 1024 / 1024).toFixed(2);

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      zone.innerHTML = `
        <img src="${e.target.result}" style="max-height:120px;max-width:100%;border-radius:6px;margin-bottom:8px;" alt="Documento">
        <div style="font-size:13px;font-weight:500;color:var(--color-text);">${file.name}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:8px;">${sizeMB} MB</div>
        <button type="button" onclick="regRemoveFile()" style="font-size:12px;color:var(--color-danger);background:none;border:none;cursor:pointer;text-decoration:underline;">Eliminar y cambiar</button>
      `;
    };
    reader.readAsDataURL(file);
  } else {
    zone.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1B2E5E" stroke-width="1.5" style="margin-bottom:8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg>
      <div style="font-size:13px;font-weight:500;color:var(--color-text);">${file.name}</div>
      <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:8px;">${sizeMB} MB · PDF</div>
      <button type="button" onclick="regRemoveFile()" style="font-size:12px;color:var(--color-danger);background:none;border:none;cursor:pointer;text-decoration:underline;">Eliminar y cambiar</button>
    `;
  }
}

function regRemoveFile() {
  REG.data.docFile = null;
  REG.data.docFileName = '';
  const zone = document.getElementById('r2-upload-zone');
  zone.classList.remove('has-file');
  zone.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--color-text-light);margin-bottom:8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/></svg>
    <div class="upload-title">Sube tu documento de identidad</div>
    <div class="upload-subtitle">DNI · NIE · Pasaporte</div>
    <div style="font-size:12px;color:var(--color-text-light);margin-top:4px;">Arrastra el archivo aquí o haz clic para seleccionar</div>
    <div class="upload-formats" style="margin-top:6px;">JPG, PNG o PDF · Máx. 5MB</div>
    <input type="file" id="r2-file-input" accept=".jpg,.jpeg,.png,.pdf" style="display:none;">
  `;
  const newInput = document.getElementById('r2-file-input');
  if (newInput) newInput.addEventListener('change', () => { if (newInput.files[0]) regHandleFile(newInput.files[0]); });
}

// ─── Indicador de fortaleza de contraseña ────
function regInitPasswordStrength() {
  const input = document.getElementById('r1-password');
  const confirm = document.getElementById('r1-confirm');
  if (!input) return;

  input.addEventListener('input', function () {
    const pw = this.value;
    const container = document.getElementById('r1-strength-bar');
    const text = document.getElementById('r1-strength-text');
    if (!container || !text) return;

    if (!pw) { container.parentElement.style.display = 'none'; return; }
    container.parentElement.style.display = '';

    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    const levels = ['', 'Débil', 'Aceptable', 'Buena', 'Excelente'];
    const colors = ['', '#ef4444', '#f97316', '#d97706', '#16a34a'];

    container.className = `password-strength-bar strength-${score}`;
    text.textContent = levels[score] || '';
    text.style.color = colors[score] || '';
    container.innerHTML = `
      <div class="strength-segment"></div>
      <div class="strength-segment"></div>
      <div class="strength-segment"></div>
      <div class="strength-segment"></div>
    `;
  });

  if (confirm) {
    confirm.addEventListener('input', function () {
      const pw = document.getElementById('r1-password')?.value || '';
      const icon = document.getElementById('r1-confirm-check');
      if (icon) icon.style.display = (this.value && this.value === pw) ? '' : 'none';
    });
  }
}

// ─── Toggle familiar ─────────────────────────
function regToggleFamiliar() {
  const toggle = document.getElementById('r3-familiar-toggle');
  const field = document.getElementById('r3-familiar-field');
  if (field) field.style.display = toggle?.checked ? '' : 'none';
}

// ─── Modales de términos ─────────────────────
function openTermsModal(type) {
  const modal = document.getElementById('terms-modal');
  const title = document.getElementById('terms-modal-title');
  const body = document.getElementById('terms-modal-body');
  if (!modal) return;

  if (type === 'terminos') {
    title.textContent = 'Términos de Uso y Normas de Convivencia';
    body.innerHTML = `
      <p><strong>Artículo 1 — Objeto y ámbito de aplicación</strong><br>
      Los presentes Términos de Uso regulan el acceso y utilización de la plataforma {{name}}, destinada exclusivamente a miembros de comunidades judías en España y sus familias.</p>
      <p><strong>Artículo 2 — Requisitos de membresía</strong><br>
      El acceso requiere ser judío/a o familiar directo de un miembro. La solicitud es revisada manualmente por la administración de cada comunidad.</p>
      <p><strong>Artículo 3 — Normas de conducta</strong><br>
      Los miembros se comprometen a mantener un comportamiento respetuoso, acorde con los valores de la comunidad judía y las normas de convivencia establecidas por cada kehilá.</p>
      <p><strong>Artículo 4 — Uso aceptable de la plataforma</strong><br>
      Queda prohibido el uso de la plataforma para actividades contrarias a la ley, la difusión de contenido ofensivo o antisemita, y la suplantación de identidad.</p>
      <p><strong>Artículo 5 — Confidencialidad</strong><br>
      La información de los miembros es estrictamente confidencial y no será compartida fuera del ámbito de la comunidad.</p>
      <p><strong>Artículo 6 — Propiedad intelectual</strong><br>
      Todo el contenido de la plataforma es propiedad de {{name}} o de sus respectivos autores.</p>
      <p><strong>Artículo 7 — Causas de suspensión</strong><br>
      El incumplimiento de estos términos puede resultar en la suspensión temporal o permanente del acceso.</p>
      <p><strong>Artículo 8 — Legislación aplicable</strong><br>
      Estos términos se rigen por la legislación española y el Reglamento General de Protección de Datos (RGPD) de la Unión Europea.</p>
    `;
  } else {
    title.textContent = 'Política de Privacidad';
    body.innerHTML = `
      <p><strong>Responsable del tratamiento:</strong> {{name}} · {{contact.privacyEmail}}</p>
      <p><strong>Finalidad:</strong> Gestión de membresía comunitaria, comunicación de eventos y actividades de la comunidad judía.</p>
      <p><strong>Base legal:</strong> Consentimiento explícito del interesado (Art. 6.1.a RGPD).</p>
      <p><strong>Datos recogidos:</strong> Nombre, apellidos, email, teléfono, documento de identidad, fecha de nacimiento, nacionalidad, domicilio. Estos datos son necesarios para verificar la identidad y gestionar el acceso.</p>
      <p><strong>Plazo de conservación:</strong> Los datos se conservan durante la vigencia de la membresía y 2 años adicionales tras la baja, salvo obligación legal.</p>
      <p><strong>Derechos ARCO:</strong> Puedes ejercer tus derechos de Acceso, Rectificación, Cancelación y Oposición escribiendo a {{contact.privacyEmail}} con copia de tu documento de identidad.</p>
      <p><strong>Transferencias internacionales:</strong> No se realizan transferencias de datos fuera del Espacio Económico Europeo.</p>
      <p><strong>Delegado de Protección de Datos:</strong> {{contact.privacyEmail}}</p>
    `;
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeTermsModal() {
  const modal = document.getElementById('terms-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

// ─── Año de nacimiento select ─────────────────
function regBuildYearSelect() {
  const select = document.getElementById('r2-anio');
  if (!select) return;
  const current = new Date().getFullYear();
  select.innerHTML = `<option value="">${t('reg_anio')}</option>`;
  for (let y = current - 13; y >= current - 100; y--) {
    select.innerHTML += `<option value="${y}">${y}</option>`;
  }
}

// ─── Init ─────────────────────────────────────
function regInit() {
  regRenderStep();
  rgInitValidacionEnVivo();
  regInitUpload();
  regInitPasswordStrength();
  regBuildYearSelect();

  const diaSelect = document.getElementById('r2-dia');
  if (diaSelect) {
    diaSelect.innerHTML = `<option value="">${t('reg_dia')}</option>`;
    for (let d = 1; d <= 31; d++) diaSelect.innerHTML += `<option value="${d}">${d}</option>`;
  }
}
