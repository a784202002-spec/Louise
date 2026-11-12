-- =====================================================================
-- 請假登記表：Supabase 建表 SQL
-- 用途：建立請假資料表 leave_requests 與主管名單 leave_managers，
--       並設定三層安全（CHECK、GRANT、RLS）。
-- 使用方式：在 Supabase 的 SQL Editor 貼上整份執行。可重複執行。
-- 注意：本檔案只產生、尚未執行過。
--
-- 權限設計（依需求筆記「誰能做什麼」）：
--   ・未登入（anon）：什麼都看不到，也不能新增。→ anon 不給任何權限。
--   ・一般同仁（已登入）：只能新增自己的請假，只能看自己的紀錄。
--   ・主管（已登入，且列在 leave_managers）：能看全部，只能修改審核狀態。
--   ・任何人都不能刪除紀錄。
--
-- 待確認：需求筆記還沒決定「登入方式」與「怎麼判斷誰是主管」。
--   這裡先假設使用 Supabase Auth 登入，主管名單放在 leave_managers 表，
--   由管理者在 Supabase 後台手動維護。決定後可能需要調整。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、資料表與 CHECK 限制
-- 用 CHECK 在資料庫層限制欄位值、文字長度與時間順序，
-- 就算前端被繞過也擋得住。
-- 文字欄位先去掉前後空白（btrim）再算長度，避免只填空白就送出。
-- 字數與時數上限是示範用的假設值，和 文件/欄位表.xlsx 一致。
-- ---------------------------------------------------------------------
create table if not exists public.leave_requests (
  -- 主鍵：由資料庫自動產生
  id             uuid          primary key default gen_random_uuid(),

  -- 登記時間：由資料庫自動產生
  created_at     timestamptz   not null default now(),

  -- 請假人帳號：自動帶入登入者的帳號編號，用來判斷「只能看自己的紀錄」
  -- 帳號被刪除時，不連帶刪除請假紀錄（restrict），避免紀錄消失
  user_id        uuid          not null default auth.uid()
                               references auth.users (id) on delete restrict,

  -- 請假人姓名：必填，1～50 字（示範一律使用虛構姓名）
  applicant_name text          not null
    constraint leave_requests_applicant_name_length
      check (char_length(btrim(applicant_name)) between 1 and 50),

  -- 假別：必填，只能是下列八種
  leave_type     text          not null
    constraint leave_requests_leave_type_allowed
      check (leave_type in ('特休', '事假', '病假', '補休', '公假', '婚假', '喪假', '其他')),

  -- 開始與結束日期時間：必填
  start_at       timestamptz   not null,
  end_at         timestamptz   not null,

  -- 請假時數：必填，大於 0、最多 240 小時，以 0.5 小時為單位（假設值，待確認）
  hours          numeric(5, 1) not null
    constraint leave_requests_hours_range
      check (hours > 0 and hours <= 240 and hours * 2 = trunc(hours * 2)),

  -- 職務代理人：是否必填待確認，先允許空白；有填時 1～50 字
  deputy_name    text
    constraint leave_requests_deputy_name_length
      check (deputy_name is null or char_length(btrim(deputy_name)) between 1 and 50),

  -- 事由：必填，1～200 字。可能涉及健康等私人資訊，請簡短填寫
  reason         text          not null
    constraint leave_requests_reason_length
      check (char_length(btrim(reason)) between 1 and 200),

  -- 審核狀態：只能是 待審核／已核准／已退回，新增時預設「待審核」
  status         text          not null default '待審核'
    constraint leave_requests_status_allowed
      check (status in ('待審核', '已核准', '已退回')),

  -- 時間順序：結束時間必須晚於開始時間
  constraint leave_requests_time_order
    check (end_at > start_at)
);

comment on table  public.leave_requests                is '請假紀錄（示範資料，全為虛構）';
comment on column public.leave_requests.id             is '主鍵，自動產生';
comment on column public.leave_requests.created_at     is '登記時間，自動產生';
comment on column public.leave_requests.user_id        is '請假人帳號，自動帶入登入者';
comment on column public.leave_requests.applicant_name is '請假人姓名';
comment on column public.leave_requests.leave_type     is '假別：特休／事假／病假／補休／公假／婚假／喪假／其他';
comment on column public.leave_requests.start_at       is '開始日期與時間';
comment on column public.leave_requests.end_at         is '結束日期與時間';
comment on column public.leave_requests.hours          is '請假時數';
comment on column public.leave_requests.deputy_name    is '職務代理人';
comment on column public.leave_requests.reason         is '事由';
comment on column public.leave_requests.status         is '審核狀態：待審核／已核准／已退回';

-- 同仁查自己的紀錄、主管依登記時間看全部，各加一個索引讓查詢變快
create index if not exists leave_requests_user_id_idx
  on public.leave_requests (user_id, created_at desc);
create index if not exists leave_requests_created_at_idx
  on public.leave_requests (created_at desc);


-- ---------------------------------------------------------------------
-- 二、主管名單與判斷函式
-- leave_managers 只記錄「哪些帳號是主管」。
-- 這張表不開放給前端讀寫，只能由管理者在 Supabase 後台新增或移除。
-- is_leave_manager() 用 security definer 執行，前端不需要讀取權限，
-- 也只能查到「自己是不是主管」，看不到整份名單。
-- ---------------------------------------------------------------------
create table if not exists public.leave_managers (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.leave_managers is '主管名單：列在這裡的帳號可以看全部請假紀錄並審核';

create or replace function public.is_leave_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leave_managers where user_id = auth.uid()
  );
$$;

comment on function public.is_leave_manager() is '目前登入者是否為主管';


-- ---------------------------------------------------------------------
-- 三、GRANT：資料表權限
-- 這個 Supabase 專案不會自動開放新資料表，所以要明確授權。
-- 先收回所有權限，確保沒有殘留的舊授權，再只開放需要的部分：
--
--   anon（未登入）：
--     ・需求筆記規定未登入什麼都不能做，所以 anon 不給任何權限。
--
--   authenticated（已登入，同仁與主管都是這個角色）：
--     ・SELECT：可以讀取；能讀到哪些列，由下方 RLS 決定。
--     ・INSERT：只能新增同仁要填的七個欄位。
--       不開放 id、created_at、user_id、status，這四個一律用預設值，
--       所以請假人一定是登入者本人，狀態一定是「待審核」。
--     ・UPDATE：只能修改 status 一個欄位；誰能改由下方 RLS 限制為主管。
--     ・不給 DELETE、TRUNCATE，沒有人能刪除紀錄。
--
--   leave_managers 表：不給 anon 與 authenticated 任何權限。
--   is_leave_manager() 函式：只讓 authenticated 執行。
-- ---------------------------------------------------------------------
revoke all on table public.leave_requests from public, anon, authenticated;
revoke all on table public.leave_managers from public, anon, authenticated;

grant select on table public.leave_requests to authenticated;

grant insert (applicant_name, leave_type, start_at, end_at, hours, deputy_name, reason)
  on table public.leave_requests to authenticated;

grant update (status) on table public.leave_requests to authenticated;

revoke all on function public.is_leave_manager() from public, anon;
grant execute on function public.is_leave_manager() to authenticated;


-- ---------------------------------------------------------------------
-- 四、RLS：資料列安全
-- 啟用 RLS 後，沒有政策允許的操作一律被拒絕。
-- 這是 GRANT 之外的第二道防線：就算之後有人不小心多給了權限，
-- 沒有對應的政策，該操作仍然做不到。
-- 所有政策都只對 authenticated；anon 沒有任何政策。
-- auth.uid() 外面包一層 select，讓資料庫每次查詢只算一次，效能較好。
-- 先刪除同名政策再建立，讓這份檔案可以重複執行。
-- ---------------------------------------------------------------------
alter table public.leave_requests enable row level security;
alter table public.leave_managers enable row level security;
-- leave_managers 刻意不建立任何政策：前端完全讀寫不到。

-- 讀取：同仁只能看到自己的紀錄
drop policy if exists "同仁可以讀取自己的請假" on public.leave_requests;
create policy "同仁可以讀取自己的請假"
  on public.leave_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 讀取：主管可以看到全部紀錄
drop policy if exists "主管可以讀取全部請假" on public.leave_requests;
create policy "主管可以讀取全部請假"
  on public.leave_requests
  for select
  to authenticated
  using ((select public.is_leave_manager()));

-- 新增：只能替自己請假，且狀態只能是「待審核」
drop policy if exists "同仁可以新增自己的請假，狀態限待審核" on public.leave_requests;
create policy "同仁可以新增自己的請假，狀態限待審核"
  on public.leave_requests
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = '待審核'
  );

-- 修改：只有主管能改，而且只能改成「已核准」或「已退回」
-- （GRANT 已經限制只能改 status 欄位）
-- 審核後能不能再改、能不能改回待審核：待確認，目前允許主管重新改判。
drop policy if exists "主管可以審核請假" on public.leave_requests;
create policy "主管可以審核請假"
  on public.leave_requests
  for update
  to authenticated
  using ((select public.is_leave_manager()))
  with check (
    (select public.is_leave_manager())
    and status in ('已核准', '已退回')
  );

-- 刪除：不建立任何政策，所以沒有人能刪除紀錄。
