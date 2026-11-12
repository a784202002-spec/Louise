// 請假登記表：登入、新增請假、清單與主管審核
(function () {
  "use strict";

  var TABLE = "leave_requests";
  var LIST_LIMIT = 20;
  var LEAVE_TYPES = ["特休", "事假", "病假", "補休", "公假", "婚假", "喪假", "其他"];
  var MAX_LENGTH = { applicant_name: 50, deputy_name: 50, reason: 200 };

  var $ = function (id) { return document.getElementById(id); };
  var loginSection = $("login-section");
  var loginForm = $("login-form");
  var loginButton = $("login-button");
  var loginMessage = $("login-message");
  var appSection = $("app-section");
  var userBox = $("user-box");
  var userLabel = $("user-label");
  var headerHint = $("header-hint");
  var logoutButton = $("logout-button");
  var form = $("leave-form");
  var submitButton = $("submit-button");
  var formMessage = $("form-message");
  var list = $("leave-list");
  var listScope = $("list-scope");
  var listMessage = $("list-message");
  var refreshButton = $("refresh-button");
  var reasonInput = $("reason");
  var reasonCount = $("reason-count");

  var client = createClient();
  var currentUser = null;
  var isManager = false;

  function createClient() {
    var config = window.APP_CONFIG || {};
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!config.supabaseUrl || !config.supabaseKey) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  }

  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = "message " + type;
    el.hidden = false;
  }

  function hideMessage(el) {
    el.hidden = true;
    el.textContent = "";
  }

  // 把錯誤轉成看得懂的中文
  function describeError(error) {
    if (!error) return "發生未知錯誤。";
    var code = error.code || "";
    var msg = error.message || "";
    if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "Email 或密碼不正確。";
    if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) return "這個 Email 還沒有完成驗證。";
    if (code === "42501") return "沒有權限執行這個動作。";
    if (code === "23514") return "資料不符合規定（例如時數、時間順序或字數），請檢查後再送出。";
    if (code === "23502") return "有必填欄位沒有填寫。";
    if (code === "42P01" || code === "PGRST205") return "找不到請假資料表，請確認已在 Supabase 執行 supabase/schema.sql。";
    if (code === "PGRST301" || /jwt/i.test(msg)) return "登入已過期，請重新登入。";
    if (/fetch|network/i.test(msg)) return "無法連線到伺服器，請檢查網路後再試一次。";
    return msg || "發生未知錯誤。";
  }

  function setBusy(button, busy, busyText, idleText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }

  // ---------- 登入與登出 ----------
  async function handleLogin(event) {
    event.preventDefault();
    hideMessage(loginMessage);
    var email = loginForm.email.value.trim();
    var password = loginForm.password.value;
    if (!email || !password) {
      showMessage(loginMessage, "請輸入 Email 和密碼。", "error");
      return;
    }
    if (!client) {
      showMessage(loginMessage, "系統設定有誤，無法連線到資料庫。", "error");
      return;
    }
    setBusy(loginButton, true, "登入中…", "登入");
    try {
      var result = await client.auth.signInWithPassword({ email: email, password: password });
      if (result.error) {
        showMessage(loginMessage, "登入失敗：" + describeError(result.error), "error");
        return;
      }
      loginForm.password.value = "";
      await enterApp(result.data.user);
    } catch (err) {
      showMessage(loginMessage, "登入失敗：" + describeError(err), "error");
    } finally {
      setBusy(loginButton, false, "登入中…", "登入");
    }
  }

  async function handleLogout() {
    logoutButton.disabled = true;
    try {
      await client.auth.signOut();
    } finally {
      logoutButton.disabled = false;
      leaveApp();
    }
  }

  async function enterApp(user) {
    currentUser = user;
    isManager = false;
    try {
      var rpc = await client.rpc("is_leave_manager");
      isManager = !rpc.error && rpc.data === true;
    } catch (err) {
      isManager = false;
    }
    userLabel.textContent = (user.email || "已登入") + (isManager ? "（主管）" : "");
    headerHint.textContent = isManager
      ? "你是主管：可以看到部門全部請假，並核准或退回。"
      : "填寫下方表單送出請假，送出後由主管審核。";
    listScope.textContent = isManager ? "顯示部門全部請假。" : "只顯示你自己的請假。";
    loginSection.hidden = true;
    appSection.hidden = false;
    userBox.hidden = false;
    await loadList();
  }

  function leaveApp() {
    currentUser = null;
    isManager = false;
    appSection.hidden = true;
    userBox.hidden = true;
    loginSection.hidden = false;
    headerHint.textContent = "請先登入。帳號由部門管理者建立。";
    list.replaceChildren();
    hideMessage(formMessage);
    hideMessage(listMessage);
    form.reset();
    updateCount();
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

    var typeOk = LEAVE_TYPES.indexOf(leaveType) !== -1;
    check(form.querySelector('input[name="leave_type"]'), !typeOk, "請選擇「假別」");

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
    hideMessage(formMessage);

    var result = readForm();
    if (result.errors.length) {
      showMessage(formMessage, result.errors.join("；") + "。", "error");
      var firstInvalid = form.querySelector(".field.invalid input, .field.invalid textarea");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    setBusy(submitButton, true, "送出中…", "送出請假");
    try {
      var response = await client.from(TABLE).insert(result.data);
      if (response.error) {
        showMessage(formMessage, "送出失敗：" + describeError(response.error), "error");
        return;
      }
      showMessage(formMessage, "已送出請假，狀態為「待審核」。", "ok");
      form.reset();
      updateCount();
      await loadList();
    } catch (err) {
      showMessage(formMessage, "送出失敗：" + describeError(err), "error");
    } finally {
      setBusy(submitButton, false, "送出中…", "送出請假");
    }
  }

  // ---------- 清單 ----------
  var dateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  var fullFormatter = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function fmt(formatter, value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? "" : formatter.format(d);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // 一律用 textContent，避免內容被當成 HTML 執行
    return node;
  }

  function renderItem(row) {
    var li = el("li", "leave-item");

    var top = el("div", "leave-top");
    top.appendChild(el("span", "leave-name", row.applicant_name));
    top.appendChild(el("span", "tag", row.leave_type));
    top.appendChild(el("span", "tag status-" + row.status, row.status));
    li.appendChild(top);

    li.appendChild(el("div", "leave-period",
      fmt(dateTimeFormatter, row.start_at) + " → " + fmt(dateTimeFormatter, row.end_at)));

    var detail = "共 " + Number(row.hours) + " 小時";
    if (row.deputy_name) detail += "・代理人：" + row.deputy_name;
    li.appendChild(el("div", "leave-detail", detail));

    li.appendChild(el("p", "leave-reason", row.reason));
    li.appendChild(el("div", "leave-created", "登記於 " + fmt(fullFormatter, row.created_at)));

    // 主管審核按鈕：只在「待審核」且不是自己的請假時顯示
    // （資料庫沒有禁止主管審核自己的請假，這裡只是畫面上不提供）
    if (isManager && row.status === "待審核" && currentUser && row.user_id !== currentUser.id) {
      var actions = el("div", "leave-actions");
      var approve = el("button", "approve", "核准");
      var reject = el("button", "reject", "退回");
      approve.type = reject.type = "button";
      approve.addEventListener("click", function () { review(row.id, "已核准", actions); });
      reject.addEventListener("click", function () { review(row.id, "已退回", actions); });
      actions.appendChild(approve);
      actions.appendChild(reject);
      li.appendChild(actions);
    }
    return li;
  }

  async function loadList() {
    refreshButton.disabled = true;
    if (!list.children.length) showMessage(listMessage, "載入中…", "info");
    try {
      var response = await client
        .from(TABLE)
        .select("id, created_at, user_id, applicant_name, leave_type, start_at, end_at, hours, deputy_name, reason, status")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);

      if (response.error) {
        showMessage(listMessage, "清單載入失敗：" + describeError(response.error), "error");
        return;
      }
      list.replaceChildren.apply(list, response.data.map(renderItem));
      if (response.data.length === 0) showMessage(listMessage, "目前還沒有請假紀錄。", "info");
      else hideMessage(listMessage);
    } catch (err) {
      showMessage(listMessage, "清單載入失敗：" + describeError(err), "error");
    } finally {
      refreshButton.disabled = false;
    }
  }

  // 主管審核：只送 status 一個欄位
  async function review(id, status, actions) {
    var buttons = actions.querySelectorAll("button");
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var response = await client.from(TABLE).update({ status: status }).eq("id", id);
      if (response.error) {
        showMessage(listMessage, "審核失敗：" + describeError(response.error), "error");
        buttons.forEach(function (b) { b.disabled = false; });
        return;
      }
      showMessage(listMessage, "已將這筆請假改為「" + status + "」。", "ok");
      await loadList();
      showMessage(listMessage, "已將這筆請假改為「" + status + "」。", "ok");
    } catch (err) {
      showMessage(listMessage, "審核失敗：" + describeError(err), "error");
      buttons.forEach(function (b) { b.disabled = false; });
    }
  }

  function updateCount() {
    reasonCount.textContent = String(reasonInput.value.length);
  }

  // ---------- 啟動 ----------
  loginForm.addEventListener("submit", handleLogin);
  logoutButton.addEventListener("click", handleLogout);
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", function (e) {
    var wrapper = e.target.closest(".field");
    if (wrapper) wrapper.classList.remove("invalid");
  });
  reasonInput.addEventListener("input", updateCount);
  refreshButton.addEventListener("click", loadList);

  async function start() {
    if (!client) {
      showMessage(loginMessage, "系統設定有誤，無法連線到資料庫。", "error");
      loginButton.disabled = true;
      return;
    }
    // 之前登入過、還沒登出的話，直接進入
    var session = (await client.auth.getSession()).data.session;
    if (session && session.user) await enterApp(session.user);

    client.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") leaveApp();
    });
  }

  start();
})();
