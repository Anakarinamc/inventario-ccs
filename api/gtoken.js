// Da un permiso corto (1 hora, solo lectura) para leer las hojas de Google.
// Solo responde a quien entró con su clave y está en la lista de miembros de Supabase.
// La llave de la cuenta de servicio de Google vive en la variable GOOGLE_SERVICE_ACCOUNT_JSON de Vercel, nunca en el código.
const crypto = require("crypto");

let cache = { token: "", exp: 0 };
const b64 = v => Buffer.from(v).toString("base64url");

function supa(){
  const e = process.env;
  return {
    url: (e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, ""),
    key: e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""
  };
}

async function esMiembro(auth){
  const s = supa();
  if (!s.url || !s.key) return false;
  const r = await fetch(s.url + "/rest/v1/rpc/soy_miembro", {
    method: "POST",
    headers: { apikey: s.key, Authorization: auth, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

async function googleToken(sa){
  const now = Math.floor(Date.now() / 1000);
  if (cache.token && cache.exp - 120 > now) return cache;
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + claim + "." + sig
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Google no dio el permiso: " + (j.error_description || j.error || r.status));
  cache = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cache;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const auth = req.headers.authorization || "";
    if (!/^Bearer .+/.test(auth)) return res.status(401).json({ error: "sin_sesion" });
    if (!(await esMiembro(auth))) return res.status(403).json({ error: "sin_permiso" });
    let sa;
    try { sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ""); } catch (e) { sa = null; }
    if (!sa || !sa.client_email || !sa.private_key) return res.status(500).json({ error: "falta_google" });
    const t = await googleToken(sa);
    res.status(200).json({ token: t.token, exp: t.exp, cuenta: sa.client_email });
  } catch (e) {
    res.status(502).json({ error: "google", message: String(e && e.message || e) });
  }
};
