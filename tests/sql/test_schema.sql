\set ON_ERROR_STOP on
\echo '== Team Tora No Maki · pruebas del motor de sorteo =='

-- ------------------------------------------------------------
-- Limpieza y administrador de prueba
-- ------------------------------------------------------------
truncate table public.assignments, public.participants restart identity;
delete from public.admins;
delete from auth.users;

update public.exchange_state
set registration_open = true,
    draw_status = 'pending',
    draw_round = 0,
    drawn_at = null,
    updated_at = now();

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'admin@test.local');

insert into public.admins (user_id)
values ('00000000-0000-0000-0000-000000000001');

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000002', 'no-admin@test.local');

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);

create or replace function public.test_assert_invariants(p_expected integer)
returns void
language plpgsql
as $$
declare
  v_total integer;
  v_assignments integer;
  v_self integer;
  v_dup_givers integer;
  v_dup_receivers integer;
  v_unassigned integer;
begin
  select count(*) into v_total from public.participants;
  select count(*) into v_assignments from public.assignments;

  select count(*) into v_self
  from public.assignments
  where giver_id = receiver_id;

  select count(*) into v_dup_givers
  from (
    select giver_id from public.assignments group by giver_id having count(*) > 1
  ) d;

  select count(*) into v_dup_receivers
  from (
    select receiver_id from public.assignments group by receiver_id having count(*) > 1
  ) d;

  select count(*) into v_unassigned
  from public.participants p
  where not exists (
      select 1 from public.assignments a where a.giver_id = p.id
    )
    or not exists (
      select 1 from public.assignments a where a.receiver_id = p.id
    );

  if v_total <> p_expected then
    raise exception 'Total esperado %, obtenido %', p_expected, v_total;
  end if;
  if v_assignments <> p_expected then
    raise exception 'Asignaciones esperadas %, obtenidas %', p_expected, v_assignments;
  end if;
  if v_self <> 0 then
    raise exception 'Hay % auto-regalos', v_self;
  end if;
  if v_dup_givers <> 0 then
    raise exception 'Hay % regaladores duplicados', v_dup_givers;
  end if;
  if v_dup_receivers <> 0 then
    raise exception 'Hay % receptores duplicados', v_dup_receivers;
  end if;
  if v_unassigned <> 0 then
    raise exception 'Hay % participantes sin asignación completa', v_unassigned;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Registro de 40 participantes
-- ------------------------------------------------------------
do $$
declare
  i integer;
begin
  for i in 1..40 loop
    perform public.register_participant(
      'Participante ' || lpad(i::text, 2, '0'),
      'Apellido ' || lpad(i::text, 2, '0'),
      (35 + (i % 10))::text
    );
  end loop;
end;
$$;

do $$
declare
  v_state jsonb;
begin
  select public.get_public_state() into v_state;

  if (v_state->>'participant_count')::int <> 40 then
    raise exception 'get_public_state devolvió un total incorrecto: %', v_state;
  end if;
  if (v_state->>'registration_open')::boolean is not true then
    raise exception 'El registro debería estar abierto';
  end if;
  if (v_state->>'draw_done')::boolean is not false then
    raise exception 'El sorteo no debería estar realizado';
  end if;
end;
$$;
\echo 'OK: 40 registros y estado público'

-- Duplicados exactos y con distinto formato
do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.register_participant('participante 01', 'APELLIDO 01', '99');
  exception when others then
    v_blocked := true;
    if sqlerrm not like 'Ya existe un participante%' then
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'Se permitió un registro duplicado';
  end if;
end;
$$;
\echo 'OK: duplicados bloqueados'

-- ------------------------------------------------------------
-- Sorteo completo de 40
-- ------------------------------------------------------------
select public.admin_start_full_draw();
select public.test_assert_invariants(40);

do $$
declare
  v_dashboard jsonb;
begin
  select public.admin_get_dashboard() into v_dashboard;

  if (v_dashboard->'stats'->>'total')::int <> 40 then
    raise exception 'Dashboard: total incorrecto %', v_dashboard;
  end if;
  if (v_dashboard->'stats'->>'assigned')::int <> 40 then
    raise exception 'Dashboard: asignados incorrectos %', v_dashboard;
  end if;
  if (v_dashboard->'stats'->>'pending')::int <> 0 then
    raise exception 'Dashboard: pendientes incorrectos %', v_dashboard;
  end if;
  if (v_dashboard->'state'->>'draw_round')::int <> 1 then
    raise exception 'Dashboard: ronda incorrecta %', v_dashboard;
  end if;
  if jsonb_array_length(v_dashboard->'participants') <> 40 then
    raise exception 'Dashboard: lista de participantes incorrecta';
  end if;
end;
$$;
\echo 'OK: sorteo completo de 40 sin auto-regalos ni duplicados'

create temp table saved_assignments as
select giver_id, receiver_id
from public.assignments;

-- ------------------------------------------------------------
-- Segundo sorteo: 3 rezagados
-- ------------------------------------------------------------
select public.register_participant('Tarde', 'Uno', '40');
select public.register_participant('Tarde', 'Dos', '41');
select public.register_participant('Tarde', 'Tres', '42');

do $$
declare
  v_dashboard jsonb;
  v_lookup jsonb;
begin
  select public.admin_get_dashboard() into v_dashboard;

  if (v_dashboard->'stats'->>'total')::int <> 43 then
    raise exception 'Dashboard: total tras rezagados incorrecto %', v_dashboard;
  end if;
  if (v_dashboard->'stats'->>'pending')::int <> 3 then
    raise exception 'Dashboard: pendientes tras rezagados incorrecto %', v_dashboard;
  end if;

  select public.get_my_assignment('Tarde', 'Uno', '40') into v_lookup;

  if (v_lookup->>'found')::boolean is not true then
    raise exception 'No se encontró al participante recién registrado: %', v_lookup;
  end if;
  if (v_lookup->>'has_assignment')::boolean is not false then
    raise exception 'El rezagado no debería tener asignación todavía: %', v_lookup;
  end if;
  if (v_lookup->>'draw_done')::boolean is not true then
    raise exception 'El estado del sorteo debería ser realizado: %', v_lookup;
  end if;
end;
$$;

select public.admin_integrate_new_participants();
select public.test_assert_invariants(43);

do $$
declare
  v_changed integer;
  v_old_edges integer;
  v_late_missing integer;
begin
  select count(*) into v_changed
  from saved_assignments s
  join public.assignments a on a.giver_id = s.giver_id
  where a.receiver_id <> s.receiver_id;

  select count(*) into v_old_edges
  from saved_assignments s
  join public.assignments a on a.giver_id = s.giver_id;

  select count(*) into v_late_missing
  from public.participants p
  where public.normalize_name(p.last_name) = 'tarde'
    and (
      not exists (select 1 from public.assignments a where a.giver_id = p.id)
      or not exists (select 1 from public.assignments a where a.receiver_id = p.id)
    );

  if v_old_edges <> 40 then
    raise exception 'Se perdieron asignaciones antiguas: %', v_old_edges;
  end if;
  if v_changed <> 1 then
    raise exception 'Se esperaba cambiar exactamente 1 asignación existente; se cambiaron %', v_changed;
  end if;
  if v_late_missing <> 0 then
    raise exception 'Quedaron % rezagados sin asignación', v_late_missing;
  end if;
end;
$$;

do $$
declare
  v_lookup jsonb;
  v_receiver jsonb;
begin
  select public.get_my_assignment('Tarde', 'Dos', '41.0') into v_lookup;

  if (v_lookup->>'found')::boolean is not true
     or (v_lookup->>'has_assignment')::boolean is not true then
    raise exception 'El rezagado integrado no tiene asignación: %', v_lookup;
  end if;

  v_receiver := v_lookup->'receiver';

  if v_receiver is null or v_receiver->>'first_name' is null then
    raise exception 'La asignación no incluye los datos del receptor: %', v_lookup;
  end if;
end;
$$;
\echo 'OK: segundo sorteo integra a los 3 nuevos con solo 1 cambio existente'

-- ------------------------------------------------------------
-- Consulta: normalización de nombre y talla
-- ------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  v_result := public.get_my_assignment(
    '  participante   01 ',
    'APELLIDO 01',
    '36.0'
  );

  if (v_result->>'found')::boolean is not true then
    raise exception 'Falló la búsqueda con nombre/talla normalizados: %', v_result;
  end if;

  v_result := public.get_my_assignment('Participante 01', 'Apellido 01', '37');

  if (v_result->>'found')::boolean is not false then
    raise exception 'La búsqueda aceptó una talla incorrecta: %', v_result;
  end if;
end;
$$;
\echo 'OK: normalización de nombre y talla'

-- ------------------------------------------------------------
-- Cierre y reapertura del registro
-- ------------------------------------------------------------
select public.admin_set_registration_open(false);

do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.register_participant('Cerrado', 'Prueba', '40');
  exception when others then
    v_blocked := true;
    if sqlerrm not like 'El registro está cerrado%' then
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'Se permitió registrar con el registro cerrado';
  end if;
end;
$$;

select public.admin_set_registration_open(true);
\echo 'OK: cierre y reapertura del registro'

-- ------------------------------------------------------------
-- Integración sin pendientes y re-sorteo total
-- ------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  select public.admin_integrate_new_participants() into v_result;

  if v_result->>'mode' <> 'none' then
    raise exception 'La integración sin pendientes debía ser "none": %', v_result;
  end if;
end;
$$;

select public.admin_start_full_draw();
select public.test_assert_invariants(43);

do $$
declare
  v_round integer;
begin
  select draw_round into v_round
  from public.exchange_state
  where singleton = true;

  if v_round <> 3 then
    raise exception 'La ronda del re-sorteo debería ser 3, es %', v_round;
  end if;
end;
$$;
\echo 'OK: re-sorteo total de 43'

-- ------------------------------------------------------------
-- Eliminar participante pendiente vs. asignado
-- ------------------------------------------------------------
select public.register_participant('Borrar', 'Prueba', '50');

do $$
declare
  v_id uuid;
  v_blocked boolean := false;
begin
  select id into v_id
  from public.participants
  where public.normalize_name(first_name) = 'borrar'
    and public.normalize_name(last_name) = 'prueba';

  perform public.admin_delete_pending_participant(v_id);

  if exists (select 1 from public.participants where id = v_id) then
    raise exception 'No se eliminó al participante pendiente';
  end if;

  select id into v_id
  from public.participants
  order by created_at
  limit 1;

  begin
    perform public.admin_delete_pending_participant(v_id);
  exception when others then
    v_blocked := true;
    if sqlerrm not like 'No se puede eliminar%' then
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'Se permitió eliminar a un participante asignado';
  end if;
end;
$$;
\echo 'OK: eliminación solo de participantes pendientes'

-- ------------------------------------------------------------
-- Menos de 2 participantes
-- ------------------------------------------------------------
begin;
truncate table public.assignments, public.participants restart identity;

do $$
declare
  v_blocked boolean := false;
begin
  perform public.register_participant('Solo', 'Uno', '40');

  begin
    perform public.admin_start_full_draw();
  exception when others then
    v_blocked := true;
    if sqlerrm not like 'Se necesitan al menos 2%' then
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'Se permitió sortear con 1 participante';
  end if;
end;
$$;
rollback;
\echo 'OK: sorteo bloqueado con menos de 2 participantes'

-- ------------------------------------------------------------
-- Permisos: anon no puede leer tablas ni ejecutar admin
-- ------------------------------------------------------------
begin;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  v_state jsonb;
  v_blocked boolean;
begin
  select public.get_public_state() into v_state;
  if (v_state->>'participant_count')::int <> 43 then
    raise exception 'anon no pudo leer el estado público: %', v_state;
  end if;

  v_blocked := false;
  begin
    perform count(*) from public.participants;
  exception when insufficient_privilege then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'anon pudo leer la tabla de participantes';
  end if;

  v_blocked := false;
  begin
    perform public.admin_get_dashboard();
  exception when insufficient_privilege then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'anon pudo ejecutar una función de administrador';
  end if;

  perform public.get_my_assignment('Participante 01', 'Apellido 01', '36');
end;
$$;

select public.register_participant('Anon', 'Prueba', '44');
rollback;
\echo 'OK: permisos de anon'

-- ------------------------------------------------------------
-- Permisos: usuario autenticado que no es admin
-- ------------------------------------------------------------
begin;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);

do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.admin_get_dashboard();
  exception when others then
    v_blocked := true;
    if sqlerrm not like '%permisos de administrador%' then
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'Un usuario autenticado no admin pudo abrir el panel';
  end if;
end;
$$;
rollback;

-- Administrador real, con rol authenticated
begin;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  v_dashboard jsonb;
begin
  select public.admin_get_dashboard() into v_dashboard;

  if (v_dashboard->'stats'->>'total')::int <> 43 then
    raise exception 'El administrador no pudo leer el dashboard: %', v_dashboard;
  end if;
end;
$$;
rollback;
\echo 'OK: permisos de administrador'

-- ------------------------------------------------------------
-- Resultado final
-- ------------------------------------------------------------
do $$
declare
  v_dashboard jsonb;
begin
  select public.admin_get_dashboard() into v_dashboard;

  raise notice 'Dashboard final: %', v_dashboard->'stats';
  raise notice 'Ronda final: %', v_dashboard->'state'->>'draw_round';
end;
$$;

\echo '== TODAS LAS PRUEBAS PASARON =='
