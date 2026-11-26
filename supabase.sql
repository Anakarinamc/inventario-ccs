-- Inventario Caracas: base de datos en Supabase.
-- Pegar todo en Supabase > SQL Editor > Run. Se puede correr más de una vez sin dañar nada.

-- 1) Quién puede entrar. La primera persona que entra con su clave queda como dueña.
create table if not exists public.miembros (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  creado timestamptz not null default now()
);
alter table public.miembros enable row level security;

create or replace function public.soy_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros where user_id = auth.uid());
$$;

create or replace function public.reclamar() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  lock table public.miembros in exclusive mode;
  if not exists (select 1 from public.miembros) then
    insert into public.miembros (user_id, email) values (auth.uid(), auth.jwt() ->> 'email');
  end if;
  return exists (select 1 from public.miembros where user_id = auth.uid());
end $$;

drop policy if exists miembros_ver on public.miembros;
create policy miembros_ver on public.miembros for select to authenticated using (public.soy_miembro());

-- 2) Los datos de la app: un registro por documento (catálogo, estado, conteos, compras).
create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.docs enable row level security;

drop policy if exists docs_miembros on public.docs;
create policy docs_miembros on public.docs for all to authenticated
  using (public.soy_miembro()) with check (public.soy_miembro());

-- 3) Guardar solo una parte de un documento sin borrar el resto.
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then (
      select coalesce(jsonb_object_agg(k,
        case when a ? k and b ? k then public.jsonb_deep_merge(a -> k, b -> k)
             when b ? k then b -> k
             else a -> k end), '{}'::jsonb)
      from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) s)
    else b
  end;
$$;

create or replace function public.doc_merge(p_collection text, p_id text, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  insert into public.docs (collection, id, data) values (p_collection, p_id, p_patch)
  on conflict (collection, id) do update
    set data = public.jsonb_deep_merge(public.docs.data, excluded.data), updated_at = now();
end $$;

-- 4) Permisos: nadie sin clave puede hacer nada.
revoke all on public.docs, public.miembros from anon;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.miembros to authenticated;
revoke execute on function public.soy_miembro(), public.reclamar(), public.doc_merge(text, text, jsonb) from public, anon;
grant execute on function public.soy_miembro(), public.reclamar(), public.doc_merge(text, text, jsonb) to authenticated;

-- 5) Que los cambios se vean al momento en todos los teléfonos.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- Para dar acceso a otra persona (después de crearla en Authentication > Users):
-- insert into public.miembros (user_id, email) select id, email from auth.users where email = 'correo@ejemplo.com';
