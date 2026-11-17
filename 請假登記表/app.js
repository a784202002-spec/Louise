// 請假登記表：不登入版，只有送出表單
// 未登入的人只能送出請假，看不到任何紀錄（資料庫規則見 supabase/schema.sql）。
(function () {
  "use strict";

  var TABLE = "leave_requests";
  var LEAVE_TYPES = ["特休", "事假", "病假", "補休", "公假", "婚假", "喪假", "其他"];
  var MAX_LENGTH = { applicant_name: 50, deputy_name: 50, reason: 200 };

  var form = document.getElementById("leave-form");
  var submitButton = document.getElementById("submit-button");
  var formMessage = document.getElementById("form-message");
  var reasonInput = document.getElementById("reason");
  var reasonCount = document.getElementById("reason-count");

  var client = createClient();

  function createClient() {
    var config = window.APP_CONFIG || {};
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!config.supabaseUrl || !config.supabaseKey) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  function showMessage(text, type) {
    formMessage.textContent = text;
    formMessage.className = "message " + type;
    formMessage.hidden = false;
  }

  function hideMessage() {
    formMessage.hidden = true;
    formMessage.textContent = "";
  }

  // 把資料庫錯誤轉成看得懂的中文
  function describeError(error) {
    if (!error) return "發生未知錯誤。";
    var code = error.code || "";
    var msg = error.message || "";
    if (code === "42501") return "沒有權限送出，請確認已在 Supabase 執行最新的 supabase/schema.sql。";
    if (code === "23514") return "資料不符合規定（例如時數、時間順序或字數），請檢查後再送出。";
    if (code === "23502") return "有必填欄位沒有填寫。";
    if (code === "42P01" || code === "PGRST205") return "找不到請假資料表，請確認已在 Supabase 執行 supabase/schema.sql。";
    if (/fetch|network/i.test(msg)) return "無法連線到伺服器，請檢查網路後再試一次。";
    return msg || "發生未知錯誤。";
  }

  // ---------- 表單驗證 ----------
  function getChoice(name) {
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : "";
  }

  function setInvalid(el, invalid) {
    var wrapper = el.closest(".field");
    if (wrapper) wrapper.classList.toggle("invalid", invalid);
  }

  function toIso(localValue) {
    if (!localValue) return null;
    var d = new Date(localValue); // datetime-local 依使用者裝置的時區解讀
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // 只組出 schema.sql 允許新增的七個欄位；
  // id、created_at、user_id、status 由資料庫自動產生，不送。
  function readForm() {
    var errors = [];
    var name = form.applicant_name.value.trim();
    var deputy = form.deputy_name.value.trim();
    var reason = form.reason.value.trim();
    var leaveType = getChoice("leave_type");
    var startIso = toIso(form.start_at.value);
    var endIso = toIso(form.end_at.value);
    var hoursText = form.hours.value.trim();
    var hours = Number(hoursText);

    function check(el, bad, message) {
      setInvalid(el, bad);
      if (bad) errors.push(message);
    }

    check(form.applicant_name, !name, "請填寫「請假人姓名」");
    if (name.length > MAX_LENGTH.applicant_name) check(form.applicant_name, true, "「請假人姓名」最多 50 字");

    check(form.querySelector('input[name="leave_type"]'), LEAVE_TYPES.indexOf(leaveType) === -1, "請選擇「假別」");

    check(form.start_at, !startIso, "請填寫「開始日期與時間」");
    check(form.end_at, !endIso, "請填寫「結束日期與時間」");
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      check(form.end_at, true, "結束時間必須晚於開始時間");
    }

    var hoursOk = hoursText !== "" && isFinite(hours) && hours > 0 && hours <= 240 && hours * 2 === Math.floor(hours * 2);
    check(form.hours, !hoursOk, "「請假時數」需介於 0.5 到 240，且以 0.5 小時為單位");

    check(form.deputy_name, deputy.length > MAX_LENGTH.deputy_name, "「職務代理人」最多 50 字");

    check(form.reason, !reason, "請填寫「事由」");
    if (reason.length > MAX_LENGTH.reason) check(form.reason, true, "「事由」最多 200 字");

    return {
      errors: errors,
      data: {
        applicant_name: name,
        leave_type: leaveType,
        start_at: startIso,
        end_at: endIso,
        hours: hours,
        deputy_name: deputy || null,
        reason: reason,
      },
    };
  }

  // ---------- 送出 ----------
  async function handleSubmit(event) {
    event.preventDefault();
    hideMessage();

    var result = readForm();
    if (result.errors.length) {
      showMessage(result.errors.join("；") + "。", "error");
      var firstInvalid = form.querySelector(".field.invalid input, .field.invalid textarea");
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    if (!client) {
      showMessage("系統設定有誤，無法連線到資料庫。", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "送出中…";
    try {
      // 不加 .select()：未登入沒有讀取權限，所以不要求資料庫回傳剛新增的資料
      var response = await client.from(TABLE).insert(result.data);
      if (response.error) {
        showMessage("送出失敗：" + describeError(response.error), "error");
        return;
      }
      showMessage("已送出請假，狀態為「待審核」，請等候主管審核。", "ok");
      form.reset();
      updateCount();
    } catch (err) {
      showMessage("送出失敗：" + describeError(err), "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "送出請假";
    }
  }

  function updateCount() {
    reasonCount.textContent = String(reasonInput.value.length);
  }

  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", function (e) {
    var wrapper = e.target.closest(".field");
    if (wrapper) wrapper.classList.remove("invalid");
  });
  reasonInput.addEventListener("input", updateCount);
})();
