const PREF_KEY = "split-preferences";
const DOWNLOAD_DB = "split-download-target";
const DOWNLOAD_STORE = "settings";
const DOWNLOAD_KEY = "folder";

const defaultPreferences = {
  theme: "split-dark",
  mode: "auto",
  pagesPerSplit: "2",
  enableOcr: true,
  defaultMode: "auto",
  defaultPagesPerSplit: "2",
  defaultOcr: true,
};

const themeButtons = {
  "split-light": document.getElementById("themeSplitLightButton"),
  "split-dark": document.getElementById("themeSplitDarkButton"),
  "ep-blue-dark": document.getElementById("themeEpBlueDarkButton"),
  "ep-dark": document.getElementById("themeEpDarkButton"),
  matrix: document.getElementById("themeMatrixButton"),
  move: document.getElementById("themeMoveButton"),
};

const state = {
  archiveBase64: "",
  archiveFilename: "",
  generatedFiles: [],
  selectedFiles: new Set(),
  previewUrl: "",
  preferences: loadPreferences(),
  downloadFolder: null,
};

const html = document.documentElement;
const statusBox = document.getElementById("statusBox");
const statusPill = document.getElementById("statusPill");
const resultsBox = document.getElementById("results");
const previewBox = document.getElementById("previewBox");
const filePreview = document.getElementById("filePreview");
const modeSelect = document.getElementById("mode");
const pagesPerSplitInput = document.getElementById("pagesPerSplit");
const enableOcr = document.getElementById("enableOcr");
const downloadArchiveButton = document.getElementById("downloadArchiveButton");
const downloadSelectedButton = document.getElementById("downloadSelectedButton");
const selectAllButton = document.getElementById("selectAllButton");
const clearSelectionButton = document.getElementById("clearSelectionButton");
const settingsDrawer = document.getElementById("settingsDrawer");
const dropzone = document.getElementById("dropzone");
const pdfFileInput = document.getElementById("pdfFile");
const fileNameDisplay = document.getElementById("fileNameDisplay");
const defaultMode = document.getElementById("defaultMode");
const defaultPagesPerSplit = document.getElementById("defaultPagesPerSplit");
const defaultOcr = document.getElementById("defaultOcr");
const chooseDownloadFolderButton = document.getElementById("chooseDownloadFolderButton");
const downloadFolderStatus = document.getElementById("downloadFolderStatus");

function loadPreferences() {
  try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; }
  catch { return { ...defaultPreferences }; }
}

function persistPreferences(nextPreferences) {
  state.preferences = { ...state.preferences, ...nextPreferences };
  localStorage.setItem(PREF_KEY, JSON.stringify(state.preferences));
}

function loadThemeButtons() {
  Object.entries(themeButtons).forEach(([theme, button]) => {
    button?.addEventListener("click", () => setTheme(theme));
  });
}

function setTheme(theme) {
  state.preferences.theme = theme;
  html.dataset.theme = theme;
  localStorage.setItem(PREF_KEY, JSON.stringify(state.preferences));
  Object.entries(themeButtons).forEach(([key, button]) => button.classList.toggle("is-active", key === theme));
}

function setStatus(message, variant = "") {
  statusBox.className = `status-box ${variant}`.trim();
  statusBox.textContent = message;
  statusPill.className = `status-pill ${variant}`.trim();
  statusPill.textContent = variant === "processing" ? "Processing..." : variant === "success" ? "Success" : variant === "error" ? "Error" : "Ready";
}

function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: contentType });
}

function downloadBlobFallback(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getFileBlob(file) { return base64ToBlob(file.content_base64, file.mime_type); }

function clearFilePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = "";
  filePreview.className = "file-preview empty-state";
  filePreview.innerHTML = "Your first generated PDF will appear here automatically.";
}

function showFilePreview(file) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(getFileBlob(file));
  filePreview.className = "file-preview";
  filePreview.innerHTML = `
    <div class="file-preview-head">
      <strong>${file.filename}</strong>
      <span>${Math.ceil((file.size_bytes || 0) / 1024)} KB</span>
    </div>
    <iframe title="PDF preview" src="${state.previewUrl}"></iframe>
  `;
}

function updateSelectionActions() {
  const hasFiles = state.generatedFiles.length > 0;
  const hasSelection = state.selectedFiles.size > 0;
  selectAllButton.disabled = !hasFiles;
  clearSelectionButton.disabled = !hasSelection;
  downloadSelectedButton.disabled = !hasSelection;
  downloadArchiveButton.disabled = !state.archiveBase64;
}

function setSelectedFileState(filename, selected) {
  const card = document.querySelector(`[data-filename="${CSS.escape(filename)}"]`);
  if (card) card.classList.toggle("is-selected", selected);
}

function toggleFileSelection(filename, selected) {
  if (selected) state.selectedFiles.add(filename);
  else state.selectedFiles.delete(filename);
  setSelectedFileState(filename, selected);
  updateSelectionActions();
}

function saveBlobToHandle(handle, blob, filename) {
  return handle.getFileHandle(filename, { create: true })
    .then((fileHandle) => fileHandle.createWritable())
    .then((writable) => writable.write(blob).then(() => writable.close()));
}

async function downloadBlob(blob, filename) {
  if (state.downloadFolder && "showDirectoryPicker" in window) {
    try {
      await saveBlobToHandle(state.downloadFolder, blob, filename);
      setStatus(`Saved to selected folder: ${filename}`, "success");
      return;
    } catch {
      state.downloadFolder = null;
      setDownloadFolderStatus("Could not write to the selected folder. Falling back to browser downloads.");
    }
  }
  downloadBlobFallback(blob, filename);
}

function downloadSelectedFiles() {
  if (!state.selectedFiles.size) return;
  state.generatedFiles
    .filter((file) => state.selectedFiles.has(file.filename))
    .forEach((file, index) => {
      window.setTimeout(() => downloadBlob(getFileBlob(file), file.filename), index * 180);
    });
}

function setDownloadFolderStatus(message) {
  downloadFolderStatus.textContent = message;
}

function renderResults(files) {
  state.selectedFiles.clear();
  resultsBox.innerHTML = "";
  clearFilePreview();
  updateSelectionActions();

  if (!files.length) {
    resultsBox.innerHTML = "<div class='empty-state'>No files generated yet.</div>";
    return;
  }

  files.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.dataset.filename = file.filename;
    const meta = file.metadata || {};
    const chips = [
      meta.ticket ? `Ticket: ${meta.ticket}` : "Ticket: not detected",
      meta.kind ? `Type: ${meta.kind}` : "Type: unknown",
      meta.equipment_type ? `Equipment: ${meta.equipment_type}` : "Equipment: not detected",
      Array.isArray(meta.pages) && meta.pages.length ? `Pages: ${meta.pages.join(", ")}` : "Pages: not available",
    ];

    card.innerHTML = `
      <div class="result-top">
        <label class="result-select">
          <input class="result-checkbox" type="checkbox">
          <span>Select</span>
        </label>
      </div>
      <h3>${file.filename}</h3>
      <div class="result-meta">${chips.map((value) => `<span class="meta-chip">${value}</span>`).join("")}</div>
      <div class="result-actions">
        <button class="ghost-button" type="button" data-action="preview">Preview</button>
        <button class="ghost-button" type="button" data-action="download">Download PDF</button>
      </div>
    `;

    const checkbox = card.querySelector(".result-checkbox");
    checkbox.checked = state.selectedFiles.has(file.filename);
    checkbox.addEventListener("change", (event) => toggleFileSelection(file.filename, event.target.checked));
    card.querySelector('[data-action="preview"]').addEventListener("click", () => showFilePreview(file));
    card.querySelector('[data-action="download"]').addEventListener("click", () => downloadBlob(getFileBlob(file), file.filename));
    resultsBox.appendChild(card);
    if (index === 0) showFilePreview(file);
  });

  updateSelectionActions();
}

async function loadTemplates() {
  const response = await fetch("/templates");
  const data = await response.json();
  document.getElementById("receptionTemplate").value = data.reception_template;
  document.getElementById("returnTemplate").value = data.return_template;
  document.getElementById("credentialsTemplate").value = data.credentials_template;
  document.getElementById("fixedTemplate").value = data.fixed_template;
  document.getElementById("detectEquipmentType").checked = Boolean(data.detect_equipment_type);
  return data;
}

async function refreshPreview() {
  const response = await fetch("/templates/preview");
  const data = await response.json();
  previewBox.innerHTML = Object.entries(data).map(([key, value]) => `
    <div class="preview-item"><strong>${key}</strong><code>${value}</code></div>
  `).join("");
}

function syncModeControls() { pagesPerSplitInput.disabled = modeSelect.value !== "fixed"; }
function openSettings() { settingsDrawer.classList.add("open"); settingsDrawer.setAttribute("aria-hidden", "false"); }
function closeSettings() { settingsDrawer.classList.remove("open"); settingsDrawer.setAttribute("aria-hidden", "true"); }

function syncPreferencesToUi() {
  modeSelect.value = state.preferences.mode;
  pagesPerSplitInput.value = state.preferences.pagesPerSplit;
  enableOcr.checked = state.preferences.enableOcr;
  defaultMode.value = state.preferences.defaultMode;
  defaultPagesPerSplit.value = state.preferences.defaultPagesPerSplit;
  defaultOcr.checked = state.preferences.defaultOcr;
  setTheme(state.preferences.theme);
  syncModeControls();
}

function setUploadFile(file) { fileNameDisplay.textContent = file ? file.name : "No file selected"; }

async function loadStoredDownloadFolder() {
  if (!("indexedDB" in window)) return;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOAD_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DOWNLOAD_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOAD_STORE, "readonly");
    const store = tx.objectStore(DOWNLOAD_STORE);
    const req = store.get(DOWNLOAD_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (handle) {
    state.downloadFolder = handle;
    setDownloadFolderStatus("Save folder selected and remembered for this browser.");
  }
}

async function storeDownloadFolder(handle) {
  if (!("indexedDB" in window)) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOAD_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DOWNLOAD_STORE);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(DOWNLOAD_STORE, "readwrite");
      tx.objectStore(DOWNLOAD_STORE).put(handle, DOWNLOAD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

pdfFileInput.addEventListener("change", () => setUploadFile(pdfFileInput.files[0]));
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("is-dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");
  const file = event.dataTransfer.files?.[0];
  if (file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    pdfFileInput.files = transfer.files;
    setUploadFile(file);
  }
});

loadThemeButtons();
document.getElementById("openSettingsButton").addEventListener("click", async () => { await loadTemplates(); await refreshPreview(); openSettings(); });
document.getElementById("closeSettingsButton").addEventListener("click", closeSettings);
document.getElementById("refreshPreviewButton").addEventListener("click", refreshPreview);
document.getElementById("savePreferencesButton").addEventListener("click", () => {
  persistPreferences({
    mode: defaultMode.value,
    pagesPerSplit: defaultPagesPerSplit.value,
    enableOcr: defaultOcr.checked,
    defaultMode: defaultMode.value,
    defaultPagesPerSplit: defaultPagesPerSplit.value,
    defaultOcr: defaultOcr.checked,
  });
  setStatus("Preferences saved.", "success");
});

modeSelect.addEventListener("change", () => { persistPreferences({ mode: modeSelect.value }); syncModeControls(); });
pagesPerSplitInput.addEventListener("change", () => persistPreferences({ pagesPerSplit: pagesPerSplitInput.value }));
enableOcr.addEventListener("change", () => persistPreferences({ enableOcr: enableOcr.checked }));

document.getElementById("templatesForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    reception_template: document.getElementById("receptionTemplate").value,
    return_template: document.getElementById("returnTemplate").value,
    credentials_template: document.getElementById("credentialsTemplate").value,
    fixed_template: document.getElementById("fixedTemplate").value,
    detect_equipment_type: document.getElementById("detectEquipmentType").checked,
  };
  const response = await fetch("/templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) { setStatus(data.detail || "Failed to save templates.", "error"); return; }
  setStatus("Templates updated successfully.", "success");
  await refreshPreview();
});

document.getElementById("processForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pdfFileInput.files.length) { setStatus("Please choose a PDF file.", "error"); return; }

  const formData = new FormData();
  formData.append("file", pdfFileInput.files[0]);
  formData.append("mode", modeSelect.value);
  formData.append("pages_per_split", pagesPerSplitInput.value);
  formData.append("enable_ocr", enableOcr.checked ? "true" : "false");
  formData.append("force_ocr", "false");

  setStatus("Processing document. Please wait...", "processing");
  downloadArchiveButton.disabled = true;
  downloadSelectedButton.disabled = true;
  resultsBox.innerHTML = "";
  clearFilePreview();

  const response = await fetch("/process", { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) {
    const message = String(data.detail || "Processing failed.");
    setStatus(message.toLowerCase().includes("tesseract") ? "Tesseract is not installed on the server. The app should now retry without OCR after a backend restart." : message, "error");
    return;
  }

  state.archiveBase64 = data.archive_base64;
  state.archiveFilename = data.archive_filename;
  state.generatedFiles = data.generated_files || [];
  renderResults(state.generatedFiles);
  setStatus(`Success: ${data.file_count} file(s) generated.`, "success");
});

downloadArchiveButton.addEventListener("click", () => {
  if (!state.archiveBase64) return;
  downloadBlob(base64ToBlob(state.archiveBase64, "application/zip"), state.archiveFilename || "results.zip");
});
downloadSelectedButton.addEventListener("click", downloadSelectedFiles);
selectAllButton.addEventListener("click", () => {
  state.selectedFiles = new Set(state.generatedFiles.map((file) => file.filename));
  document.querySelectorAll(".result-checkbox").forEach((checkbox) => { checkbox.checked = true; });
  document.querySelectorAll(".result-card").forEach((card) => card.classList.add("is-selected"));
  updateSelectionActions();
});
clearSelectionButton.addEventListener("click", () => {
  state.selectedFiles.clear();
  document.querySelectorAll(".result-checkbox").forEach((checkbox) => { checkbox.checked = false; });
  document.querySelectorAll(".result-card").forEach((card) => card.classList.remove("is-selected"));
  updateSelectionActions();
});

chooseDownloadFolderButton.addEventListener("click", async () => {
  if (!("showDirectoryPicker" in window)) {
    setDownloadFolderStatus("Browser default downloads are active. Fixed folder saving is not supported here.");
    setStatus("Browser default downloads are active.", "success");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.downloadFolder = handle;
    await storeDownloadFolder(handle);
    setDownloadFolderStatus("Save folder selected and remembered for this browser.");
    setStatus("Download folder saved.", "success");
  } catch {
    setDownloadFolderStatus("No folder selected.");
  }
});

setTheme(state.preferences.theme);
syncPreferencesToUi();
setUploadFile(pdfFileInput.files[0]);
setStatus("Ready");
loadStoredDownloadFolder().catch(() => {});
loadTemplates().then(refreshPreview).catch(() => setStatus("Failed to load templates.", "error"));
