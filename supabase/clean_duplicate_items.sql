-- Clean up duplicate catalog items.
--
-- Keeps ONE row per unique (business, name, price, description) combination,
-- preserving the earliest-created row. The two "Cat 3 Telephone" entries
-- ($42.00 and $3.75) have different prices, so both are kept.
--
-- STEP 1 (optional preview): run the SELECT below first to see what counts
-- as duplicated before deleting anything.
-- STEP 2: run the DELETE to remove the extras.

-- ============ STEP 1: preview duplicates ============
-- select
--   b.display_name as business,
--   i.name,
--   i.default_rate_cents / 100.0 as price,
--   count(*) as copies
-- from public.items i
-- join public.businesses b on b.id = i.business_id
-- group by b.display_name, i.name, i.default_rate_cents, coalesce(i.description, ''), coalesce(i.item_code, ''), i.unit_label
-- having count(*) > 1
-- order by copies desc;

-- ============ STEP 2: delete duplicates, keep earliest ============
with ranked as (
  select
    id,
    row_number() over (
      partition by
        business_id,
        name,
        default_rate_cents,
        coalesce(description, ''),
        coalesce(item_code, ''),
        unit_label
      order by created_at asc, id asc
    ) as rn
  from public.items
),
deleted as (
  delete from public.items
  where id in (select id from ranked where rn > 1)
  returning id
)
select count(*) as duplicates_removed from deleted;
