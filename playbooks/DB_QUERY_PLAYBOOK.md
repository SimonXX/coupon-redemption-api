# Database Query Playbook

Questo file contiene query e comandi utili per ispezionare, preparare e ripulire il database durante la supervisione manuale della Part B.

## 0. Connessione

### PSQL nel container

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### Singola query da shell

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select now();"'
```

### Adminer

```text
URL:      http://localhost:8081
System:   PostgreSQL
Server:   postgres
Username: coupon_user
Password: coupon_password
Database: coupon_redemption
```

## 1. Schema E Oggetti DB

### Tabelle

```sql
\dt
```

### Struttura tabelle

```sql
\d+ campaigns
\d+ coupons
\d+ users
\d+ redemptions
```

### Constraint

```sql
select
    conrelid::regclass as table_name,
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('campaigns'::regclass, 'coupons'::regclass, 'users'::regclass, 'redemptions'::regclass)
order by table_name::text, constraint_name;
```

### Indici

```sql
select
    schemaname,
    tablename,
    indexname,
    indexdef
from pg_indexes
where tablename in ('campaigns', 'coupons', 'users', 'redemptions')
order by tablename, indexname;
```

### Trigger

```sql
select
    event_object_table as table_name,
    trigger_name,
    action_timing,
    event_manipulation,
    action_statement
from information_schema.triggers
where event_object_table in ('campaigns', 'coupons')
order by event_object_table, trigger_name;
```

## 2. Conteggi Rapidi

```sql
select
    (select count(*) from campaigns) as campaigns,
    (select count(*) from coupons) as coupons,
    (select count(*) from users) as users,
    (select count(*) from redemptions) as redemptions;
```

Da shell:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select (select count(*) from campaigns) as campaigns, (select count(*) from coupons) as coupons, (select count(*) from users) as users, (select count(*) from redemptions) as redemptions;"'
```

## 3. Dati Seed

### Users seedati

```sql
select id, email, role, created_at
from users
order by email;
```

### Campaign seedate

```sql
select
    id,
    name,
    status,
    start_timestamp,
    end_timestamp,
    max_redemptions,
    redemptions_count
from campaigns
order by start_timestamp, name;
```

### Coupon seedati con campaign

```sql
select
    coupons.id,
    coupons.code,
    coupons.status as coupon_status,
    coupons.expiration_timestamp,
    coupons.max_redemptions as coupon_max,
    coupons.redemptions_count as coupon_count,
    campaigns.name as campaign_name,
    campaigns.status as campaign_status,
    campaigns.start_timestamp,
    campaigns.end_timestamp,
    campaigns.max_redemptions as campaign_max,
    campaigns.redemptions_count as campaign_count
from coupons
join campaigns on campaigns.id = coupons.campaign_id
order by campaigns.start_timestamp, coupons.code;
```

## 4. SQL Equivalente A GET /coupons

Questa query deve riflettere la listing API:

```sql
select
    coupons.code,
    coupons.status as coupon_status,
    coupons.expiration_timestamp,
    campaigns.name as campaign_name,
    campaigns.status as campaign_status,
    campaigns.start_timestamp,
    campaigns.end_timestamp
from coupons
join campaigns on campaigns.id = coupons.campaign_id
where campaigns.status = 'available'
  and coupons.status = 'available'
  and campaigns.end_timestamp >= now()
  and (
      coupons.expiration_timestamp is null
      or coupons.expiration_timestamp >= now()
  )
order by campaigns.start_timestamp asc, coupons.code asc, coupons.id asc;
```

Atteso su seed pulito:

```text
NO-EXPIRY
ONE-SLOT
SPRING10
FUTURE10
```

`FUTURE10` appartiene a una campagna con start date assoluta `2026-09-01`.
Questo evita che il caso "future campaign visible in listing but not redeemable yet" dipenda dal giorno in cui viene lanciato il seed.

## 5. Redemption Records

### Tutte le redemption

```sql
select
    redemptions.id,
    users.email,
    coupons.code,
    campaigns.name as campaign_name,
    redemptions.redeemed_at
from redemptions
join users on users.id = redemptions.user_id
join coupons on coupons.id = redemptions.coupon_id
join campaigns on campaigns.id = coupons.campaign_id
order by redemptions.redeemed_at desc;
```

### Redemption per coupon

```sql
select
    coupons.code,
    count(redemptions.id) as redemption_records,
    coupons.redemptions_count as stored_coupon_count
from coupons
left join redemptions on redemptions.coupon_id = coupons.id
group by coupons.id, coupons.code, coupons.redemptions_count
order by coupons.code;
```

### Redemption per campaign

```sql
select
    campaigns.name,
    count(redemptions.id) as redemption_records,
    campaigns.redemptions_count as stored_campaign_count
from campaigns
left join coupons on coupons.campaign_id = campaigns.id
left join redemptions on redemptions.coupon_id = coupons.id
group by campaigns.id, campaigns.name, campaigns.redemptions_count
order by campaigns.name;
```

## 6. Consistency Checks

### Coupon counters coerenti con redemptions

```sql
select
    coupons.code,
    coupons.redemptions_count as stored_count,
    count(redemptions.id) as actual_count
from coupons
left join redemptions on redemptions.coupon_id = coupons.id
group by coupons.id, coupons.code, coupons.redemptions_count
having coupons.redemptions_count <> count(redemptions.id)
order by coupons.code;
```

Atteso:

```text
0 rows
```

### Campaign counters coerenti con redemptions

```sql
select
    campaigns.name,
    campaigns.redemptions_count as stored_count,
    count(redemptions.id) as actual_count
from campaigns
left join coupons on coupons.campaign_id = campaigns.id
left join redemptions on redemptions.coupon_id = coupons.id
group by campaigns.id, campaigns.name, campaigns.redemptions_count
having campaigns.redemptions_count <> count(redemptions.id)
order by campaigns.name;
```

Atteso:

```text
0 rows
```

### Nessun counter oltre maxRedemptions

```sql
select 'campaign' as entity, name as identifier, redemptions_count, max_redemptions
from campaigns
where max_redemptions is not null
  and redemptions_count > max_redemptions
union all
select 'coupon' as entity, code as identifier, redemptions_count, max_redemptions
from coupons
where max_redemptions is not null
  and redemptions_count > max_redemptions;
```

Atteso:

```text
0 rows
```

### Doppie redemption stesso user/coupon

```sql
select
    user_id,
    coupon_id,
    count(*) as duplicates
from redemptions
group by user_id, coupon_id
having count(*) > 1;
```

Atteso:

```text
0 rows
```

## 7. Crea Dati Manuali Per Flow API

### Nuovo user

```sql
insert into users (email, role)
values ('manual-user@example.com', 'user')
on conflict (email) do update set email = excluded.email
returning id, email, role;
```

### Dieci user per prove parallele

```sql
insert into users (email, role)
select 'parallel-user-' || gs || '@example.com', 'user'
from generate_series(1, 10) gs
on conflict (email) do update set email = excluded.email
returning id, email;
```

### Campaign attiva

```sql
insert into campaigns (
    name,
    description,
    status,
    start_timestamp,
    end_timestamp,
    max_redemptions
)
values (
    'SQL Manual Active Campaign',
    'Created directly from SQL',
    'available',
    now() - interval '1 day',
    now() + interval '30 days',
    5
)
on conflict (name) do nothing
returning *;
```

### Coupon attivo per campaign SQL

```sql
insert into coupons (
    code,
    status,
    expiration_timestamp,
    max_redemptions,
    campaign_id
)
select
    'SQL-MANUAL-10',
    'available',
    now() + interval '30 days',
    2,
    campaigns.id
from campaigns
where campaigns.name = 'SQL Manual Active Campaign'
on conflict (code) do nothing
returning *;
```

### Campaign futura

```sql
insert into campaigns (
    name,
    description,
    status,
    start_timestamp,
    end_timestamp,
    max_redemptions
)
values (
    'SQL Future Campaign',
    'Future campaign for listing versus redeem checks',
    'available',
    now() + interval '7 days',
    now() + interval '30 days',
    null
)
on conflict (name) do nothing
returning *;
```

### Coupon per campaign futura

```sql
insert into coupons (
    code,
    status,
    expiration_timestamp,
    max_redemptions,
    campaign_id
)
select
    'SQL-FUTURE-10',
    'available',
    now() + interval '30 days',
    null,
    campaigns.id
from campaigns
where campaigns.name = 'SQL Future Campaign'
on conflict (code) do nothing
returning *;
```

### Coupon con zero redemptions disponibili

```sql
insert into coupons (
    code,
    status,
    expiration_timestamp,
    max_redemptions,
    campaign_id
)
select
    'ZERO-LIMIT',
    'available',
    now() + interval '30 days',
    0,
    campaigns.id
from campaigns
where campaigns.name = 'Spring Wellness Campaign'
on conflict (code) do nothing
returning *;
```

Redeem atteso per `ZERO-LIMIT`:

```text
409 COUPON_REDEMPTION_LIMIT_REACHED
```

## 8. Modifica Stati Per Test Mirati

### Metti coupon not-available

```sql
update coupons
set status = 'not-available'
where code = 'SPRING10'
returning code, status, updated_at;
```

### Rimetti coupon available

```sql
update coupons
set status = 'available'
where code = 'SPRING10'
returning code, status, updated_at;
```

### Scadi un coupon

```sql
update coupons
set expiration_timestamp = now() - interval '1 minute'
where code = 'SPRING10'
returning code, expiration_timestamp;
```

### Rimetti coupon valido

```sql
update coupons
set expiration_timestamp = now() + interval '30 days'
where code = 'SPRING10'
returning code, expiration_timestamp;
```

### Metti campaign not-available

```sql
update campaigns
set status = 'not-available'
where name = 'Spring Wellness Campaign'
returning name, status, updated_at;
```

### Rimetti campaign available

```sql
update campaigns
set status = 'available'
where name = 'Spring Wellness Campaign'
returning name, status, updated_at;
```

### Sposta campaign nel futuro

```sql
update campaigns
set start_timestamp = now() + interval '7 days',
    end_timestamp = now() + interval '37 days'
where name = 'Spring Wellness Campaign'
returning name, start_timestamp, end_timestamp;
```

### Rimetti campaign attiva

```sql
update campaigns
set start_timestamp = now() - interval '1 day',
    end_timestamp = now() + interval '30 days'
where name = 'Spring Wellness Campaign'
returning name, start_timestamp, end_timestamp;
```

### Porta coupon al limite

```sql
update coupons
set redemptions_count = max_redemptions
where code = 'SPRING10'
  and max_redemptions is not null
returning code, redemptions_count, max_redemptions;
```

Nota: questa modifica crea uno stato artificiale e puo rendere incoerenti counters e redemptions. Usala solo per forzare risposte API, poi fai reset.

## 9. Pulizia Selettiva

### Cancella redemption

```sql
delete from redemptions;
```

### Reset counters coerente dopo delete redemptions

```sql
update coupons
set redemptions_count = 0;

update campaigns
set redemptions_count = 0;
```

### Cancella dati manuali

Ordine obbligatorio: prima redemptions, poi coupons, poi campaigns/users.

```sql
delete from redemptions
where coupon_id in (
    select id from coupons
    where code like 'MANUAL-%'
       or code like 'SPRING-MANUAL-%'
       or code like 'CAMP-LIMIT-%'
       or code like 'SQL-%'
       or code = 'ZERO-LIMIT'
);

delete from coupons
where code like 'MANUAL-%'
   or code like 'SPRING-MANUAL-%'
   or code like 'CAMP-LIMIT-%'
   or code like 'SQL-%'
   or code = 'ZERO-LIMIT';

delete from campaigns
where name like 'Manual Campaign%'
   or name like 'Expired Manual Campaign%'
   or name like 'Invalid Window%'
   or name like 'Invalid Status%'
   or name like 'Unlimited Campaign%'
   or name like 'Campaign Limit%'
   or name like 'SQL %';

delete from users
where email like 'manual-user%@example.com'
   or email like 'parallel-user-%@example.com';
```

## 10. Reset Totale

Da shell:

```bash
docker compose down -v
docker compose up -d --build
```

Questo ricrea il volume, esegue:

```text
migrations/001_create_schema.sql
db/002_seed_test_data.sql
```

e torna allo stato iniziale:

```text
4 campaigns
7 coupons
3 users
0 redemptions
```

## 10.1 Migration Tracking

```sql
select name, checksum, applied_at
from schema_migrations
order by applied_at;
```

Atteso:

```text
001_create_schema.sql
```

## 11. Lock E Transazioni

Durante un redeem, la API usa:

```sql
select ...
from coupons
join campaigns on campaigns.id = coupons.campaign_id
where coupons.code = $1
for update of coupons, campaigns;
```

Per osservare lock attivi mentre fai esperimenti concorrenti:

```sql
select
    pg_locks.pid,
    pg_class.relname,
    pg_locks.mode,
    pg_locks.granted,
    pg_stat_activity.query,
    pg_stat_activity.state
from pg_locks
left join pg_class on pg_class.oid = pg_locks.relation
left join pg_stat_activity on pg_stat_activity.pid = pg_locks.pid
where pg_class.relname in ('coupons', 'campaigns', 'redemptions')
order by pg_locks.pid, pg_class.relname, pg_locks.mode;
```

In condizioni normali le transazioni API sono molto brevi, quindi potresti non vedere lock persistenti.

## 12. Query Per Verificare Scelte Di Dominio

### Campaign already exists by name

```sql
select name, count(*)
from campaigns
group by name
having count(*) > 1;
```

Atteso:

```text
0 rows
```

### Coupon code unico

```sql
select code, count(*)
from coupons
group by code
having count(*) > 1;
```

Atteso:

```text
0 rows
```

### Email unica

```sql
select email, count(*)
from users
group by email
having count(*) > 1;
```

Atteso:

```text
0 rows
```

### Coupon senza scadenza

```sql
select code, expiration_timestamp
from coupons
where expiration_timestamp is null;
```

Atteso su seed:

```text
NO-EXPIRY
```

### Campaign future ma non scadute

```sql
select name, start_timestamp, end_timestamp
from campaigns
where start_timestamp > now()
  and end_timestamp >= now()
order by start_timestamp;
```

Atteso su seed:

```text
Future Nutrition Campaign
```

Nel seed questa campagna parte il `2026-09-01`, quindi resta futura per una verifica eseguita nei giorni successivi alla consegna.
