create extension if not exists pgcrypto;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  model_year integer not null check (model_year between 1886 and 2100),
  created_at timestamptz not null default now(),
  unique (make, model, model_year)
);

create table if not exists public.vehicle_aliases (
  make text not null,
  alias text not null,
  nhtsa_model text not null,
  primary key (make, alias)
);

insert into public.vehicle_aliases (make, alias, nhtsa_model) values
  ('BMW', '330i', '3 SERIES'),
  ('BMW', '330e', '3 SERIES'),
  ('BMW', '340i', '3 SERIES'),
  ('BMW', 'm340i', '3 SERIES'),
  ('BMW', '320i', '3 SERIES'),
  ('BMW', '530i', '5 SERIES'),
  ('BMW', '540i', '5 SERIES')
on conflict (make, alias) do nothing;

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  report_number text not null,
  report_date date,
  incident_date date,
  component text,
  summary text not null default '',
  defect_category text,
  crash boolean not null default false,
  fire boolean not null default false,
  injuries integer not null default 0,
  deaths integer not null default 0,
  source text not null default 'NHTSA',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (vehicle_id, report_number)
);

create index if not exists complaints_vehicle_date_idx
  on public.complaints (vehicle_id, report_date desc);
create index if not exists complaints_category_idx
  on public.complaints (vehicle_id, defect_category);

create table if not exists public.yearly_report_patterns (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  model_year integer not null,
  report_count integer not null default 0,
  anomaly_score double precision,
  is_unusual boolean not null default false,
  model_version text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.recalls (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  campaign_number text not null,
  report_date date,
  component text,
  summary text not null default '',
  consequence text,
  remedy text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (vehicle_id, campaign_number)
);

create table if not exists public.investigations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  nhtsa_id text not null,
  subject text not null default '',
  opened_date date,
  status text,
  summary text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (vehicle_id, nhtsa_id)
);

create table if not exists public.saved_searches (
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, query)
);

alter table public.vehicles enable row level security;
alter table public.vehicle_aliases enable row level security;
alter table public.complaints enable row level security;
alter table public.yearly_report_patterns enable row level security;
alter table public.recalls enable row level security;
alter table public.investigations enable row level security;
alter table public.saved_searches enable row level security;

create policy "Public can read vehicle catalog"
  on public.vehicles for select to anon, authenticated using (true);
create policy "Public can read vehicle aliases"
  on public.vehicle_aliases for select to anon, authenticated using (true);
create policy "Public can read complaints"
  on public.complaints for select to anon, authenticated using (true);
create policy "Public can read yearly report patterns"
  on public.yearly_report_patterns for select to anon, authenticated using (true);
create policy "Public can read recalls"
  on public.recalls for select to anon, authenticated using (true);
create policy "Public can read investigations"
  on public.investigations for select to anon, authenticated using (true);
create policy "Users manage their own saved searches"
  on public.saved_searches for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select on public.vehicles, public.vehicle_aliases, public.complaints, public.yearly_report_patterns, public.recalls, public.investigations to anon, authenticated;
grant select, insert, delete on public.saved_searches to authenticated;

create or replace function public.vehicle_research(
  p_make text,
  p_model text,
  p_start_year integer,
  p_end_year integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_vehicle_ids uuid[];
  v_vehicle_label text;
  v_reports bigint;
  v_recalls bigint;
  v_investigations bigint;
  v_trend jsonb;
  v_recall_trend jsonb;
  v_anomalies jsonb;
  v_categories jsonb;
  v_complaints jsonb;
  v_recall_items jsonb;
  v_investigation_items jsonb;
begin
  if p_make is null or length(trim(p_make)) not between 1 and 50
     or p_model is null or length(trim(p_model)) not between 1 and 80
     or p_start_year < 1980 or p_end_year > extract(year from now())::integer + 1
     or p_start_year > p_end_year or p_end_year - p_start_year > 15 then
    raise exception 'Invalid vehicle research query' using errcode = '22023';
  end if;

  select coalesce(array_agg(v.id), '{}'::uuid[]),
         (array_agg(v.make || ' ' || initcap(lower(v.model)) order by v.model_year))[1]
    into v_vehicle_ids, v_vehicle_label
    from public.vehicles v
   where lower(v.make) like '%' || lower(p_make) || '%'
     and v.model_year between p_start_year and p_end_year
     and (
       lower(v.model) like '%' || lower(p_model) || '%'
       or exists (
         select 1
           from public.vehicle_aliases a
          where lower(a.make) = lower(v.make)
            and lower(a.alias) = lower(p_model)
            and lower(a.nhtsa_model) = lower(v.model)
       )
     );

  select count(*) into v_reports
    from public.complaints c
   where c.vehicle_id = any(v_vehicle_ids);
  select count(distinct r.campaign_number) into v_recalls
    from public.recalls r
   where r.vehicle_id = any(v_vehicle_ids);
  select count(distinct i.nhtsa_id) into v_investigations
    from public.investigations i
   where i.vehicle_id = any(v_vehicle_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
           'year', y.model_year::text,
           'reports', coalesce(c.report_count, 0)
         ) order by y.model_year), '[]'::jsonb)
    into v_trend
    from generate_series(p_start_year, p_end_year) as y(model_year)
    left join (
      select v.model_year, count(c.id) as report_count
        from public.vehicles v
        left join public.complaints c on c.vehicle_id = v.id
       where v.id = any(v_vehicle_ids)
       group by v.model_year
    ) c on c.model_year = y.model_year;

  select coalesce(jsonb_agg(jsonb_build_object(
           'year', y.model_year::text,
           'recalls', coalesce(r.recall_count, 0)
         ) order by y.model_year), '[]'::jsonb)
    into v_recall_trend
    from generate_series(p_start_year, p_end_year) as y(model_year)
    left join (
      select v.model_year, count(distinct r.campaign_number) as recall_count
        from public.vehicles v
        left join public.recalls r on r.vehicle_id = v.id
       where v.id = any(v_vehicle_ids)
       group by v.model_year
    ) r on r.model_year = y.model_year;

  select coalesce(jsonb_agg(jsonb_build_object(
           'year', p.model_year::text,
           'reports', p.report_count,
           'score', p.anomaly_score
         ) order by p.model_year), '[]'::jsonb)
    into v_anomalies
    from public.yearly_report_patterns p
   where p.vehicle_id = any(v_vehicle_ids)
     and p.is_unusual;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', category_name,
           'count', category_count,
           'share', case when v_reports = 0 then 0 else round(category_count * 100.0 / v_reports)::integer end,
           'color', category_color
         ) order by category_count desc), '[]'::jsonb)
    into v_categories
    from (
      select coalesce(nullif(c.defect_category, ''), nullif(c.component, ''), 'Uncategorized') as category_name,
             count(*) as category_count,
             (array['blue', 'violet', 'orange', 'green', 'blue', 'violet'])[row_number() over (
               order by count(*) desc, coalesce(nullif(c.defect_category, ''), nullif(c.component, ''), 'Uncategorized')
             )::integer] as category_color
        from public.complaints c
       where c.vehicle_id = any(v_vehicle_ids)
       group by 1
       order by count(*) desc
       limit 6
    ) category_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', coalesce(to_char(c.report_date, 'Mon DD, YYYY'), 'Date not reported'),
           'year', c.model_year,
           'component', coalesce(nullif(c.component, ''), 'Uncategorized'),
           'title', left(coalesce(nullif(c.summary, ''), 'Complaint narrative not provided'), 150),
           'report', c.report_number,
           'color', case
             when lower(coalesce(c.defect_category, c.component, '')) like '%engine%' then 'orange'
             when lower(coalesce(c.defect_category, c.component, '')) like '%elect%' then 'violet'
             else 'blue'
           end
         ) order by c.report_date desc nulls last), '[]'::jsonb)
    into v_complaints
    from (
      select c.*, v.model_year
        from public.complaints c
        join public.vehicles v on v.id = c.vehicle_id
       where c.vehicle_id = any(v_vehicle_ids)
       order by c.report_date desc nulls last
       limit 5
    ) c;

  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign', r.campaign_number,
           'date', coalesce(to_char(r.report_date, 'Mon DD, YYYY'), 'Date not reported'),
           'component', coalesce(nullif(r.component, ''), 'Uncategorized'),
           'title', left(coalesce(nullif(r.summary, ''), 'Recall summary not provided'), 150),
           'consequence', r.consequence,
           'remedy', r.remedy
         ) order by r.report_date desc nulls last), '[]'::jsonb)
    into v_recall_items
    from (
      select r.*
        from public.recalls r
       where r.vehicle_id = any(v_vehicle_ids)
       order by r.report_date desc nulls last
       limit 10
    ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'nhtsaId', i.nhtsa_id,
           'subject', i.subject,
           'date', coalesce(to_char(i.opened_date, 'Mon DD, YYYY'), 'Date not reported'),
           'status', coalesce(i.status, 'Status not reported'),
           'summary', left(coalesce(nullif(i.summary, ''), i.subject), 180)
         ) order by i.opened_date desc nulls last), '[]'::jsonb)
    into v_investigation_items
    from (
      select i.*
        from public.investigations i
       where i.vehicle_id = any(v_vehicle_ids)
       order by i.opened_date desc nulls last
       limit 10
    ) i;

  return jsonb_build_object(
    'vehicleLabel', coalesce(v_vehicle_label, initcap(p_make) || ' ' || initcap(p_model)),
    'matchedVehicles', cardinality(v_vehicle_ids),
    'yearRange', jsonb_build_array(p_start_year, p_end_year),
    'reports', v_reports,
    'recalls', v_recalls,
    'investigations', v_investigations,
    'trend', v_trend,
    'recallTrend', v_recall_trend,
    'anomalies', v_anomalies,
    'categories', v_categories,
    'complaints', v_complaints,
    'recallItems', v_recall_items,
    'investigationItems', v_investigation_items
  );
end;
$$;

revoke all on function public.vehicle_research(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.vehicle_research(text, text, integer, integer) to service_role;
