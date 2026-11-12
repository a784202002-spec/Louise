// Supabase 連線設定
// 這裡只放「publishable key」（公開金鑰，開頭為 sb_publishable_），本來就會出現在瀏覽器裡，可以上傳。
// 絕對不要把 secret key（sb_secret_）或 service_role key 放進這個檔案或任何檔案。
// 資料安全靠資料庫的 GRANT 與 RLS 規則（見 supabase/schema.sql）。
window.APP_CONFIG = {
  supabaseUrl: "https://wkgowfoclmlfhibylbsp.supabase.co",
  supabaseKey: "sb_publishable_SnioPA7HtL9AlLGoItGdiQ_8_KsSTqe",
};
