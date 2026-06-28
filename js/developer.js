let devId = null;
let csrfToken = "";
let dbVersion = null; // Wersja (hash) pliku danych z serwera – używana do wykrywania konfliktów

let pendingKzFiles = [];
let pendingContractFiles = [];

function renderKzList() {
  const list = document.getElementById("kz-file-list");
  if (!list) return;
  list.innerHTML = "";

  if (
    currentApt.hasChangeFile &&
    (!currentApt.kzFiles || currentApt.kzFiles.length === 0)
  ) {
    currentApt.kzFiles = [`apt_${currentApt.number}.pdf`];
  }

  if (currentApt.kzFiles) {
    currentApt.kzFiles.forEach((fileName) => {
      const pill = document.createElement("div");
      pill.className = "file-pill";
      const aptBuilding = getAptBuilding();
      const url = `/uploads/${devId}/${currentInv}/${aptBuilding}/KZ/mieszkanie_${currentApt.number}/${fileName}`;
      pill.innerHTML = `
                <span class="file-name" onclick="openPdf('${url}', '${currentApt.number}', 'KZ')" style="cursor:pointer; color:#007bff;" title="Otworz plik">PDF ${fileName}</span>
                <button class="btn-remove-file" onclick="deleteFile('kz', '${fileName}')" title="Usuń plik">✖</button>
            `;
      list.appendChild(pill);
    });
  }

  pendingKzFiles.forEach((file, index) => {
    const pill = document.createElement("div");
    pill.className = "file-pill";
    pill.innerHTML = `
            <span class="file-name" style="color:#666">⏳ ${file.name}</span>
            <button class="btn-remove-file" onclick="removePendingKz(${index})" title="Usuń plik">✖</button>
        `;
    list.appendChild(pill);
  });
}

window.removePendingKz = function (index) {
  pendingKzFiles.splice(index, 1);
  renderKzList();
};

function renderContractList() {
  const list = document.getElementById("contract-files-container");
  if (!list) return;
  list.innerHTML = "";

  if (currentApt.contracts) {
    currentApt.contracts.forEach((fileName) => {
      const pill = document.createElement("div");
      pill.className = "file-pill";
      const aptBuilding = getAptBuilding();
      const url = `/uploads/${devId}/${currentInv}/${aptBuilding}/contracts/${encodeURIComponent(fileName)}`;
      pill.innerHTML = `
            <span class="file-name" onclick="openPdf('${url}', '${currentApt.number}', 'Umowa')" style="cursor:pointer; color:#007bff;" title="Otworz plik">PDF ${fileName}</span>
            <button class="btn-remove-file" onclick="deleteContractFile('${fileName}')" title="Usuń plik">✖</button>
        `;
      list.appendChild(pill);
    });
  }

  pendingContractFiles.forEach((file, index) => {
    const pill = document.createElement("div");
    pill.className = "file-pill";
    pill.innerHTML = `
          <span class="file-name" style="color:#666">⏳ ${file.name}</span>
          <button class="btn-remove-file" onclick="removePendingContract(${index})" title="Usuń plik">✖</button>
      `;
    list.appendChild(pill);
  });
}

window.removePendingContract = function (index) {
  pendingContractFiles.splice(index, 1);
  renderContractList();
};

async function uploadKzFiles() {
  if (pendingKzFiles.length === 0) return;
  if (!currentApt.kzFiles) currentApt.kzFiles = [];

  for (let f of pendingKzFiles) {
    const fd = new FormData();
    fd.append("devId", devId);
    fd.append("investId", currentInv);
    fd.append("buildingId", getAptBuilding());
    fd.append("aptNumber", currentApt.number);
    fd.append("type", "kz");
    fd.append("file", f);

    const r = await fetch("/api/upload-card", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: fd,
    });
    if (r.ok) {
      const data = await r.json();
      if (!currentApt.kzFiles.includes(data.filename)) {
        currentApt.kzFiles.push(data.filename);
      }
    }
  }
  pendingKzFiles = [];
  currentApt.hasChangeFile = currentApt.kzFiles.length > 0;
}

let db = { investments: {} },
  currentApt = null,
  currentInv = "",
  currentBuild = "",
  currentFloor = "",
  currentPdfUrl = "";

function getAptBuilding() {
  const floors = db.investments[currentInv]?._floors;
  return (floors && floors[currentFloor]?.building) ? floors[currentFloor].building : (currentBuild === "all" ? "" : currentBuild);
}

/**
 * Aktualizuje wskaznik statusu zapisu w headerze.
 * @param {'saved'|'unsaved'|'saving'|'conflict'|'hidden'} status
 * @param {string} [customMsg] - opcjonalnie nadpisz tekst
 */
function setSaveStatus(status, customMsg) {
  const bar = document.getElementById('save-status-bar');
  if (!bar) return;
  const styles = {
    saved:    { bg: '#d1fae5', color: '#065f46', text: '\u2705 Zapisano' },
    unsaved:  { bg: '#fef3c7', color: '#92400e', text: '\u270f️ Niezapisane zmiany' },
    saving:   { bg: '#dbeafe', color: '#1e40af', text: '\u23f3 Zapisywanie...' },
    conflict: { bg: '#fee2e2', color: '#991b1b', text: '\u26a0️ Konflikt — odśwież stronę!' },
  };
  if (status === 'hidden') {
    bar.style.display = 'none';
    return;
  }
  const s = styles[status] || styles.saved;
  bar.style.display = 'block';
  bar.style.background = s.bg;
  bar.style.color = s.color;
  bar.textContent = customMsg || s.text;
  // Automatycznie ukryj 'saved' po 4 sekundach
  if (status === 'saved') {
    clearTimeout(bar._hideTimer);
    bar._hideTimer = setTimeout(() => { bar.style.display = 'none'; }, 4000);
  }
}

async function init() {
  initHeader();
  try {
    const userRes = await fetch("/api/me");
    if (!userRes.ok) {
      window.location.href = "index.html";
      return;
    }
    const user = await userRes.json();

    devId = user.devId;

    const csrfRes = await fetch("/api/csrf-token");
    if (csrfRes.ok) {
      const csrfData = await csrfRes.json();
      csrfToken = csrfData.csrfToken;
    }

    const res = await fetch(`/api/data/${devId}?t=${Date.now()}`);
    const rawData = await res.json();
    // Wyodrębnij wersję pliku i zapisz ją globalnie
    dbVersion = rawData._dbVersion || null;
    // Usuń pole techniczne z lokalnej kopii danych
    const { _dbVersion: _v, ...cleanData } = rawData;
    db = cleanData;

    const sel = document.getElementById("inv-sel");
    const invKeys = Object.keys(db.investments || {});
    sel.innerHTML =
      '<option value="">Wybierz Inwestycję</option>' +
      invKeys.map((k) => `<option value="${k}">${k}</option>`).join("");
      
    if (invKeys.length === 1) {
        sel.value = invKeys[0];
        changeInvestment();
    }
  } catch (e) {
    console.error("Błąd inicjalizacji:", e);
  }
}

function changeInvestment() {
  currentInv = document.getElementById("inv-sel").value;
  currentBuild = "";
  currentFloor = "";
  closePdf();
  document.getElementById("floor-buttons").innerHTML = "";
  document.getElementById("no-floor-msg").style.display = "block";
  document.getElementById("map-cont").style.display = "none";
  document.getElementById("zoom-controls").style.display = "none";

  if (!currentInv || !db.investments[currentInv]) {
    document.getElementById("build-sel").innerHTML = '<option value="all">Wszystkie budynki</option>';
    return;
  }

  // Zbierz unikalne budynki z _floors
  const floors = db.investments[currentInv]._floors || {};
  const buildings = new Set();
  Object.values(floors).forEach(f => { if (f.building) buildings.add(f.building); });

  const buildSel = document.getElementById("build-sel");
  buildSel.innerHTML = '<option value="all">Wszystkie budynki</option>' +
    Array.from(buildings).sort().map(b => `<option value="${b}">${b}</option>`).join("");

  updateRoomFilter();
  updateFloorFilter();
  renderFloorButtons();

  // Auto-wyświetl pierwszy rzut
  const floorKeys = Object.keys(floors);
  if (floorKeys.length > 0) displayFloor(floorKeys[0]);
  render();
}

function filterByBuilding() {
  currentBuild = document.getElementById("build-sel").value;
  renderFloorButtons();
  render();
}

function updateRoomFilter() {
  const roomSel = document.getElementById("filter-rooms");
  const rooms = new Set();
  if (currentInv && db.investments[currentInv]?._floors) {
    Object.values(db.investments[currentInv]._floors).forEach(f => {
      (f.apartments || []).forEach(a => { if (a.rooms) rooms.add(a.rooms); });
    });
  }
  roomSel.innerHTML = '<option value="all">Wszystkie</option>' +
    Array.from(rooms).sort((a,b) => a-b).map(r => `<option value="${r}">${r}</option>`).join("");
}

function updateFloorFilter() {
  const floorSel = document.getElementById("filter-floor");
  if (!currentInv || !db.investments[currentInv]?._floors) {
    floorSel.innerHTML = '<option value="all">Wszystkie</option>';
    return;
  }
  const floors = Object.keys(db.investments[currentInv]._floors);
  floorSel.innerHTML = '<option value="all">Wszystkie</option>' +
    floors.map(f => `<option value="${f}">${f}</option>`).join("");
}

function renderFloorButtons() {
  const container = document.getElementById("floor-buttons");
  if (!currentInv || !db.investments[currentInv]?._floors) {
    container.innerHTML = "";
    return;
  }
  const floors = db.investments[currentInv]._floors;
  const buildFilter = document.getElementById("build-sel")?.value || "all";

  // Podziel rzuty na 3 grupy
  const groups = { zt: [], nad: [], pod: [] };
  Object.entries(floors).forEach(([key, f]) => {
    const g = f.group || "nad";
    if (groups[g]) groups[g].push({ key, f });
  });

  // Filtrowanie: nadziemne filtrujemy po budynku, ZT i pod zawsze widoczne
  const nadFiltered = groups.nad.filter(({ f }) =>
    buildFilter === "all" || f.building === buildFilter
  );

  const makeBtn = ({ key, f }) => {
    const label = f.building ? `${f.building} \u2013 ${key}` : key;
    return `<button class="floor-btn${currentFloor === key ? " active" : ""}" onclick="selectFloorBtn(this, '${key}')" title="${label}">${label}</button>`;
  };

  let html = "";

  if (groups.zt.length > 0) {
    html += `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">`;
    html += `<span style="font-size:11px;color:#64748b;white-space:nowrap;font-weight:600;">Teren:</span>`;
    html += groups.zt.map(makeBtn).join("");
    html += "</div>";
  }

  if (nadFiltered.length > 0) {
    html += `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">`;
    html += `<span style="font-size:11px;color:#64748b;white-space:nowrap;font-weight:600;">Nadziemne:</span>`;
    html += nadFiltered.map(makeBtn).join("");
    html += "</div>";
  }

  if (groups.pod.length > 0) {
    html += `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">`;
    html += `<span style="font-size:11px;color:#64748b;white-space:nowrap;font-weight:600;">Podziemne:</span>`;
    html += groups.pod.map(makeBtn).join("");
    html += "</div>";
  }

  container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;">${html}</div>`;
}

function loadFloors() {
  renderFloorButtons();
  const floors = db.investments[currentInv]?._floors || {};
  const floorKeys = Object.keys(floors);
  if (floorKeys.length > 0) displayFloor(floorKeys[0]);
  else {
    document.getElementById("map-cont").style.display = "none";
    document.getElementById("no-floor-msg").style.display = "block";
    render();
  }
}

function selectFloorBtn(btn, floorName) {
  document.querySelectorAll(".floor-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  displayFloor(floorName);
  const h = document.getElementById(`header-floor-${floorName}`);
  if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
}

function displayFloor(floorName) {
  if (!currentInv || !floorName) return;
  const floors = db.investments[currentInv]?._floors;
  if (!floors || !floors[floorName]) return;
  currentFloor = floorName;
  closePdf();
  document.getElementById("no-floor-msg").style.display = "none";
  const img = document.getElementById("plan-img");
  const floorObj = floors[floorName];

  // Nowa ścieżka _floors/ z fallbackiem na stare ścieżki
  const newSrc = `/uploads/${devId}/${currentInv}/_floors/${encodeURIComponent(floorName)}.jpg?t=${Date.now()}`;
  const legacySrc = floorObj?.building ? `/uploads/${devId}/${currentInv}/${encodeURIComponent(floorObj.building)}/plans/${encodeURIComponent(floorName)}.jpg?t=${Date.now()}` : null;

  img.onerror = () => {
    if (legacySrc && img.src.indexOf("_floors") !== -1) {
      img.src = legacySrc;
    } else {
      document.getElementById("map-cont").style.display = "block";
      document.getElementById("zoom-controls").style.display = "flex";
      resetZoom();
      renderSvgOnly();
    }
  };
  img.onload = () => {
    document.getElementById("map-cont").style.display = "block";
    document.getElementById("zoom-controls").style.display = "flex";
    resetZoom();
    document.getElementById("canvas").setAttribute("viewBox", `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    renderSvgOnly();
  };
  img.src = newSrc;
}

function getSafeId(num) {
  return num.toString().replace(/[^a-z0-9]/gi, "_");
}

function renderSvgOnly() {
  const svg = document.getElementById("canvas");
  svg.innerHTML = "";
  const floors = db.investments[currentInv]?._floors;
  if (!floors || !floors[currentFloor]) return;
  (floors[currentFloor].apartments || []).forEach((apt) => {
    const status = (apt.status || "wolne").toLowerCase();
    let typeShort = apt.type || "LM";
    if (typeShort === "K") typeShort = "KL";
    const safeNum = getSafeId(typeShort + "-" + apt.number);
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.id = `poly-${safeNum}`;
    poly.setAttribute("points", apt.points);
    poly.setAttribute("class", "status-" + status);
    poly.onmouseenter = () => { document.getElementById(`row-${safeNum}`)?.classList.add("highlight-row"); document.getElementById(`row-info-${safeNum}`)?.classList.add("highlight-row"); };
    poly.onmouseleave = () => { document.getElementById(`row-${safeNum}`)?.classList.remove("highlight-row"); document.getElementById(`row-info-${safeNum}`)?.classList.remove("highlight-row"); };
    poly.onclick = (e) => {
      let filtersChanged = false;
      const checkReset = (id) => {
         const el = document.getElementById(id);
         if (el && el.value !== "all") {
            el.value = "all";
            filtersChanged = true;
         }
      };
      checkReset("filter-status");
      checkReset("filter-type");
      checkReset("filter-rooms");
      
      const searchEl = document.getElementById("search-client");
      if (searchEl && searchEl.value.trim() !== "") {
          searchEl.value = "";
          filtersChanged = true;
      }
      if (filtersChanged) render();

      const tr = document.getElementById(`row-${safeNum}`);
      if (tr) {
          tr.scrollIntoView({ behavior: "smooth", block: "center" });
          tr.classList.add("highlight-row");
          setTimeout(() => tr.classList.remove("highlight-row"), 2000);
          if (typeof toggleMobileView === "function") toggleMobileView("table");
      }
    };
    poly.ondblclick = (e) => {
       e.preventDefault();
       openModal(apt);
    };
    svg.appendChild(poly);
  });
}

function render() {
  const floors = db.investments[currentInv]?._floors;
  if (!currentInv || !floors) return;

  const fStatus = document.getElementById("filter-status").value.toLowerCase();
  const fType = document.getElementById("filter-type").value;
  const fRooms = document.getElementById("filter-rooms").value;
  const fFloor = document.getElementById("filter-floor").value;
  const fSearch = document.getElementById("search-client").value.toLowerCase();

  const stats = {
      LM: { wolne: 0, rezerwacja: 0, sprzedane: 0 },
      MP: { wolne: 0, rezerwacja: 0, sprzedane: 0 },
      K: { wolne: 0, rezerwacja: 0, sprzedane: 0 },
      LU: { wolne: 0, rezerwacja: 0, sprzedane: 0 }
  };
  let totalArea = 0;

  // Id -> numer dla wyświetlania MP/K
  const idToNumber = {};
  Object.values(floors).forEach(fData => {
    (fData.apartments || []).forEach(a => { idToNumber[a.id] = a.number; });
  });

  const tbody = document.getElementById("apt-table-body");
  tbody.innerHTML = "";

  // Filtruj rzuty: jeśli wybrany konkretny budynek, pokaż tylko jego nadziemne (i zawsze ZT/pod)
  const buildFilter = document.getElementById("build-sel")?.value || "all";
  const floorEntries = Object.entries(floors).filter(([fId, fData]) => {
    if (fFloor !== "all" && fFloor !== fId) return false;
    if (buildFilter === "all") return true;
    if (fData.group === "nad") return fData.building === buildFilter;
    return true; // ZT i pod zawsze widoczne
  });

  // PRE-OBLICZANIE STATYSTYK DLA WIDOKU (przed filtrami z inputów)
  floorEntries.forEach(([_, fData]) => {
    (fData.apartments || []).forEach((apt) => {
      let rawType = apt.type || "LM";
      if (rawType === "KL" || rawType === "K") rawType = "K";
      if (!stats[rawType]) rawType = "LM";
      
      const status = (apt.status || "wolne").toLowerCase();
      if (status.includes("rez") || status.includes("zarezerwowane")) stats[rawType].rezerwacja++;
      else if (status.includes("sprzed")) stats[rawType].sprzedane++;
      else stats[rawType].wolne++;
    });
  });

  floorEntries.forEach(([floorName, floorData]) => {
    const filteredApts = floorData.apartments
      .filter((apt) => {
        const sM =
          fStatus === "all" ||
          (apt.status || "wolne").toLowerCase() === fStatus;
        const rM = fRooms === "all" || apt.rooms == fRooms;
        const cM =
          !fSearch ||
          (apt.clientName && apt.clientName.toLowerCase().includes(fSearch));

        let tVal = apt.type || "LM";
        if (tVal === "K") tVal = "KL";
        const tM = fType === "all" || tVal === fType;

        return sM && rM && cM && tM;
      })
      .sort((a, b) =>
        a.number
          .toString()
          .localeCompare(b.number.toString(), undefined, { numeric: true }),
      );
    if (filteredApts.length === 0) return;
    const fHeader = document.createElement("tr");
    fHeader.className = "floor-header";
    fHeader.innerHTML = `<td colspan="13">${floorName}</td>`;
    tbody.appendChild(fHeader);

    filteredApts.forEach((apt) => {
      let typeShort = apt.type || "LM";
      if (typeShort === "K") typeShort = "KL";
      
      const numericArea = parseFloat((apt.area || "0").toString().replace(",", ".")) || 0;
      if (typeShort === "LM") {
        totalArea += numericArea;
      }

      const status = (apt.status || "wolne").toLowerCase();
      const safeNum = getSafeId(typeShort + "-" + apt.number);
      let priceMainDisplay = "-";
      let pricePerM2Display = "";
      if (apt.price) {
        const numericPrice =
          parseFloat(
            apt.price.toString().replace(/\s/g, "").replace(",", "."),
          ) || 0;
        if (numericPrice > 0) {
          priceMainDisplay = Math.round(numericPrice).toLocaleString("pl-PL");
          if (numericArea > 0) {
            const perM2 = Math.round(numericPrice / numericArea);
            pricePerM2Display = perM2.toLocaleString("pl-PL") + " zł/m²";
          }
        }
      }
      // Pliki per-budynek (KM/KI/KZ/umowy) — ścieżka z pola building rzutu
      const aptBuilding = floorData.building || currentBuild || "";
      const basePath = `/uploads/${devId}/${currentInv}/${aptBuilding}`;
      const ts = Date.now();
      const kmUrl = `${basePath}/cards_km/apt_${apt.number}.pdf?t=${ts}`;
      const kiUrl = `${basePath}/cards_ki/apt_${apt.number}.pdf?t=${ts}`;

      let contractsHtml = "-";
      if (apt.contracts && apt.contracts.length > 0) {
        contractsHtml = apt.contracts
          .map((fileName) => {
            const fileUrl = `${basePath}/contracts/${encodeURIComponent(fileName)}`;
            return `<span class="file-link contract-icon" title="${fileName}" onclick="event.stopPropagation(); openPdf('${fileUrl}', '${apt.number}', 'Umowa')">U</span>`;
          })
          .join("");
      }

      let mpText = apt.parking || "-";
      if (apt.linkedMPs && apt.linkedMPs.length > 0) {
        const nums = apt.linkedMPs.map((id) => idToNumber[id]).filter(Boolean);
        if (nums.length > 0) mpText = nums.join(", ");
      }

      let kText = apt.cellar || "-";
      if (apt.linkedKs && apt.linkedKs.length > 0) {
        const nums = apt.linkedKs.map((id) => idToNumber[id]).filter(Boolean);
        if (nums.length > 0) kText = nums.join(", ");
      }

      const tr = document.createElement("tr");
      tr.id = `row-${safeNum}`;
      tr.className = "clickable-row row-" + status;
      tr.onclick = (e) => {
         if (currentFloor !== floorName) {
             const btn = Array.from(document.querySelectorAll(".floor-btn")).find(b => b.innerText.includes(floorName) || b.title.includes(floorName));
             if (btn) selectFloorBtn(btn, floorName);
             else displayFloor(floorName);
         }
      };
      tr.ondblclick = (e) => {
         e.preventDefault();
         openModal(apt);
      };
      tr.onmouseenter = () => {
        const poly = document.getElementById(`poly-${safeNum}`);
        if (poly) poly.classList.add("highlight-poly");
        const infoRow = document.getElementById(`row-info-${safeNum}`);
        if (infoRow) infoRow.classList.add("highlight-row");
      };
      tr.onmouseleave = () => {
        const poly = document.getElementById(`poly-${safeNum}`);
        if (poly) poly.classList.remove("highlight-poly");
        const infoRow = document.getElementById(`row-info-${safeNum}`);
        if (infoRow) infoRow.classList.remove("highlight-row");
      };

      tr.innerHTML = `
                    <td class="col-status"><span class="status-pill st-${status}">${status}</span></td>
                    <td class="col-type" style="width: 30px; text-align: center; font-size: 11px; font-weight: bold; color: #666;">${typeShort}</td>
                    <td class="col-nr"><b>${apt.number}</b></td>
                    <td class="col-area"><div class="area-container"><span class="area-main">${apt.area}</span><span class="area-extra">${apt.balconyArea || ""}</span></div></td>
                    <td class="col-rooms">${apt.rooms || "-"}</td>
                    <td class="col-price">
                        <div class="price-container">
                            <span class="price-main">${priceMainDisplay}</span>
                            <span class="price-unit">${pricePerM2Display}</span>
                        </div>
                    </td>
                    <td class="col-client"><div class="client-info"><span class="client-name">${apt.clientName || "-"}</span><span class="contact-line">TEL: ${apt.clientPhone || ""}</span><span class="email-line">EMAIL: ${apt.clientEmail || ""}</span></div></td>
                    <td class="col-contract">${contractsHtml}</td>
                    <td class="col-km">${apt.hasKM ? `<span class="file-link" onclick="event.stopPropagation(); openPdf('${kmUrl}', '${apt.number}', 'KM')">KM</span>` : "-"}</td>
                    <td class="col-ki">${apt.hasKI ? `<span class="file-link" onclick="event.stopPropagation(); openPdf('${kiUrl}', '${apt.number}', 'KI')">KI</span>` : "-"}</td>
                    <td class="col-changes-file">${(() => {
                      let kzHtml = apt.hasChanges === "TAK" ? "TAK" : "-";
                      if (apt.kzFiles && apt.kzFiles.length > 0) {
                        apt.kzFiles.forEach((fileName) => {
                          const url = `${basePath}/KZ/mieszkanie_${apt.number}/${fileName}?t=${ts}`;
                          kzHtml += ` <span class="file-link" onclick="event.stopPropagation(); openPdf('${url}', '${apt.number}', 'KZ')" title="${fileName}">KZ</span>`;
                        });
                      } else if (apt.hasChangeFile) {
                        const url = `${basePath}/cards_kz/apt_${apt.number}.pdf?t=${ts}`;
                        kzHtml += ` <span class="file-link" onclick="event.stopPropagation(); openPdf('${url}', '${apt.number}', 'KZ')">KZ</span>`;
                      }
                      return kzHtml;
                    })()}</td>
                    <td class="col-mp">${mpText}</td>
                    <td class="col-kom">${kText}</td>
                `;
      tbody.appendChild(tr);

      if (apt.additionalInfo && apt.additionalInfo.trim() !== "") {
        const infoTr = document.createElement("tr");
        infoTr.className = "info-row";
        infoTr.id = `row-info-${safeNum}`;
        infoTr.innerHTML = `<td colspan="13"><b>Uwagi:</b> ${apt.additionalInfo}</td>`;
        infoTr.onclick = tr.onclick;
        infoTr.ondblclick = tr.ondblclick;
        infoTr.onmouseenter = tr.onmouseenter;
        infoTr.onmouseleave = tr.onmouseleave;
        tbody.appendChild(infoTr);
      }
    });
  });
  const sumLM = stats.LM.wolne + stats.LM.rezerwacja + stats.LM.sprzedane;
  const sumMP = stats.MP.wolne + stats.MP.rezerwacja + stats.MP.sprzedane;
  const sumK = stats.K.wolne + stats.K.rezerwacja + stats.K.sprzedane;
  const sumLU = stats.LU.wolne + stats.LU.rezerwacja + stats.LU.sprzedane;

  const cLM = document.getElementById("stat-lm-container");
  if (cLM) cLM.title = `Lokale mieszkalne (Łącznie: ${sumLM}) | Wolne / Zarezerwowane / Sprzedane`;
  const cMP = document.getElementById("stat-mp-container");
  if (cMP) cMP.title = `Miejsca postojowe (Łącznie: ${sumMP}) | Wolne / Zarezerwowane / Sprzedane`;
  const cK = document.getElementById("stat-k-container");
  if (cK) cK.title = `Komórki lokatorskie (Łącznie: ${sumK}) | Wolne / Zarezerwowane / Sprzedane`;
  const cLU = document.getElementById("stat-lu-container");
  if (cLU) cLU.title = `Lokale usługowe (Łącznie: ${sumLU}) | Wolne / Zarezerwowane / Sprzedane`;

  const sLM = document.getElementById("stat-lm");
  if (sLM) sLM.innerText = `${stats.LM.wolne}/${stats.LM.rezerwacja}/${stats.LM.sprzedane}`;
  const sMP = document.getElementById("stat-mp");
  if (sMP) sMP.innerText = `${stats.MP.wolne}/${stats.MP.rezerwacja}/${stats.MP.sprzedane}`;
  const sK = document.getElementById("stat-k");
  if (sK) sK.innerText = `${stats.K.wolne}/${stats.K.rezerwacja}/${stats.K.sprzedane}`;
  const sLU = document.getElementById("stat-lu");
  if (sLU) sLU.innerText = `${stats.LU.wolne}/${stats.LU.rezerwacja}/${stats.LU.sprzedane}`;
  const sArea = document.getElementById("stat-area");
  if (sArea) sArea.innerText = totalArea.toFixed(2).replace(".", ",");
}

function openModal(apt) {
  currentApt = apt;
  document.getElementById("modal-title").innerText = "Lokal " + apt.number;
  document.getElementById("m-status").value = (
    apt.status || "wolne"
  ).toLowerCase();
  document.getElementById("m-area").value = apt.area || "";
  document.getElementById("m-rooms").value = apt.rooms || "";
  document.getElementById("m-balcony").value = apt.balconyArea || "";
  document.getElementById("m-price").value = apt.price || "";

  let typeText = apt.type;
  if (apt.type === "LM") typeText = "lokal mieszkalny";
  else if (apt.type === "LU") typeText = "lokal usługowy";
  else if (apt.type === "K" || apt.type === "KL")
    typeText = "komórka lokatorska";
  else if (apt.type === "MP") typeText = "miejsce postojowe";
  const typeInput = document.getElementById("m-type");
  if (typeInput) typeInput.value = typeText;

  // Ukrywanie sekcji dla MP i Komórek
  const isMP = apt.type === "MP";
  const isK = apt.type === "K" || apt.type === "KL";
  const hideAll = isMP || isK;

  const mRooms = document.getElementById("m-rooms");
  if (mRooms && mRooms.closest(".third"))
    mRooms.closest(".third").style.display = hideAll ? "none" : "";

  const mArea = document.getElementById("m-area");
  if (mArea && mArea.closest(".third"))
    mArea.closest(".third").style.display = isMP ? "none" : ""; // Komórka zachowuje metraż

  const mBalcony = document.getElementById("m-balcony");
  if (mBalcony && mBalcony.closest(".third"))
    mBalcony.closest(".third").style.display = hideAll ? "none" : "";

  const changesTitle = Array.from(
    document.querySelectorAll(".modal-section-title"),
  ).find((el) => el.innerText.includes("Zmiany i Dodatki"));
  if (changesTitle) changesTitle.style.display = hideAll ? "none" : "";

  const dzKm = document.getElementById("dz-km");
  if (dzKm && dzKm.parentElement)
    dzKm.parentElement.style.display = hideAll ? "none" : "";

  const dzKi = document.getElementById("dz-ki");
  if (dzKi && dzKi.parentElement)
    dzKi.parentElement.style.display = hideAll ? "none" : "";

  const mParking = document.getElementById("m-parking");
  if (mParking && mParking.closest(".half"))
    mParking.closest(".half").style.display = hideAll ? "none" : "";

  const mCellar = document.getElementById("m-cellar");
  if (mCellar && mCellar.closest(".half"))
    mCellar.closest(".half").style.display = hideAll ? "none" : "";

  const mChanges = document.getElementById("m-has-changes");
  if (mChanges && mChanges.closest(".half"))
    mChanges.closest(".half").style.display = hideAll ? "none" : "";

  document.getElementById("m-client").value = apt.clientName || "";
  document.getElementById("m-phone").value = apt.clientPhone || "";
  document.getElementById("m-email").value = apt.clientEmail || "";
  document.getElementById("m-parking").value = apt.parking || "";
  document.getElementById("m-cellar").value = apt.cellar || "";
  document.getElementById("m-has-changes").value =
    apt.hasChanges === "TAK" ? "TAK" : "-";
  document.getElementById("m-info").value = apt.additionalInfo || "";

  const assignedToCont = document.getElementById("m-assigned-to-cont");
  const assignedToInput = document.getElementById("m-assigned-to");
  if (assignedToCont && assignedToInput) {
    if (hideAll) {
      assignedToCont.style.display = "block";
      let linkedLM = null;
      Object.keys(db.investments[currentInv]).forEach((b) => {
        Object.keys(db.investments[currentInv][b]).forEach((f) => {
          db.investments[currentInv][b][f].apartments.forEach((otherApt) => {
            if (otherApt.linkedMPs && otherApt.linkedMPs.includes(apt.id))
              linkedLM = otherApt;
            if (otherApt.linkedKs && otherApt.linkedKs.includes(apt.id))
              linkedLM = otherApt;
          });
        });
      });
      assignedToInput.value = linkedLM ? "LM " + linkedLM.number : "Brak";
    } else {
      assignedToCont.style.display = "none";
    }
  }

  // Obsługa miejsc postojowych i komórek lokatorskich
  const mpInput = document.getElementById("m-parking");
  const mpDropdown = document.getElementById("m-parking-dropdown");
  const mpList = document.getElementById("m-parking-list");

  const cellarInput = document.getElementById("m-cellar");
  const cellarDropdown = document.getElementById("m-cellar-dropdown");
  const cellarList = document.getElementById("m-cellar-list");

  if (apt.type !== "LM") {
    // Dla MP i K pokazujemy tylko zwykłe pole tekstowe
    if (mpInput) mpInput.style.display = "block";
    if (mpDropdown) mpDropdown.style.display = "none";
    if (cellarInput) cellarInput.style.display = "block";
    if (cellarDropdown) cellarDropdown.style.display = "none";
  } else {
    // Dla LM pokazujemy listę rozwijalną
    if (mpInput) mpInput.style.display = "none";
    if (mpDropdown) mpDropdown.style.display = "block";
    if (cellarInput) cellarInput.style.display = "none";
    if (cellarDropdown) cellarDropdown.style.display = "block";

    const allLMs = [];
    const allMPs = [];
    const allKs = [];

    // Zbieramy dane z całej inwestycji
    for (const b in db.investments[currentInv]) {
      for (const f in db.investments[currentInv][b]) {
        const apts = db.investments[currentInv][b][f].apartments || [];
        apts.forEach((a) => {
          a._building = b; // tymczasowe info do wyświetlania
          if (a.type === "LM") allLMs.push(a);
          if (a.type === "MP") allMPs.push(a);
          if (a.type === "K" || a.type === "KL") allKs.push(a);
        });
      }
    }

    // Funkcja sprawdzająca czy zasób jest przypisany do INNEGO LM
    const isAssignedToOther = (resId) => {
      for (const lm of allLMs) {
        if (lm.id === apt.id) continue;
        if (lm.linkedMPs && lm.linkedMPs.includes(resId)) return true;
        if (lm.linkedKs && lm.linkedKs.includes(resId)) return true;
      }
      return false;
    };

    const buildList = (resources, container, linkedArrayName) => {
      if (!container) return;
      container.innerHTML = "";
      const linked = apt[linkedArrayName] || [];

      let hasOptions = false;
      resources.forEach((res) => {
        if (isAssignedToOther(res.id)) return;
        hasOptions = true;
        const isChecked = linked.includes(res.id);

        const label = document.createElement("label");
        label.className = "multi-select-item";
        label.innerHTML = `<input type="checkbox" value="${res.id}" ${isChecked ? "checked" : ""}> ${res._building} - nr ${res.number}`;

        label.querySelector("input").addEventListener("change", (e) => {
          // Natychmiastowe zaktualizowanie nagłówka listy dla lepszego UX
          updateHeaders();
        });
        container.appendChild(label);
      });

      if (!hasOptions) {
        container.innerHTML =
          "<div style='font-size:11px; padding:4px;'>Brak dostępnych zasobów</div>";
      }
    };

    buildList(allMPs, mpList, "linkedMPs");
    buildList(allKs, cellarList, "linkedKs");

    const updateHeaders = () => {
      if (mpDropdown && mpList) {
        const checkedMPs = Array.from(
          mpList.querySelectorAll("input:checked"),
        ).map((i) => i.parentNode.innerText.trim().split(" - nr ")[1]);
        mpDropdown.querySelector(".multi-select-header").innerText =
          checkedMPs.length > 0
            ? checkedMPs.join(", ")
            : "Wybierz miejsce postojowe...";
      }
      if (cellarDropdown && cellarList) {
        const checkedKs = Array.from(
          cellarList.querySelectorAll("input:checked"),
        ).map((i) => i.parentNode.innerText.trim().split(" - nr ")[1]);
        cellarDropdown.querySelector(".multi-select-header").innerText =
          checkedKs.length > 0 ? checkedKs.join(", ") : "Wybierz komórkę...";
      }
    };

    updateHeaders();
  }

  document.getElementById("m-file-km").value = "";
  document.getElementById("m-file-ki").value = "";
  document.getElementById("m-file-kz").value = "";

  const updateDzState = (type, hasFile) => {
    document.getElementById("dz-" + type).style.display = hasFile
      ? "none"
      : "block";
    document.getElementById("pill-" + type).style.display = hasFile
      ? "flex"
      : "none";
  };
  updateDzState("km", apt.hasKM);
  updateDzState("ki", apt.hasKI);
  pendingKzFiles = [];
  renderKzList();

  pendingContractFiles = [];
  const minp = document.getElementById("m-file-contract");
  if (minp) minp.value = "";
  renderContractList();
  document.getElementById("modal-overlay").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
}

async function saveAptData() {
  if (!currentApt) return;
  const prevLinkedIds = [
    ...(currentApt.linkedMPs || []),
    ...(currentApt.linkedKs || []),
  ];
  Object.assign(currentApt, {
    status: document.getElementById("m-status").value,
    area: document.getElementById("m-area").value,
    rooms: document.getElementById("m-rooms").value,
    balconyArea: document.getElementById("m-balcony").value,
    price: document.getElementById("m-price").value,
    clientName: document.getElementById("m-client").value,
    clientPhone: document.getElementById("m-phone").value,
    clientEmail: document.getElementById("m-email").value,
    parking: document.getElementById("m-parking").value,
    cellar: document.getElementById("m-cellar").value,
    hasChanges: document.getElementById("m-has-changes").value,
    additionalInfo: document.getElementById("m-info").value,
  });

  const mpList = document.getElementById("m-parking-list");
  if (mpList) {
    currentApt.linkedMPs = Array.from(
      mpList.querySelectorAll("input:checked"),
    ).map((i) => i.value);
  }
  const cellarList = document.getElementById("m-cellar-list");
  if (cellarList) {
    currentApt.linkedKs = Array.from(
      cellarList.querySelectorAll("input:checked"),
    ).map((i) => i.value);
  }

  const allApts = [];
  Object.keys(db.investments[currentInv]).forEach((b) => {
    Object.keys(db.investments[currentInv][b]).forEach((f) => {
      allApts.push(...db.investments[currentInv][b][f].apartments);
    });
  });

  if (
    currentApt.type === "LM" ||
    currentApt.type === "LU" ||
    !currentApt.type
  ) {
    const linkedIds = [
      ...(currentApt.linkedMPs || []),
      ...(currentApt.linkedKs || []),
    ];
    const unlinkedIds = prevLinkedIds.filter((id) => !linkedIds.includes(id));
    allApts.forEach((otherApt) => {
      if (linkedIds.includes(otherApt.id)) {
        otherApt.status = currentApt.status;
        otherApt.clientName = currentApt.clientName;
        otherApt.clientPhone = currentApt.clientPhone;
        otherApt.clientEmail = currentApt.clientEmail;
      }
      if (unlinkedIds.includes(otherApt.id)) {
        otherApt.status = "wolne";
        otherApt.clientName = "";
        otherApt.clientPhone = "";
        otherApt.clientEmail = "";
        otherApt.contracts = [];
        otherApt.kzFiles = [];
        otherApt.hasChanges = "NIE";
        otherApt.hasChangeFile = false;
        otherApt.additionalInfo = "";
      }
    });
  } else if (
    currentApt.type === "MP" ||
    currentApt.type === "K" ||
    currentApt.type === "KL"
  ) {
    let linkedLM = null;
    allApts.forEach((otherApt) => {
      if (otherApt.linkedMPs && otherApt.linkedMPs.includes(currentApt.id))
        linkedLM = otherApt;
      if (otherApt.linkedKs && otherApt.linkedKs.includes(currentApt.id))
        linkedLM = otherApt;
    });

    if (linkedLM) {
      linkedLM.status = currentApt.status;
      linkedLM.clientName = currentApt.clientName;
      linkedLM.clientPhone = currentApt.clientPhone;
      linkedLM.clientEmail = currentApt.clientEmail;

      const allLinkedIds = [
        ...(linkedLM.linkedMPs || []),
        ...(linkedLM.linkedKs || []),
      ];
      allApts.forEach((a) => {
        if (a.id !== currentApt.id && allLinkedIds.includes(a.id)) {
          a.status = currentApt.status;
          a.clientName = currentApt.clientName;
          a.clientPhone = currentApt.clientPhone;
          a.clientEmail = currentApt.clientEmail;
        }
      });
    }
  }

  const uploadSingle = async (id, type) => {
    const f = document.getElementById(id).files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("devId", devId);
    fd.append("investId", currentInv);
    fd.append("buildingId", getAptBuilding());
    fd.append("aptNumber", currentApt.number);
    fd.append("type", type);
    fd.append("file", f);
    const r = await fetch("/api/upload-card", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: fd,
    });
    if (r.ok) {
      if (type === "km") currentApt.hasKM = true;
      if (type === "ki") currentApt.hasKI = true;
      if (type === "kz") currentApt.hasChangeFile = true;
    }
  };
  const cInp =
    document.getElementById("m-file-contract") ||
    document.getElementById("m-files-contract");
  const contractFiles = cInp ? cInp.files : [];
  if (!currentApt.contracts) currentApt.contracts = [];
  const uploadContracts = async () => {
    if (pendingContractFiles.length === 0) return;
    if (!currentApt.contracts) currentApt.contracts = [];

    for (let f of pendingContractFiles) {
      const fd = new FormData();
      fd.append("devId", devId);
      fd.append("investId", currentInv);
      fd.append("buildingId", getAptBuilding());
      fd.append("aptNumber", currentApt.number);
      fd.append("type", "contract");
      fd.append("file", f);

      const r = await fetch("/api/upload-card", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body: fd,
      });
      if (r.ok) {
        const data = await r.json();
        if (!currentApt.contracts.includes(data.filename)) {
          currentApt.contracts.push(data.filename);
        }
      }
    }
    pendingContractFiles = [];
  };
  await Promise.all([
    uploadSingle("m-file-km", "km"),
    uploadSingle("m-file-ki", "ki"),
    uploadKzFiles(),
    uploadContracts(),
  ]);
  const changedApts = [currentApt];
  if (currentApt.type === "LM" || currentApt.type === "LU" || !currentApt.type) {
    const linkedIds = [...(currentApt.linkedMPs || []), ...(currentApt.linkedKs || [])];
    const unlinkedIds = prevLinkedIds.filter((id) => !linkedIds.includes(id));
    allApts.forEach(other => {
      if ((linkedIds.includes(other.id) || unlinkedIds.includes(other.id)) && !changedApts.includes(other)) {
        changedApts.push(other);
      }
    });
  } else {
    let linkedLM = null;
    allApts.forEach((other) => {
      if (other.linkedMPs && other.linkedMPs.includes(currentApt.id)) linkedLM = other;
      if (other.linkedKs && other.linkedKs.includes(currentApt.id)) linkedLM = other;
    });
    if (linkedLM) {
      if (!changedApts.includes(linkedLM)) changedApts.push(linkedLM);
      const allLinkedIds = [...(linkedLM.linkedMPs || []), ...(linkedLM.linkedKs || [])];
      allApts.forEach(a => {
        if (allLinkedIds.includes(a.id) && !changedApts.includes(a)) changedApts.push(a);
      });
    }
  }

  try {
    await saveApartmentsOnServer(changedApts);
    updateRoomFilter();
    render();
    renderSvgOnly();
    closeModal();
    alert("Zapisano!");
  } catch (err) {
    if (err.message === "Conflict") {
      closeModal();
    }
  }
}

async function refreshData() {
  try {
    const res = await fetch(`/api/data/${devId}?t=${Date.now()}`);
    if (res.ok) {
      const rawData = await res.json();
      // Zaktualizuj wersję pliku
      dbVersion = rawData._dbVersion || null;
      const { _dbVersion: _v, ...cleanData } = rawData;
      db = cleanData;
      render();
      renderSvgOnly();
    }
  } catch (e) {
    console.error("Błąd odświeżania danych:", e);
  }
}

async function saveApartmentsOnServer(apts) {
  setSaveStatus('saving');
  const res = await fetch(`/api/save-apt/${devId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      investId: currentInv,
      buildingId: getAptBuilding(),
      floorId: currentFloor,
      aptsToSave: apts
    }),
  });
  if (!res.ok) {
    if (res.status === 409) {
      setSaveStatus('conflict');
      const errorData = await res.json();
      alert(errorData.error || "Ten lokal został zmodyfikowany w międzyczasie przez innego użytkownika. Dane zostały odświeżone.");
      await refreshData();
      throw new Error("Conflict");
    }
    setSaveStatus('unsaved');
    const txt = await res.text();
    alert("Błąd zapisu: " + txt);
    throw new Error(txt);
  }
  const result = await res.json();
  setSaveStatus('saved');
  if (result.updatedVersions) {
    Object.keys(result.updatedVersions).forEach(aptId => {
      const ver = result.updatedVersions[aptId];
      const floors = db.investments[currentInv]?._floors || {};
      Object.values(floors).forEach(f => {
        const foundApt = (f.apartments || []).find(a => a.id === aptId);
        if (foundApt) foundApt.version = ver;
      });
    });
  }
  return result;
}

async function deleteContractFile(fileName) {
  if (!confirm(`Usunąć umowę: ${fileName}?`)) return;
  try {
    const res = await fetch("/api/delete-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        devId,
        investId: currentInv,
        buildingId: getAptBuilding(),
        type: "contract",
        aptNumber: currentApt.number,
        filename: fileName,
      }),
    });
    if (res.ok) {
      currentApt.contracts = currentApt.contracts.filter((f) => f !== fileName);
      try {
        await saveApartmentsOnServer([currentApt]);
        renderContractList();
        render();
      } catch (err) {
        // błąd obsłużony w saveApartmentsOnServer
      }
    } else {
      const txt = await res.text();
      alert("Błąd serwera podczas usuwania: " + res.status + " " + txt);
    }
  } catch (err) {
    console.error(err);
    alert("Błąd aplikacji: " + err.message);
  }
}

async function deleteFile(type, fileName) {
  try {
    const input = document.getElementById("m-file-" + type);
    let hasSavedFile = false;
    if (type === "km") hasSavedFile = currentApt.hasKM;
    if (type === "ki") hasSavedFile = currentApt.hasKI;

    if (type !== "kz" && !hasSavedFile && input && input.files.length > 0) {
      input.value = "";
      document.getElementById("dz-" + type).style.display = "block";
      document.getElementById("pill-" + type).style.display = "none";
      return;
    }

    if (!confirm("Usunąć plik?")) return;

    const res = await fetch("/api/delete-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        devId,
        investId: currentInv,
        buildingId: getAptBuilding(),
        type,
        aptNumber: currentApt.number,
        filename: fileName || "",
      }),
    });

    if (res.ok) {
      if (type === "km") currentApt.hasKM = false;
      if (type === "ki") currentApt.hasKI = false;
      if (type === "kz") {
        if (!currentApt.kzFiles) currentApt.kzFiles = [];
        currentApt.kzFiles = currentApt.kzFiles.filter((f) => f !== fileName);
        currentApt.hasChangeFile = currentApt.kzFiles.length > 0;
      }
      try {
        await saveApartmentsOnServer([currentApt]);
        openModal(currentApt);
        render();
      } catch (err) {
        if (err.message === "Conflict") {
          closeModal();
        }
      }
    } else {
      const txt = await res.text();
      alert("Błąd serwera podczas usuwania: " + res.status + " " + txt);
    }
  } catch (err) {
    console.error(err);
    alert("Błąd aplikacji: " + err.message);
  }
}

function toggleMobileView(view) {
  const container = document.getElementById("main-view");
  if (!container) return;
  if (view === "map") {
    container.classList.add("mobile-map-active");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  } else {
    container.classList.remove("mobile-map-active");
  }
}

function openPdf(url, aptNumber, typeName) {
  if (typeof toggleMobileView === "function") toggleMobileView("map");
  currentPdfUrl = url;
  document.getElementById("map-cont").style.display = "none";
  document.getElementById("no-floor-msg").style.display = "none";
  document.getElementById("nav-elements").style.display = "none";
  document.getElementById("pdf-doc-info").innerText =
    `Lokal: ${aptNumber} | ${typeName.toUpperCase()}`;
  const viewer = document.getElementById("pdf-viewer");
  viewer.src = url;
  viewer.style.display = "block";
  document.getElementById("pdf-toolbar").style.display = "flex";
}

function closePdf() {
  document.getElementById("pdf-viewer").style.display = "none";
  document.getElementById("pdf-viewer").src = "";
  document.getElementById("pdf-toolbar").style.display = "none";
  document.getElementById("nav-elements").style.display = "flex";
  currentPdfUrl = "";
  if (currentFloor) {
    document.getElementById("map-cont").style.display = "block";
    document.getElementById("zoom-controls").style.display = "flex";
  } else document.getElementById("no-floor-msg").style.display = "block";
}


function downloadExcel() {
  if (!currentInv) {
    alert("Wybierz najpierw inwestycję!");
    return;
  }
  let csvContent =
    "Inwestycja;Budynek;Pietro;Nr lokalu;Status;Metraz (m2);Balkon/Taras/Ogrod;Pokoje;Cena calkowita (PLN);Cena za m2;Nabywca;Telefon;Email;Miejsce postojowe;Komorka lokatorska;Uwagi\n";
  Object.keys(db.investments[currentInv]).forEach((buildName) => {
    Object.keys(db.investments[currentInv][buildName]).forEach((floorName) => {
      const floorData = db.investments[currentInv][buildName][floorName];
      floorData.apartments.forEach((apt) => {
        const numericArea =
          parseFloat(apt.area.toString().replace(",", ".")) || 0;
        const numericPrice =
          parseFloat(
            (apt.price || "0").toString().replace(/\s/g, "").replace(",", "."),
          ) || 0;
        const perM2 =
          numericPrice > 0 && numericArea > 0
            ? Math.round(numericPrice / numericArea)
            : 0;
        const row = [
          currentInv,
          buildName,
          floorName,
          apt.number,
          apt.status,
          apt.area,
          apt.balconyArea,
          apt.rooms,
          numericPrice > 0 ? Math.round(numericPrice) : "",
          perM2 > 0 ? perM2 : "",
          apt.clientName,
          apt.clientPhone,
          apt.clientEmail,
          apt.parking,
          apt.cellar,
          apt.additionalInfo,
        ]
          .map((v) => `"${(v || "").toString().replace(/"/g, '""')}"`)
          .join(";");
        csvContent += row + "\n";
      });
    });
  });
  const blob = new Blob(["\ufeff" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Eksport_${currentInv}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    const content = e.target.result;
    const lines = content.split("\n");
    let updatedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i]
        .split(";")
        .map((c) => c.replace(/^"|"$/g, "").trim());
      if (cols.length < 16) continue;
      const invName = cols[0],
        buildName = cols[1],
        floorName = cols[2],
        aptNr = cols[3];
      if (db.investments[invName]?.[buildName]?.[floorName]) {
        const apt = db.investments[invName][buildName][
          floorName
        ].apartments.find((a) => a.number.toString() === aptNr.toString());
        if (apt) {
          apt.status = cols[4].toLowerCase() || "wolne";
          apt.area = cols[5];
          apt.balconyArea = cols[6];
          apt.rooms = cols[7];
          apt.price = cols[8];
          apt.clientName = cols[10];
          apt.clientPhone = cols[11];
          apt.clientEmail = cols[12];
          apt.parking = cols[13];
          apt.cellar = cols[14];
          apt.additionalInfo = cols[15];
          updatedCount++;
        }
      }
    }
    if (updatedCount > 0) {
      setSaveStatus('saving');
      const saveRes = await fetch(`/api/save/${devId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ ...db, _dbVersion: dbVersion }),
      });
      if (!saveRes.ok) {
        if (saveRes.status === 409) {
          setSaveStatus('conflict');
          const errData = await saveRes.json();
          alert(
            "⚠️ KONFLIKT DANYCH\n\n" +
            (errData.error || "Dane zostały zmienione przez inną osobę.") +
            "\n\nTwój plik CSV NIE został wgrany. Odśwież stronę i spróbuj ponownie."
          );
        } else {
          setSaveStatus('unsaved');
          alert("Błąd zapisu: " + saveRes.status);
        }
        event.target.value = "";
        return;
      }
      // Zapisz nową wersję pliku z serwera
      const saveResult = await saveRes.json();
      if (saveResult._dbVersion) dbVersion = saveResult._dbVersion;
      setSaveStatus('saved');
      alert(`Pomyślnie zaktualizowano ${updatedCount} lokali.`);
      render();
      renderSvgOnly();
    } else {
      alert("Nie znaleziono pasujących lokali.");
    }
    event.target.value = "";
  };
  reader.readAsText(file, "UTF-8");
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "index.html";
}

let currentZoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

function updateMapTransform() {
  const cont = document.getElementById("map-cont");
  if (cont)
    cont.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
}

function zoomIn() {
  currentZoom = Math.min(currentZoom * 1.2, 5);
  updateMapTransform();
}
function zoomOut() {
  currentZoom = Math.max(currentZoom / 1.2, 0.2);
  updateMapTransform();
}
function resetZoom() {
  currentZoom = 1;
  panX = 0;
  panY = 0;
  updateMapTransform();
}

async function initHeader() {
  try {
    const res = await fetch("/api/me");
  } catch (e) {
    console.error(e);
  }
}

window.onload = () => {
  // Setup Drag & Drop

  const dzKz = document.getElementById("dz-kz");
  const inputKz = document.getElementById("m-file-kz");
  if (dzKz && inputKz) {
    dzKz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dzKz.classList.add("dragover");
    });
    dzKz.addEventListener("dragleave", () => dzKz.classList.remove("dragover"));
    dzKz.addEventListener("drop", (e) => {
      e.preventDefault();
      dzKz.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          pendingKzFiles.push(e.dataTransfer.files[i]);
        }
        renderKzList();
      }
    });
    inputKz.addEventListener("change", () => {
      if (inputKz.files && inputKz.files.length > 0) {
        for (let i = 0; i < inputKz.files.length; i++) {
          pendingKzFiles.push(inputKz.files[i]);
        }
        renderKzList();
        inputKz.value = ""; // clear so same file can be selected again
      }
    });
  }

  const dzContract = document.getElementById("dz-contract");
  const inputContract = document.getElementById("m-file-contract");
  if (dzContract && inputContract) {
    dzContract.addEventListener("dragover", (e) => {
      e.preventDefault();
      dzContract.classList.add("dragover");
    });
    dzContract.addEventListener("dragleave", () =>
      dzContract.classList.remove("dragover"),
    );
    dzContract.addEventListener("drop", (e) => {
      e.preventDefault();
      dzContract.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          pendingContractFiles.push(e.dataTransfer.files[i]);
        }
        renderContractList();
      }
    });
    inputContract.addEventListener("change", () => {
      if (inputContract.files && inputContract.files.length > 0) {
        for (let i = 0; i < inputContract.files.length; i++) {
          pendingContractFiles.push(inputContract.files[i]);
        }
        renderContractList();
        inputContract.value = "";
      }
    });
  }

  ["km", "ki"].forEach((type) => {
    const dz = document.getElementById("dz-" + type);
    const input = document.getElementById("m-file-" + type);
    const pill = document.getElementById("pill-" + type);
    const nameLabel = document.getElementById("name-" + type);

    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event("change"));
      }
    });

    input.addEventListener("change", () => {
      if (input.files && input.files.length > 0) {
        dz.style.display = "none";
        pill.style.display = "flex";
        nameLabel.innerText = "📄 " + input.files[0].name;
      }
    });
  });

  init();

  const canvasArea = document.getElementById("canvas-area");
  if (canvasArea) {
    canvasArea.addEventListener(
      "wheel",
      function (e) {
        if (document.getElementById("map-cont").style.display === "none")
          return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25;
        let newZoom = currentZoom * factor;
        newZoom = Math.min(Math.max(newZoom, 0.2), 5);

        if (newZoom !== currentZoom) {
          const rect = canvasArea.getBoundingClientRect();
          const mx = e.clientX - rect.left - rect.width / 2;
          const my = e.clientY - rect.top - rect.height / 2;

          panX = mx - (mx - panX) * (newZoom / currentZoom);
          panY = my - (my - panY) * (newZoom / currentZoom);
          currentZoom = newZoom;
          updateMapTransform();
        }
      },
      { passive: false },
    );

    canvasArea.addEventListener("mousedown", function (e) {
      if (document.getElementById("map-cont").style.display === "none") return;
      if (
        e.button === 1 ||
        (e.button === 0 &&
          e.target.tagName !== "polygon" &&
          e.target.tagName !== "circle")
      ) {
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        canvasArea.style.cursor = "grabbing";
        e.preventDefault();
      }
    });

    window.addEventListener("mousemove", function (e) {
      if (!isPanning) return;
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      updateMapTransform();
    });

    window.addEventListener("mouseup", function () {
      if (isPanning) {
        isPanning = false;
        canvasArea.style.cursor = "default";
      }
    });
  }
};

// Allow closing modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("modal-overlay");
    const pdfViewer = document.getElementById("pdf-viewer");
    // If PDF is open, Escape should close PDF first
    if (pdfViewer && pdfViewer.style.display === "block") {
      closePdf();
    }
    // Otherwise, close the modal if it's open
    else if (modal && modal.style.display === "flex") {
      closeModal();
    }
  }
});

window.toggleDropdown = function (id) {
  const lists = document.querySelectorAll(".multi-select-list");
  lists.forEach((l) => {
    if (l.id !== id) {
      l.style.display = "none";
      const parent = l.closest(".half");
      if (parent) parent.style.zIndex = "1";
    }
  });
  const el = document.getElementById(id);
  if (el) {
    const isOpening = el.style.display === "none";
    el.style.display = isOpening ? "flex" : "none";
    const parent = el.closest(".half");
    if (parent) parent.style.zIndex = isOpening ? "999" : "1";
  }
};
document.addEventListener("click", (e) => {
  if (!e.target.closest(".multi-select-container")) {
    const lists = document.querySelectorAll(".multi-select-list");
    lists.forEach((l) => (l.style.display = "none"));
  }
});
