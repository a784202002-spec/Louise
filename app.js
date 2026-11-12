// 報修登記：表單送出與清單顯示
(function () {
  "use strict";

  var TABLE = "repair_requests";
  var LIST_LIMIT = 20;
  var CATEGORIES = ["設備", "網路", "環境", "其他"];
  var URGENCIES = ["低", "中", "高"];
  var MAX_LENGTH = { reporter_name: 50, location: 100, description: 1000 };

  var form = document.getElementById("repair-form");
  var submitButton = document.getElementById("submit-button");
  var formMessage = document.getElementById("form-message");
  var list = document.getElementById("repair-list");
  var listMessage = document.getElementById("list-message");
  var refreshButton = document.getElementById("refresh-button");
  var descInput = document.getElementById("description");
  var descCount = document.getElementById("description-count");

  var client = createClient();

  function createClient() {
    var config = window.APP_CONFIG || {};
    if (!window.supabase || !window.supabase.createClient) {
      return null;
    }
    if (!config.supabaseUrl || !config.supabaseKey) {
      return null;
    }
    return window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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

  // 把資料庫錯誤轉成看得懂的中文
  function describeError(error) {
    if (!error) return "發生未知錯誤。";
    var code = error.code || "";
    if (code === "42501") return "沒有權限執行這個動作，請確認資料庫的存取規則已設定。";
    if (code === "23514") return "資料不符合規定（例如類別或緊急程度不正確、文字太長），請檢查後再送出。";
    if (code === "23502") return "有必填欄位沒有填寫。";
    if (code === "42P01" || code === "PGRST205") return "找不到報修資料表，請確認已在 Supabase 執行 supabase/schema.sql。";
    if (error.message && /fetch|network/i.test(error.message)) return "無法連線到伺服器，請檢查網路後再試一次。";
    return error.message || "發生未知錯誤。";
  }

  // ---------- 表單驗證 ----------
  function getChoice(name) {
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : "";
  }

  function setInvalid(fieldEl, invalid) {
    var wrapper = fieldEl.closest(".field");
    if (wrapper) wrapper.classList.toggle("invalid", invalid);
  }

  function readForm() {
    var data = {
      reporter_name: form.reporter_name.value.trim(),
      location: form.location.value.trim(),
      category: getChoice("category"),
      description: form.description.value.trim(),
      urgency: getChoice("urgency") || "中",
      // 不送 status：由資料庫預設為「待處理」
    };

    var errors = [];
    var checks = [
      [form.reporter_name, data.reporter_name, "報修人"],
      [form.location, data.location, "地點或部門"],
      [form.description, data.description, "問題說明"],
    ];
    checks.forEach(function (c) {
      var empty = c[1].length === 0;
      var tooLong = c[1].length > MAX_LENGTH[c[0].name];
      setInvalid(c[0], empty || tooLong);
      if (empty) errors.push("請填寫「" + c[2] + "」");
      else if (tooLong) errors.push("「" + c[2] + "」最多 " + MAX_LENGTH[c[0].name] + " 字");
    });

    var categoryOk = CATEGORIES.indexOf(data.category) !== -1;
    setInvalid(form.querySelector('input[name="category"]'), !categoryOk);
    if (!categoryOk) errors.push("請選擇「類別」");

    if (URGENCIES.indexOf(data.urgency) === -1) errors.push("「緊急程度」不正確");

    return { data: data, errors: errors };
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
    if (!client) {
      showMessage(formMessage, "系統設定有誤，無法連線到資料庫。", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "送出中…";
    try {
      var response = await client.from(TABLE).insert(result.data);
      if (response.error) {
        showMessage(formMessage, "送出失敗：" + describeError(response.error), "error");
        return;
      }
      showMessage(formMessage, "已送出報修，謝謝！", "ok");
      form.reset();
      updateCount();
      await loadList();
    } catch (err) {
      showMessage(formMessage, "送出失敗：" + describeError(err), "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "送出報修";
    }
  }

  // ---------- 清單 ----------
  var timeFormatter = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  function formatTime(value) {
    var date = new Date(value);
    return isNaN(date.getTime()) ? "" : timeFormatter.format(date);
  }

  function makeTag(text, extraClass) {
    var span = document.createElement("span");
    span.className = "tag" + (extraClass ? " " + extraClass : "");
    span.textContent = text;
    return span;
  }

  // 全部用 textContent 放入文字，避免使用者輸入的內容被當成 HTML 執行
  function renderItem(row) {
    var li = document.createElement("li");
    li.className = "repair-item";

    var meta = document.createElement("div");
    meta.className = "repair-meta";
    meta.appendChild(makeTag(row.category));
    meta.appendChild(makeTag("緊急：" + row.urgency, "urgency-" + row.urgency));
    meta.appendChild(makeTag(row.status));
    var time = document.createElement("time");
    time.className = "repair-time";
    time.dateTime = row.created_at;
    time.textContent = formatTime(row.created_at);
    meta.appendChild(time);

    var desc = document.createElement("p");
    desc.className = "repair-desc";
    desc.textContent = row.description;

    var who = document.createElement("div");
    who.className = "repair-who";
    who.textContent = row.reporter_name + "・" + row.location;

    li.appendChild(meta);
    li.appendChild(desc);
    li.appendChild(who);
    return li;
  }

  async function loadList() {
    if (!client) {
      showMessage(listMessage, "系統設定有誤，無法連線到資料庫。", "error");
      return;
    }
    refreshButton.disabled = true;
    if (!list.children.length) showMessage(listMessage, "載入中…", "info");
    try {
      var response = await client
        .from(TABLE)
        .select("id, created_at, reporter_name, location, category, description, urgency, status")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);

      if (response.error) {
        showMessage(listMessage, "清單載入失敗：" + describeError(response.error), "error");
        return;
      }
      list.replaceChildren.apply(list, response.data.map(renderItem));
      if (response.data.length === 0) showMessage(listMessage, "目前還沒有報修紀錄。", "info");
      else hideMessage(listMessage);
    } catch (err) {
      showMessage(listMessage, "清單載入失敗：" + describeError(err), "error");
    } finally {
      refreshButton.disabled = false;
    }
  }

  function updateCount() {
    descCount.textContent = String(descInput.value.length);
  }

  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", function (e) {
    var wrapper = e.target.closest(".field");
    if (wrapper) wrapper.classList.remove("invalid");
  });
  descInput.addEventListener("input", updateCount);
  refreshButton.addEventListener("click", loadList);

  loadList();
})();
