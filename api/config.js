// Entrega a la página la dirección y la llave pública de Supabase (no son secretas: la base se protege con las reglas de supabase.sql).
module.exports = (req, res) => {
  const e = process.env;
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    url: e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || "",
    key: e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""
  });
};
