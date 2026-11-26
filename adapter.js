/* Adaptador para usar la app fuera de Claude.
   Dentro de Claude no hace nada. Fuera, ofrece lo mismo que la app espera (window.claude.use):
   - "db": los datos, guardados en Supabase (tabla docs).
   - "mcp": lectura de las hojas de Google con un permiso corto que entrega /api/gtoken.
   - "user": quién entró.
   No contiene llaves ni enlaces de hojas: llegan de /api/config y del documento privado/hojas de la base. */
(function(){
"use strict";
if (window.claude && typeof window.claude.use === "function") return;

const TABLE = "docs";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";
let sb = null, session = null, hojas = {};
let readyOk; const ready = new Promise(r => { readyOk = r; });

/* ---------- pantalla de entrada ---------- */
const CSS = "#invGate{position:fixed;inset:0;z-index:99999;background:#f6f4ef;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1b16}" +
  "#invGate .box{width:100%;max-width:360px;background:#fff;border:1px solid #ddd6c8;border-radius:14px;padding:22px}" +
  "#invGate h1{font-size:20px;margin:0 0 4px}#invGate p{margin:0 0 14px;font-size:14px;color:#5d584c;line-height:1.4}" +
  "#invGate label{display:block;font-size:13px;margin:10px 0 4px}" +
  "#invGate input[type=email],#invGate input[type=password]{width:100%;box-sizing:border-box;font-size:16px;padding:11px 12px;border:1px solid #c9c1b0;border-radius:9px;background:#fff;color:inherit}" +
  "#invGate button{width:100%;margin-top:14px;font-size:16px;font-weight:600;padding:12px;border:0;border-radius:9px;background:#1d1b16;color:#fff;cursor:pointer}" +
  "#invGate button.sec{background:transparent;color:#1d1b16;border:1px solid #c9c1b0;font-weight:500}" +
  "#invGate button:disabled{opacity:.55}#invGate .err{color:#a3261c;font-size:14px;margin-top:10px;min-height:18px}" +
  "#invSalir{display:block;margin:18px auto 28px;background:none;border:0;color:inherit;opacity:.6;font:inherit;font-size:13px;text-decoration:underline;cursor:pointer}";
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }
function gate(html){
  let g = document.getElementById("invGate");
  if (!g){
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    g = document.createElement("div"); g.id = "invGate"; (document.body || document.documentElement).appendChild(g);
  }
  g.innerHTML = '<div class="box">' + html + "</div>";
  return g;
}
function closeGate(){ const g = document.getElementById("invGate"); if (g) g.remove(); }
function fatal(t, s){ gate("<h1>" + esc(t) + "</h1><p>" + esc(s) + '</p><button type="button" onclick="location.reload()">Volver a intentar</button>'); }

function askLogin(){
  return new Promise(resolve => {
    const g = gate('<h1>Inventario Caracas</h1><p>Entra con tu correo y tu clave.</p>' +
      '<form><label for="invMail">Correo</label><input id="invMail" type="email" autocomplete="username" required>' +
      '<label for="invPass">Clave</label><input id="invPass" type="password" autocomplete="current-password" required>' +
      '<button type="submit">Entrar</button><div class="err" role="alert"></div></form>');
    const f = g.querySelector("form"), err = g.querySelector(".err"), btn = g.querySelector("button");
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); err.textContent = ""; btn.disabled = true;
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email: g.querySelector("#invMail").value.trim(), password: g.querySelector("#invPass").value });
        if (error || !data || !data.session){ err.textContent = (error && /invalid/i.test(error.message || "")) ? "Correo o clave incorrectos." : "No se pudo entrar. Revisa tu conexión y vuelve a intentar."; btn.disabled = false; return; }
        resolve(data.session);
      } catch(e){ err.textContent = "No se pudo entrar. Revisa tu conexión y vuelve a intentar."; btn.disabled = false; }
    });
  });
}

/* ---------- primera vez: traer los datos ---------- */
async function importDocs(list, onProgress){
  const rows = list.filter(d => d && d.collection && d.id && d.data && typeof d.data === "object")
    .map(d => ({ collection: String(d.collection), id: String(d.id), data: d.data, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 10){
    const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + 10), { onConflict: "collection,id" });
    if (error) throw error;
    if (onProgress) onProgress(Math.min(i + 10, rows.length), rows.length);
  }
  return rows.length;
}
function askImport(){
  return new Promise(resolve => {
    const g = gate('<h1>Falta traer los datos</h1><p>La base está vacía. Elige el archivo de datos del inventario (termina en .json) y se cargan solos.</p>' +
      '<input type="file" accept=".json,application/json" id="invFile" style="font-size:15px;width:100%">' +
      '<div class="err" role="alert"></div><button type="button" class="sec" id="invSkip">Entrar sin datos</button>');
    const err = g.querySelector(".err");
    g.querySelector("#invSkip").onclick = () => resolve(false);
    g.querySelector("#invFile").addEventListener("change", async ev => {
      const file = ev.target.files && ev.target.files[0]; if (!file) return;
      err.style.color = "#5d584c"; err.textContent = "Leyendo el archivo…";
      try {
        const j = JSON.parse(await file.text());
        const list = Array.isArray(j) ? j : j.docs;
        if (!Array.isArray(list) || !list.length) throw new Error("vacio");
        const n = await importDocs(list, (a, b) => { err.textContent = "Cargando " + a + " de " + b + "…"; });
        err.textContent = "Listo: " + n + " registros.";
        resolve(true);
      } catch(e){ err.style.color = "#a3261c"; err.textContent = e && e.message === "vacio" ? "Ese archivo no tiene datos del inventario." : "No se pudo cargar el archivo. " + ((e && e.message) || ""); ev.target.value = ""; }
    });
  });
}

/* ---------- datos (misma forma que usa la app) ---------- */
function dbErr(e){
  const m = (e && e.message) || String(e), c = e && e.code;
  if (c === "42501" || /row-level security|permission denied/i.test(m)) return { code: "invalid_argument", message: m };
  if (c === "PGRST301" || /jwt/i.test(m)) return { code: "revoked", message: m };
  return { code: "unavailable", message: m };
}
const watchers = {}; /* colección -> { subs:Set, timer } */
async function fetchCol(c, lim){
  const { data, error } = await sb.from(TABLE).select("id,data").eq("collection", c).order("id").limit(lim || 1000);
  if (error) throw dbErr(error);
  return { docs: (data || []).map(r => ({ id: r.id, data: () => r.data })) };
}
function refresh(c, wait){
  const w = watchers[c]; if (!w || !w.subs.size) return;
  clearTimeout(w.timer);
  w.timer = setTimeout(() => { w.subs.forEach(s => { fetchCol(c, s.lim).then(s.cb, e => { if (s.onErr) s.onErr(e); }); }); }, wait === undefined ? 150 : wait);
}
function watch(c, lim, cb, onErr){
  const w = watchers[c] || (watchers[c] = { subs: new Set(), timer: 0 });
  const s = { lim, cb, onErr }; w.subs.add(s);
  fetchCol(c, lim).then(cb, e => { if (onErr) onErr(e); });
  return () => w.subs.delete(s);
}
const db = {
  doc(path){
    const i = path.indexOf("/"), c = path.slice(0, i), id = path.slice(i + 1);
    return {
      id,
      async get(){
        const { data, error } = await sb.from(TABLE).select("data").eq("collection", c).eq("id", id).maybeSingle();
        if (error) throw dbErr(error);
        return { id, exists: !!data, data: () => (data ? data.data : undefined) };
      },
      async set(value){
        const { error } = await sb.from(TABLE).upsert({ collection: c, id, data: value, updated_at: new Date().toISOString() }, { onConflict: "collection,id" });
        if (error) throw dbErr(error); refresh(c, 0);
      },
      async update(patch){
        const { error } = await sb.rpc("doc_merge", { p_collection: c, p_id: id, p_patch: patch });
        if (error) throw dbErr(error); refresh(c, 0);
      },
      async delete(){
        const { error } = await sb.from(TABLE).delete().eq("collection", c).eq("id", id);
        if (error) throw dbErr(error); refresh(c, 0);
      }
    };
  },
  collection(c){
    let lim = 1000;
    const q = { limit(n){ lim = n; return q; }, onSnapshot(cb, onErr){ return watch(c, lim, cb, onErr); } };
    return q;
  }
};

/* ---------- Google Sheets ---------- */
let gtok = { token: "", exp: 0 }, gtokP = null;
async function googleToken(force){
  const now = Date.now() / 1000;
  if (!force && gtok.token && gtok.exp - 90 > now) return gtok.token;
  if (!gtokP) gtokP = (async () => {
    const s = (await sb.auth.getSession()).data.session; if (s) session = s;
    const r = await fetch("/api/gtoken", { headers: { Authorization: "Bearer " + (session ? session.access_token : "") } });
    let j = {}; try { j = await r.json(); } catch(e){}
    if (r.status === 401) throw { code: "needs_login", message: "Vuelve a entrar con tu clave." };
    if (r.status === 403) throw { code: "tool_error", message: "Tu usuario no tiene permiso para leer las hojas." };
    if (!r.ok || !j.token) throw { code: "tool_error", message: j.error === "falta_google" ? "Falta poner la llave de Google en Vercel." : (j.message || "No se pudo pedir el permiso de Google.") };
    gtok = { token: j.token, exp: j.exp || now + 3000, cuenta: j.cuenta || "" };
    return gtok.token;
  })().finally(() => { gtokP = null; });
  return gtokP;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let active = 0; const waiting = [];
async function slot(fn){ /* pocas lecturas a la vez: Google limita a 60 por minuto */
  if (active >= 4) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; const n = waiting.shift(); if (n) n(); }
}
const sheetCache = new Map();
async function readRange(id, range){
  let renew = false;
  for (let attempt = 0; ; attempt++){
    const tok = await googleToken(renew); renew = false;
    let r;
    try { r = await fetch(SHEETS + encodeURIComponent(id) + "/values/" + encodeURIComponent(range), { headers: { Authorization: "Bearer " + tok } }); }
    catch(e){ if (attempt < 3){ await sleep(1500 * (attempt + 1)); continue; } throw { code: "server_unavailable", message: "Sin conexión con Google Sheets." }; }
    if (r.ok){ const j = await r.json(); return { range: j.range || range, values: j.values || [] }; }
    if (r.status === 401 && attempt < 1){ renew = true; continue; }
    if ((r.status === 429 || r.status >= 500) && attempt < 5){ await sleep(Math.min(4000 * Math.pow(1.7, attempt), 30000) + Math.random() * 1500); continue; }
    let msg = ""; try { msg = ((await r.json()).error || {}).message || ""; } catch(e){}
    if (r.status === 403) throw { code: "tool_error", message: "La hoja no está compartida con la cuenta de la app" + (gtok.cuenta ? " (" + gtok.cuenta + ")" : "") + "." };
    if (r.status === 404) throw { code: "tool_error", message: "No se encontró la hoja. Revisa el enlace guardado." };
    throw { code: r.status === 429 ? "upstream_error" : "tool_error", message: msg || ("Error " + r.status) };
  }
}
const mcp = {
  async callTool(server, tool, args, opts){
    if (tool !== "get_values") throw { code: "tool_error", message: "Esta app solo lee hojas." };
    const raw = String((args && args.spreadsheetId) || ""), id = hojas[raw] || raw, range = String((args && args.range) || "");
    if (!id || /^ID_SHEET_/.test(id)) throw { code: "tool_error", message: "Falta guardar el enlace de esta hoja en la base de datos (" + raw + ")." };
    const c = (opts && opts.cache) || {}, key = id + "|" + range, hit = sheetCache.get(key);
    const stale = c.staleTime === undefined ? 0 : c.staleTime;
    if (hit && !c.refresh && Date.now() - hit.at < stale) return { payload: hit.payload };
    const payload = await slot(() => readRange(id, range));
    sheetCache.set(key, { at: Date.now(), payload });
    return { payload };
  }
};

/* ---------- arranque ---------- */
async function loadHojas(){
  try { const sn = await db.doc("privado/hojas").get(); hojas = (sn.exists && sn.data().map) || {}; } catch(e){ hojas = {}; }
}
async function start(){
  if (!window.supabase || typeof window.supabase.createClient !== "function"){ fatal("No se pudo abrir la app", "No cargó una parte de la página. Revisa tu conexión."); return; }
  let cfg = null;
  try { const r = await fetch("/api/config"); cfg = await r.json(); } catch(e){}
  if (!cfg || !cfg.url || !cfg.key){ fatal("Falta terminar la instalación", "Vercel todavía no tiene la dirección y la llave pública de Supabase."); return; }
  sb = window.supabase.createClient(cfg.url, cfg.key);
  try { session = (await sb.auth.getSession()).data.session; } catch(e){ session = null; }
  for (;;){
    if (!session) session = await askLogin();
    let ok = false, bad = null;
    try { const { data, error } = await sb.rpc("reclamar"); if (error) bad = error; ok = data === true; } catch(e){ bad = e; }
    if (ok) break;
    if (bad){ fatal("La base de datos no está lista", "Falta pegar el archivo supabase.sql en Supabase, o no hay conexión."); return; }
    try { await sb.auth.signOut(); } catch(e){}
    session = null;
    gate('<h1>Sin permiso</h1><p>Ese usuario no está en la lista de personas que pueden ver el inventario.</p><button type="button" id="invBack">Entrar con otro usuario</button>');
    await new Promise(r => { document.getElementById("invBack").onclick = r; });
  }
  sb.auth.onAuthStateChange((ev, s) => { if (s) session = s; if (ev === "SIGNED_OUT") location.reload(); });
  let vacia = false;
  try { const { data, error } = await sb.from(TABLE).select("id").eq("collection", "catalogo").limit(1); vacia = !error && !(data && data.length); } catch(e){}
  if (vacia) await askImport();
  await loadHojas();
  closeGate();
  try {
    sb.channel("docs-cambios").on("postgres_changes", { event: "*", schema: "public", table: TABLE }, p => {
      const c = (p.new && p.new.collection) || (p.old && p.old.collection);
      if (c) refresh(c); else Object.keys(watchers).forEach(k => refresh(k));
      if (c === "privado") loadHojas();
    }).subscribe();
  } catch(e){}
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") Object.keys(watchers).forEach(k => refresh(k, 400)); });
  const out = document.createElement("button"); out.id = "invSalir"; out.type = "button"; out.textContent = "Salir de mi cuenta";
  out.onclick = () => { sb.auth.signOut().finally(() => location.reload()); };
  document.body.appendChild(out);
  readyOk();
}

const caps = { db, mcp, user: { isOwner: async () => true, email: () => (session && session.user ? session.user.email : "") } };
window.claude = { use: async name => { await ready; return caps[name] || null; } };
window.invImportar = async list => { await ready; return importDocs(list); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
