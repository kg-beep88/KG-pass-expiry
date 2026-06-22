(() => {
  "use strict";

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const STORAGE_KEY = "kg-pass-license-session-v1";

  const state = {
    pin: "",
    mode: "view",
    people: [],
    items: [],
    settings: {},
    pending: new Map(),
    editingPersonId: ""
  };

  const $ = (id) => document.getElementById(id);

  const elements = {
    setupNotice: $("setupNotice"),
    connectionNotice: $("connectionNotice"),
    unlockPanel: $("unlockPanel"),
    unlockForm: $("unlockForm"),
    pinInput: $("pinInput"),
    rememberPin: $("rememberPin"),
    appContent: $("appContent"),
    accessBadge: $("accessBadge"),
    lastUpdated: $("lastUpdated"),
    refreshButton: $("refreshButton"),
    addPersonButton: $("addPersonButton"),
    logoutButton: $("logoutButton"),
    personCount: $("personCount"),
    itemCount: $("itemCount"),
    redCount: $("redCount"),
    yellowCount: $("yellowCount"),
    searchInput: $("searchInput"),
    roleFilter: $("roleFilter"),
    typeFilter: $("typeFilter"),
    statusFilter: $("statusFilter"),
    expiryCards: $("expiryCards"),
    emptyState: $("emptyState"),
    peopleList: $("peopleList"),
    personDialog: $("personDialog"),
    personForm: $("personForm"),
    dialogTitle: $("dialogTitle"),
    personIdInput: $("personIdInput"),
    nameInput: $("nameInput"),
    nicknameInput: $("nicknameInput"),
    roleInput: $("roleInput"),
    personNotesInput: $("personNotesInput"),
    itemEditorList: $("itemEditorList"),
    addPassButton: $("addPassButton"),
    addLicenseButton: $("addLicenseButton"),
    closeDialogButton: $("closeDialogButton"),
    cancelDialogButton: $("cancelDialogButton"),
    savePersonButton: $("savePersonButton"),
    deletePersonButton: $("deletePersonButton"),
    toast: $("toast")
  };

  function isConfigured() {
    const url = window.KG_PASS_CONFIG && window.KG_PASS_CONFIG.SCRIPT_URL;
    return Boolean(url && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url));
  }

  function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function daysUntil(dateText) {
    const d = parseDate(dateText);
    if (!d) return 99999;
    return Math.ceil((d.getTime() - todayStart().getTime()) / MS_PER_DAY);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function itemStatus(item) {
    const type = item.itemType === "License" ? "License" : "Pass";
    const days = daysUntil(item.expiryDate);
    const redLimit = type === "License" ? 35 : 15;
    const yellowLimit = type === "License" ? 60 : 30;

    if (days <= redLimit) return { key: "red", rank: 0, days, label: daysLabel(days), pill: "Red" };
    if (days <= yellowLimit) return { key: "yellow", rank: 1, days, label: daysLabel(days), pill: "Yellow" };
    return { key: "normal", rank: 2, days, label: daysLabel(days), pill: "Normal" };
  }

  function daysLabel(days) {
    if (days === 99999) return "No date";
    if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} expired`;
    if (days === 0) return "Expires today";
    return `${days} day${days === 1 ? "" : "s"} left`;
  }

  function getPerson(personId) {
    return state.people.find((p) => p.personId === personId) || null;
  }

  function getItemsForPerson(personId) {
    return state.items
      .filter((item) => item.personId === personId)
      .slice()
      .sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate));
  }

  function flattenItems() {
    return state.items.map((item) => {
      const person = getPerson(item.personId) || {};
      const status = itemStatus(item);
      return { ...item, person, status };
    }).sort((a, b) => {
      if (a.status.rank !== b.status.rank) return a.status.rank - b.status.rank;
      return a.status.days - b.status.days;
    });
  }

  function showToast(message, isError = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => elements.toast.classList.add("hidden"), 3200);
  }

  function showConnectionError(message) {
    elements.connectionNotice.textContent = message;
    elements.connectionNotice.classList.remove("hidden");
  }

  function clearConnectionError() {
    elements.connectionNotice.textContent = "";
    elements.connectionNotice.classList.add("hidden");
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.textContent = text || "Loading...";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.oldText || button.textContent;
      button.disabled = false;
    }
  }

  function api(action, payload = {}) {
    if (!isConfigured()) return Promise.reject(new Error("Missing Apps Script URL in config.js"));

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const callbackName = `kgPassCallback_${requestId.replace(/[^A-Za-z0-9_]/g, "_")}`;
    const baseUrl = window.KG_PASS_CONFIG.SCRIPT_URL;

    const params = new URLSearchParams({
      action,
      requestId,
      pin: state.pin,
      payload: JSON.stringify(payload || {}),
      callback: callbackName,
      _: String(Date.now())
    });

    return new Promise((resolve, reject) => {
      let script;
      let done = false;

      function cleanup() {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        if (script && script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (err) { window[callbackName] = undefined; }
      }

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Apps Script no reply. Check deployment: Execute as Me, Who has access Anyone, URL must end with /exec. Also deploy a NEW VERSION after changing Code.gs."));
      }, 30000);

      window[callbackName] = (data) => {
        cleanup();
        if (data && data.ok) resolve(data);
        else reject(new Error((data && data.error) || "Unknown backend error"));
      };

      script = document.createElement("script");
      script.src = `${baseUrl}?${params.toString()}`;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Could not load Apps Script. Check the /exec URL and deployment access setting."));
      };
      document.head.appendChild(script);
    });
  }

  async function loadData(button) {
    clearConnectionError();
    setBusy(button, true, "Refreshing...");
    try {
      const response = await api("list");
      state.mode = response.mode || "view";
      state.people = Array.isArray(response.people) ? response.people : [];
      state.items = Array.isArray(response.items) ? response.items : [];
      state.settings = response.settings || {};
      render();
      elements.unlockPanel.classList.add("hidden");
      elements.appContent.classList.remove("hidden");
      showToast("Loaded");
    } catch (error) {
      showConnectionError(error.message);
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  async function unlock(event) {
    event.preventDefault();
    state.pin = elements.pinInput.value.trim();
    if (!state.pin) return;
    setBusy(elements.unlockForm.querySelector("button"), true, "Opening...");
    clearConnectionError();
    try {
      await loadData();
      if (elements.rememberPin.checked) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ pin: state.pin }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(elements.unlockForm.querySelector("button"), false);
    }
  }

  function logout() {
    state.pin = "";
    localStorage.removeItem(STORAGE_KEY);
    elements.pinInput.value = "";
    elements.rememberPin.checked = false;
    elements.appContent.classList.add("hidden");
    elements.unlockPanel.classList.remove("hidden");
  }

  function render() {
    const canEdit = state.mode === "edit";
    elements.accessBadge.textContent = canEdit ? "Edit access" : "View only";
    elements.accessBadge.classList.toggle("edit", canEdit);
    elements.accessBadge.classList.toggle("view", !canEdit);
    elements.addPersonButton.classList.toggle("hidden", !canEdit);

    elements.personCount.textContent = String(state.people.length);
    elements.itemCount.textContent = String(state.items.length);
    const flat = flattenItems();
    elements.redCount.textContent = String(flat.filter((row) => row.status.key === "red").length);
    elements.yellowCount.textContent = String(flat.filter((row) => row.status.key === "yellow").length);
    elements.lastUpdated.textContent = `Last loaded: ${new Date().toLocaleString("en-SG", { hour12: false })}`;

    renderExpiryCards(flat);
    renderPeople();
  }

  function rowMatches(row) {
    const q = normalize(elements.searchInput.value);
    const role = elements.roleFilter.value;
    const type = elements.typeFilter.value;
    const status = elements.statusFilter.value;

    if (role !== "all" && normalize(row.person.role) !== role) return false;
    if (type !== "all" && row.itemType !== type) return false;
    if (status !== "all" && row.status.key !== status) return false;

    if (!q) return true;
    const haystack = [
      row.person.name,
      row.person.nickname,
      row.person.role,
      row.itemType,
      row.itemName,
      row.expiryDate,
      row.notes,
      row.person.notes,
      row.status.key,
      row.status.label
    ].map(normalize).join(" ");

    return q.split(/\s+/).every((term) => haystack.includes(term));
  }

  function renderExpiryCards(flat) {
    const canEdit = state.mode === "edit";
    const rows = flat.filter(rowMatches);
    elements.expiryCards.innerHTML = "";
    elements.emptyState.classList.toggle("hidden", rows.length > 0);

    rows.forEach((row) => {
      const card = document.createElement("article");
      card.className = `expiry-card ${row.status.key}`;
      const typeClass = row.itemType === "License" ? "pill-license" : "pill-pass";
      card.innerHTML = `
        <div class="expiry-main">
          <div class="expiry-title">
            <strong>${escapeHtml(row.person.name || "No name")}</strong>
            ${row.person.nickname ? `<span class="muted-text">(${escapeHtml(row.person.nickname)})</span>` : ""}
            <span class="pill ${typeClass}">${escapeHtml(row.itemType)}</span>
            <span class="pill pill-${row.status.key}">${escapeHtml(row.status.pill)}</span>
          </div>
          <div class="expiry-meta">
            <span><strong>${escapeHtml(row.itemName)}</strong></span>
            <span>Role: ${escapeHtml(row.person.role || "-")}</span>
            <span>Expiry: ${escapeHtml(formatDate(row.expiryDate))}</span>
            ${row.notes ? `<span>Note: ${escapeHtml(row.notes)}</span>` : ""}
          </div>
          ${canEdit ? `<div class="card-actions"><button class="small-button" type="button" data-edit-person="${escapeHtml(row.personId)}">Edit person</button></div>` : ""}
        </div>
        <div class="expiry-side">
          <strong>${escapeHtml(row.status.label)}</strong>
          <span>${escapeHtml(row.expiryDate || "")}</span>
        </div>
      `;
      elements.expiryCards.appendChild(card);
    });
  }

  function formatDate(value) {
    const d = parseDate(value);
    if (!d) return value || "-";
    return d.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
  }

  function renderPeople() {
    const canEdit = state.mode === "edit";
    const people = state.people.slice().sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
    elements.peopleList.innerHTML = "";

    if (!people.length) {
      elements.peopleList.innerHTML = `<div class="empty-state"><strong>No people yet.</strong><span>Use edit PIN and add the first worker/foreman.</span></div>`;
      return;
    }

    people.forEach((person) => {
      const items = getItemsForPerson(person.personId);
      const card = document.createElement("article");
      card.className = "person-card";
      card.innerHTML = `
        <h3>${escapeHtml(person.name || "No name")}${person.nickname ? ` <span class="muted-text">(${escapeHtml(person.nickname)})</span>` : ""}</h3>
        <p>${escapeHtml(person.role || "-")}${person.notes ? ` · ${escapeHtml(person.notes)}` : ""}</p>
        <div class="item-mini-list">
          ${items.map((item) => {
            const status = itemStatus(item);
            return `<span class="mini-item">${escapeHtml(item.itemName)} · ${escapeHtml(status.label)}</span>`;
          }).join("") || `<span class="mini-item">No pass/license</span>`}
        </div>
        ${canEdit ? `<div class="card-actions"><button class="small-button" type="button" data-edit-person="${escapeHtml(person.personId)}">Edit</button></div>` : ""}
      `;
      elements.peopleList.appendChild(card);
    });
  }

  function openPersonDialog(personId = "") {
    if (state.mode !== "edit") return;
    const person = personId ? getPerson(personId) : null;
    state.editingPersonId = personId;
    elements.dialogTitle.textContent = person ? "Edit person" : "Add person";
    elements.personIdInput.value = person?.personId || "";
    elements.nameInput.value = person?.name || "";
    elements.nicknameInput.value = person?.nickname || "";
    elements.roleInput.value = person?.role === "Foreman" ? "Foreman" : "Worker";
    elements.personNotesInput.value = person?.notes || "";
    elements.deletePersonButton.classList.toggle("hidden", !person);
    elements.itemEditorList.innerHTML = "";

    const items = person ? getItemsForPerson(person.personId) : [];
    if (items.length) items.forEach(addItemEditor);
    else addItemEditor({ itemType: "Pass", itemName: "", expiryDate: "", notes: "" });

    if (typeof elements.personDialog.showModal === "function") elements.personDialog.showModal();
    else elements.personDialog.setAttribute("open", "open");
    elements.nameInput.focus();
  }

  function closePersonDialog() {
    if (typeof elements.personDialog.close === "function") elements.personDialog.close();
    else elements.personDialog.removeAttribute("open");
  }

  function addItemEditor(item = {}) {
    const row = document.createElement("div");
    row.className = "item-editor";
    row.dataset.itemId = item.itemId || "";
    row.innerHTML = `
      <label>
        <span>Type</span>
        <select data-field="itemType">
          <option value="Pass" ${item.itemType === "License" ? "" : "selected"}>Site pass</option>
          <option value="License" ${item.itemType === "License" ? "selected" : ""}>License</option>
        </select>
      </label>
      <label>
        <span>Name</span>
        <input data-field="itemName" list="commonItems" type="text" placeholder="MBS / BCSS / Driving License" value="${escapeHtml(item.itemName || "")}" required>
      </label>
      <label>
        <span>Expiry date</span>
        <input data-field="expiryDate" type="date" value="${escapeHtml(item.expiryDate || "")}" required>
      </label>
      <label>
        <span>Item note</span>
        <input data-field="notes" type="text" placeholder="Optional" value="${escapeHtml(item.notes || "")}">
      </label>
      <div class="remove-wrap">
        <button class="small-button danger" type="button" data-remove-item>Remove</button>
      </div>
    `;
    elements.itemEditorList.appendChild(row);
  }

  function collectPersonForm() {
    const itemRows = [...elements.itemEditorList.querySelectorAll(".item-editor")];
    const items = itemRows.map((row) => {
      const get = (field) => row.querySelector(`[data-field="${field}"]`)?.value.trim() || "";
      return {
        itemId: row.dataset.itemId || "",
        itemType: get("itemType") === "License" ? "License" : "Pass",
        itemName: get("itemName"),
        expiryDate: get("expiryDate"),
        notes: get("notes")
      };
    }).filter((item) => item.itemName || item.expiryDate || item.notes);

    if (!elements.nameInput.value.trim()) throw new Error("Name is required.");
    const badItem = items.find((item) => !item.itemName || !item.expiryDate);
    if (badItem) throw new Error("Every pass/license needs a name and expiry date.");

    return {
      person: {
        personId: elements.personIdInput.value.trim(),
        name: elements.nameInput.value.trim(),
        nickname: elements.nicknameInput.value.trim(),
        role: elements.roleInput.value,
        notes: elements.personNotesInput.value.trim()
      },
      items
    };
  }

  async function savePerson(event) {
    event.preventDefault();
    if (state.mode !== "edit") return;
    let payload;
    try {
      payload = collectPersonForm();
    } catch (error) {
      showToast(error.message, true);
      return;
    }

    setBusy(elements.savePersonButton, true, "Saving...");
    clearConnectionError();
    try {
      const response = await api("savePerson", payload);
      state.people = response.people || [];
      state.items = response.items || [];
      render();
      closePersonDialog();
      showToast("Saved");
    } catch (error) {
      showConnectionError(error.message);
      showToast(error.message, true);
    } finally {
      setBusy(elements.savePersonButton, false);
    }
  }

  async function deletePerson() {
    if (state.mode !== "edit") return;
    const personId = elements.personIdInput.value.trim();
    if (!personId) return;
    const name = elements.nameInput.value.trim() || "this person";
    if (!confirm(`Delete ${name}? This will remove all pass and license items for this person.`)) return;

    setBusy(elements.deletePersonButton, true, "Deleting...");
    clearConnectionError();
    try {
      const response = await api("deletePerson", { personId });
      state.people = response.people || [];
      state.items = response.items || [];
      render();
      closePersonDialog();
      showToast("Deleted");
    } catch (error) {
      showConnectionError(error.message);
      showToast(error.message, true);
    } finally {
      setBusy(elements.deletePersonButton, false);
    }
  }

  function bindEvents() {
    elements.unlockForm.addEventListener("submit", unlock);
    elements.logoutButton.addEventListener("click", logout);
    elements.refreshButton.addEventListener("click", () => loadData(elements.refreshButton).catch((error) => showToast(error.message, true)));
    elements.addPersonButton.addEventListener("click", () => openPersonDialog());
    elements.closeDialogButton.addEventListener("click", closePersonDialog);
    elements.cancelDialogButton.addEventListener("click", closePersonDialog);
    elements.personForm.addEventListener("submit", savePerson);
    elements.deletePersonButton.addEventListener("click", deletePerson);
    elements.addPassButton.addEventListener("click", () => addItemEditor({ itemType: "Pass" }));
    elements.addLicenseButton.addEventListener("click", () => addItemEditor({ itemType: "License" }));

    [elements.searchInput, elements.roleFilter, elements.typeFilter, elements.statusFilter].forEach((el) => {
      el.addEventListener("input", () => renderExpiryCards(flattenItems()));
      el.addEventListener("change", () => renderExpiryCards(flattenItems()));
    });

    document.body.addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-edit-person]");
      if (editButton) openPersonDialog(editButton.getAttribute("data-edit-person"));
      const removeButton = event.target.closest("[data-remove-item]");
      if (removeButton) {
        const rows = elements.itemEditorList.querySelectorAll(".item-editor");
        if (rows.length <= 1) {
          showToast("At least one pass/license row must stay. You can leave it blank when adding a new person.");
          return;
        }
        removeButton.closest(".item-editor").remove();
      }
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  function boot() {
    bindEvents();
    registerServiceWorker();

    if (!isConfigured()) {
      elements.setupNotice.classList.remove("hidden");
      elements.refreshButton.disabled = true;
      elements.addPersonButton.classList.add("hidden");
      return;
    }

    elements.setupNotice.classList.add("hidden");
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (session.pin) {
          state.pin = session.pin;
          elements.pinInput.value = session.pin;
          elements.rememberPin.checked = true;
          loadData().catch(() => {
            elements.unlockPanel.classList.remove("hidden");
          });
        }
      } catch (_) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  boot();
})();
