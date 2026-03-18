/* ── Theme Toggle ─────────────────────────────────────────── */
(function initTheme() {
  const THEME_KEY = "bingeboardTheme";
  const root      = document.documentElement;
  const btn       = document.getElementById("themeToggleBtn");
  const iconMoon  = document.getElementById("iconMoon");
  const iconSun   = document.getElementById("iconSun");

  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  btn && btn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    const dark = theme === "dark";
    if (iconMoon) iconMoon.style.display = dark ? "" : "none";
    if (iconSun)  iconSun.style.display  = dark ? "none" : "";
    if (btn) {
      const label = dark ? "Switch to light mode" : "Switch to dark mode";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
  }
})();

/* ── Constants ────────────────────────────────────────────── */
const STORAGE_KEY   = "ottShortcuts";
const MAX_SHORTCUTS = 30;

const DEFAULT_SHORTCUTS = [
  { name: "Netflix",        url: "https://www.netflix.com"    },
  { name: "Prime Video",    url: "https://www.primevideo.com" },
  { name: "Disney+ Hotstar",url: "https://www.hotstar.com"   }
];

/* ── DOM refs ─────────────────────────────────────────────── */
const grid         = document.getElementById("grid");
const hint         = document.getElementById("hint");
const editModal    = document.getElementById("editModal");
const editForm     = document.getElementById("editForm");
const modalTitle   = document.getElementById("modalTitle");
const saveEditBtn  = document.getElementById("saveEditBtn");
const editNameInput= document.getElementById("editNameInput");
const editUrlInput = document.getElementById("editUrlInput");
const cancelEditBtn= document.getElementById("cancelEditBtn");
const closeModalBtn= document.getElementById("closeModalBtn");

/* ── State ────────────────────────────────────────────────── */
let shortcuts     = loadShortcuts();
let editingUrl    = null;
let modalMode     = "edit";
let activeMenuWrap= null;
let draggedUrl    = null;

// Cache: url → "r,g,b" glow colour string
const glowCache = {};

/* ── Helpers ──────────────────────────────────────────────── */
function safeNormalizeUrl(raw) {
  if (!raw) return null;
  let v = raw.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const p = new URL(v);
    if (!["http:", "https:"].includes(p.protocol)) return null;
    p.hash = "";
    return p.toString().replace(/\/$/, "");
  } catch { return null; }
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function faviconFor(url) {
  const d = extractDomain(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
}

/* ── Dominant colour from favicon via Canvas ──────────────── */
function getDominantColor(imgUrl) {
  return new Promise((resolve) => {
    if (glowCache[imgUrl]) { resolve(glowCache[imgUrl]); return; }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const sz = 16;
        const c  = document.createElement("canvas");
        c.width  = sz; c.height = sz;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, sz, sz);
        const d = ctx.getImageData(0, 0, sz, sz).data;

        // Sum non-near-white, non-near-black pixels
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a < 80) continue; // transparent
          const lr = d[i], lg = d[i+1], lb = d[i+2];
          const brightness = (lr + lg + lb) / 3;
          if (brightness < 30 || brightness > 225) continue; // skip near-black/white
          r += lr; g += lg; b += lb; count++;
        }
        if (count === 0) { resolve(null); return; }
        const rgb = `${Math.round(r/count)},${Math.round(g/count)},${Math.round(b/count)}`;
        glowCache[imgUrl] = rgb;
        resolve(rgb);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}

/* ── Shortcuts Storage ────────────────────────────────────── */
function saveShortcuts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
}

function loadShortcuts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SHORTCUTS)); return [...DEFAULT_SHORTCUTS]; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SHORTCUTS)); return [...DEFAULT_SHORTCUTS]; }
    const sanitized = parsed
      .map(item => ({ name: String(item.name || "").trim(), url: safeNormalizeUrl(String(item.url || "")), pinned: false }))
      .filter(item => item.name && item.url);
    if (!sanitized.length) { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SHORTCUTS)); return [...DEFAULT_SHORTCUTS]; }
    const limited = sanitized.slice(0, MAX_SHORTCUTS);
    if (limited.length !== sanitized.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
    return limited;
  } catch { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SHORTCUTS)); return [...DEFAULT_SHORTCUTS]; }
}

/* ── Hint ─────────────────────────────────────────────────── */
function setHint(msg, isError = false) {
  hint.textContent = msg;
  hint.style.color = isError ? "#ff5260" : "var(--text-3)";
  if (!msg) return;
  clearTimeout(setHint._t);
  setHint._t = setTimeout(() => { hint.textContent = ""; }, 2600);
}

/* ── Menu ─────────────────────────────────────────────────── */
function closeActiveMenu() {
  if (!activeMenuWrap) return;
  activeMenuWrap.querySelector(".menu")?.classList.remove("open");
  activeMenuWrap.classList.remove("open");
  activeMenuWrap = null;
}

function toggleMenu(wrap) {
  const same = activeMenuWrap === wrap;
  closeActiveMenu();
  if (same) return;
  wrap.querySelector(".menu")?.classList.add("open");
  wrap.classList.add("open");
  activeMenuWrap = wrap;
}

/* ── Grid layout ──────────────────────────────────────────── */
function applyGridTemplate(total) {
  let tileSize = 90;
  if (total <= 4)  tileSize = 96;
  if (total >= 14) tileSize = 84;
  grid.style.setProperty("--tile-size", `${tileSize}px`);
}

/* ── Drag ─────────────────────────────────────────────────── */
function moveShortcut(fromUrl, toUrl) {
  if (!fromUrl || !toUrl || fromUrl === toUrl) return;
  const fi = shortcuts.findIndex(s => s.url === fromUrl);
  const ti = shortcuts.findIndex(s => s.url === toUrl);
  if (fi === -1 || ti === -1) return;
  const [moved] = shortcuts.splice(fi, 1);
  shortcuts.splice(ti, 0, moved);
  saveShortcuts(); render();
}

function clearDragStates() {
  grid.querySelectorAll(".card.drag-over").forEach(n => n.classList.remove("drag-over"));
}

function wireDrag(card, itemUrl) {
  card.draggable = true;
  card.addEventListener("dragstart", e => { draggedUrl = itemUrl; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", itemUrl); });
  card.addEventListener("dragend", () => { draggedUrl = null; card.classList.remove("dragging"); clearDragStates(); });
  card.addEventListener("dragover", e => { if (!draggedUrl || draggedUrl === itemUrl) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; clearDragStates(); card.classList.add("drag-over"); });
  card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
  card.addEventListener("drop", e => { e.preventDefault(); clearDragStates(); moveShortcut(draggedUrl || e.dataTransfer.getData("text/plain"), itemUrl); });
}

/* ── Render ───────────────────────────────────────────────── */
function render() {
  closeActiveMenu();
  const canAdd = shortcuts.length < MAX_SHORTCUTS;
  grid.innerHTML = "";
  applyGridTemplate(shortcuts.length + (canAdd ? 1 : 0));

  shortcuts.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.setProperty("--i", String(index));

    const tile = document.createElement("a");
    tile.className = "tile";
    tile.href = item.url;
    tile.target = "_blank";
    tile.rel = "noopener noreferrer";
    tile.title = item.name;

    const img = document.createElement("img");
    img.className = "icon";
    const favUrl = faviconFor(item.url);
    img.src = favUrl;
    img.alt = `${item.name} icon`;
    img.loading = "lazy";
    tile.append(img);

    // Extract dominant colour when icon loads, set CSS var
    getDominantColor(favUrl).then(rgb => {
      if (rgb) {
        card.style.setProperty("--glow-color", `rgba(${rgb},.45)`);
        tile.style.setProperty("--glow-color", `rgba(${rgb},.45)`);
      }
    });

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name;

    // Context menu
    const menuWrap = document.createElement("div");
    menuWrap.className = "menu-wrap";

    const menuBtn = document.createElement("button");
    menuBtn.className = "menu-btn";
    menuBtn.type = "button";
    menuBtn.textContent = "⋯";
    menuBtn.title = "Shortcut menu";
    menuBtn.setAttribute("aria-label", `Menu for ${item.name}`);
    menuBtn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggleMenu(menuWrap); });

    const menu = document.createElement("div");
    menu.className = "menu";

    const editItem = document.createElement("button");
    editItem.className = "menu-item";
    editItem.type = "button";
    editItem.textContent = "Edit";
    editItem.addEventListener("click", e => { e.preventDefault(); openEditModal(item.url); });

    const delItem = document.createElement("button");
    delItem.className = "menu-item delete";
    delItem.type = "button";
    delItem.textContent = "Delete";
    delItem.addEventListener("click", e => { e.preventDefault(); removeShortcut(item.url); });

    menu.append(editItem, delItem);
    menuWrap.append(menuBtn, menu);
    card.append(tile, menuWrap, name);
    wireDrag(card, item.url);
    card.addEventListener("contextmenu", e => { e.preventDefault(); toggleMenu(menuWrap); });
    grid.append(card);
  });

  if (canAdd) {
    const addCard = document.createElement("article");
    addCard.className = "card";
    addCard.style.setProperty("--i", String(shortcuts.length));

    const addTile = document.createElement("button");
    addTile.className = "add-tile";
    addTile.type = "button";
    addTile.title = "Add shortcut";
    addTile.setAttribute("aria-label", "Add shortcut");
    addTile.addEventListener("click", openAddModal);

    const addLabel = document.createElement("span");
    addLabel.className = "name";
    addLabel.textContent = "Add";

    addCard.append(addTile, addLabel);
    grid.append(addCard);
  }
}

/* ── Shortcuts CRUD ───────────────────────────────────────── */
function hasDuplicate(url, exceptUrl = null) {
  return shortcuts.some(s => {
    if (exceptUrl && s.url === exceptUrl) return false;
    return safeNormalizeUrl(s.url) === url;
  });
}

function addShortcut(name, rawUrl) {
  if (shortcuts.length >= MAX_SHORTCUTS) { setHint(`Max ${MAX_SHORTCUTS} shortcuts reached.`, true); return; }
  const cleanName = name.trim();
  const cleanUrl  = safeNormalizeUrl(rawUrl);
  if (!cleanName || !cleanUrl) { setHint("Please enter a valid name and URL.", true); return; }
  if (hasDuplicate(cleanUrl)) { setHint("This URL already exists.", true); return; }
  shortcuts.push({ name: cleanName, url: cleanUrl, pinned: false });
  saveShortcuts(); render(); closeEditModal(); setHint("Shortcut added.");
}

function removeShortcut(url) {
  const i = shortcuts.findIndex(s => s.url === url);
  if (i === -1) return;
  shortcuts.splice(i, 1);
  saveShortcuts(); render(); setHint("Shortcut removed.");
}

/* ── Modal ────────────────────────────────────────────────── */
function updatePreview() {
  // no-op: preview panel removed from minimal modal
}

function openAddModal() {
  closeActiveMenu();
  modalMode = "add"; editingUrl = null;
  modalTitle.textContent = "Add Shortcut";
  saveEditBtn.textContent = "Add";
  editNameInput.value = ""; editUrlInput.value = "";
  editModal.showModal();
  setTimeout(() => editNameInput.focus(), 0);
}

function openEditModal(url) {
  const item = shortcuts.find(s => s.url === url);
  if (!item) return;
  closeActiveMenu();
  modalMode = "edit"; editingUrl = item.url;
  modalTitle.textContent = "Edit Shortcut";
  saveEditBtn.textContent = "Save";
  editNameInput.value = item.name;
  editUrlInput.value = item.url;
  updatePreview();
  editModal.showModal();
  setTimeout(() => editNameInput.focus(), 0);
}

function closeEditModal() {
  if (editModal.open) editModal.close();
  editingUrl = null;
}

function saveEditShortcut() {
  const newName = editNameInput.value.trim();
  const newUrl  = safeNormalizeUrl(editUrlInput.value);
  if (modalMode === "add") { addShortcut(newName, newUrl || ""); return; }
  if (!editingUrl) return;
  const idx = shortcuts.findIndex(s => s.url === editingUrl);
  if (idx === -1) return;
  if (!newName || !newUrl) { setHint("Please enter a valid name and URL.", true); return; }
  if (hasDuplicate(newUrl, editingUrl)) { setHint("Another shortcut already uses this URL.", true); return; }
  shortcuts[idx] = { ...shortcuts[idx], name: newName, url: newUrl };
  saveShortcuts(); render(); closeEditModal(); setHint("Shortcut updated.");
}

/* ── Event listeners ──────────────────────────────────────── */
editForm.addEventListener("submit", e => { e.preventDefault(); saveEditShortcut(); });
cancelEditBtn.addEventListener("click", closeEditModal);
closeModalBtn && closeModalBtn.addEventListener("click", closeEditModal);

// Live preview update as user types
editNameInput.addEventListener("input", updatePreview);
editUrlInput.addEventListener("input", updatePreview);

document.addEventListener("click", e => {
  if (!activeMenuWrap) return;
  if (activeMenuWrap.contains(e.target)) return;
  closeActiveMenu();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeActiveMenu();
});

/* ── Init ─────────────────────────────────────────────────── */
render();
