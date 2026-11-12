-- =====================================================================
-- 報修登記系統：Supabase 建表 SQL
-- 用途：建立 repair_requests 資料表，並設定三層安全（CHECK、GRANT、RLS）。
-- 使用方式：在 Supabase 的 SQL Editor 貼上整份執行。可重複執行。
-- 本次示範範圍：不做登入。匿名使用者（anon）只能新增與讀取，不能修改或刪除。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、資料表與 CHECK 限制
-- 用 CHECK 在資料庫層限制欄位值與文字長度，就算前端被繞過也擋得住。
-- 文字欄位先去掉前後空白（btrim）再算長度，避免只填空白就送出。
-- 長度上限是示範用的假設值，報修需求筆記沒有寫到，之後可依實際需要調整。
-- ---------------------------------------------------------------------
create table if not exists public.repair_requests (
  -- 主鍵：由資料庫自動產生 uuid，前端不能自己指定
  id            uuid        primary key default gen_random_uuid(),

  -- 登記時間：由資料庫自動產生，前端不能自己指定
  created_at    timestamptz not null default now(),

  -- 報修人姓名：必填，1～50 字（示範一律使用虛構姓名）
  reporter_name text        not null
    constraint repair_requests_reporter_name_length
      check (char_length(btrim(reporter_name)) between 1 and 50),

  -- 地點或部門：必填，1～100 字
  location      text        not null
    constraint repair_requests_location_length
      check (char_length(btrim(location)) between 1 and 100),

  -- 類別：必填，只能是 設備／網路／環境／其他
  category      text        not null
    constraint repair_requests_category_allowed
      check (category in ('設備', '網路', '環境', '其他')),

  -- 問題說明：必填，1～1000 字
  description   text        not null
    constraint repair_requests_description_length
      check (char_length(btrim(description)) between 1 and 1000),

  -- 緊急程度：只能是 低／中／高，沒填時預設「中」
  urgency       text        not null default '中'
    constraint repair_requests_urgency_allowed
      check (urgency in ('低', '中', '高')),

  -- 處理狀態：只能是 待處理／處理中／已完成，沒填時預設「待處理」
  status        text        not null default '待處理'
    constraint repair_requests_status_allowed
      check (status in ('待處理', '處理中', '已完成'))
);

comment on table  public.repair_requests               is '報修紀錄（示範資料，全為虛構）';
comment on column public.repair_requests.id            is '主鍵，自動產生';
comment on column public.repair_requests.created_at    is '登記時間，自動產生';
comment on column public.repair_requests.reporter_name is '報修人姓名';
comment on column public.repair_requests.location      is '地點或部門';
comment on column public.repair_requests.category      is '類別：設備／網路／環境／其他';
comment on column public.repair_requests.description   is '問題說明';
comment on column public.repair_requests.urgency       is '緊急程度：低／中／高';
comment on column public.repair_requests.status        is '處理狀態：待處理／處理中／已完成';

-- 清單依登記時間由新到舊排序，加索引讓查詢變快
create index if not exists repair_requests_created_at_idx
  on public.repair_requests (created_at desc);


-- ---------------------------------------------------------------------
-- 二、GRANT：資料表權限
-- 這個 Supabase 專案不會自動開放新資料表，所以要明確授權。
-- 先收回所有權限，確保沒有殘留的舊授權，再只開放需要的部分：
--   ・anon 可以讀取（SELECT）整張表，用來顯示清單。
--   ・anon 只能新增（INSERT）報修人要填的五個欄位。
--     不開放 id、created_at、status，這三個欄位一律由資料庫預設值產生，
--     所以新增時 status 一定是「待處理」。
--   ・不給 UPDATE、DELETE、TRUNCATE，anon 不能修改或刪除任何資料。
-- 本次示範不做登入，所以 authenticated（已登入使用者）也不給任何權限。
-- ---------------------------------------------------------------------
revoke all on table public.repair_requests from public, anon, authenticated;

grant select on table public.repair_requests to anon;

grant insert (reporter_name, location, category, description, urgency)
  on table public.repair_requests to anon;


-- ---------------------------------------------------------------------
-- 三、RLS：資料列安全
-- 啟用 RLS 後，沒有政策允許的操作一律被拒絕。
-- 這是 GRANT 之外的第二道防線：就算之後有人不小心多給了權限，
-- 沒有對應的政策，修改和刪除仍然做不到。
--   ・讀取政策：任何人（anon）都可以讀取全部報修紀錄。
--   ・新增政策：任何人（anon）都可以新增，但 status 只能是「待處理」。
--   ・不建立 UPDATE、DELETE 政策，所以不能修改或刪除。
-- 先刪除同名政策再建立，讓這份檔案可以重複執行。
-- ---------------------------------------------------------------------
alter table public.repair_requests enable row level security;

drop policy if exists "任何人可以讀取報修清單" on public.repair_requests;
create policy "任何人可以讀取報修清單"
  on public.repair_requests
  for select
  to anon
  using (true);

drop policy if exists "任何人可以新增報修，狀態限待處理" on public.repair_requests;
create policy "任何人可以新增報修，狀態限待處理"
  on public.repair_requests
  for insert
  to anon
  with check (status = '待處理');
