/**
 * Travel Planner PWA — LocalStorage + Google Maps deep links
 */

const STORAGE_KEY = "travel-planner-data-v1";
const EXPORT_TYPE = "travel-planner-export";
const EXPORT_VERSION = 1;

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  data: null,
  activeTripId: null,
  activeDayId: null,
  editingPlaceId: null,
  editingDayId: null,
};

// ——— Utilities ———

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return normalizeData(parsed);
  } catch {
    return defaultData();
  }
}

function defaultData() {
  return { trips: [], activeTripId: null, activeDayId: null };
}

function normalizeData(data) {
  if (!data || !Array.isArray(data.trips)) return defaultData();
  data.trips.forEach((trip) => {
    trip.id = trip.id || uid();
    trip.days = Array.isArray(trip.days) ? trip.days : [];
    trip.days.forEach((day) => {
      day.id = day.id || uid();
      day.places = Array.isArray(day.places) ? day.places : [];
      day.places.forEach((place) => {
        place.id = place.id || uid();
      });
      day.places.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    });
    trip.days.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  });
  return data;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  flashSaveStatus();
}

let saveStatusTimer;
function flashSaveStatus() {
  const el = $("#save-status");
  if (!el) return;
  el.textContent = "저장됨";
  el.classList.add("footer__status--saved");
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    el.textContent = "";
    el.classList.remove("footer__status--saved");
  }, 1500);
}

function getActiveTrip() {
  return state.data.trips.find((t) => t.id === state.activeTripId) || null;
}

function getActiveDay() {
  const trip = getActiveTrip();
  if (!trip) return null;
  return trip.days.find((d) => d.id === state.activeDayId) || null;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

function formatTime(timeStr) {
  if (!timeStr) return "--:--";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "오후" : "오전";
  const h12 = hour % 12 || 12;
  return `${ampm} ${h12}:${m}`;
}

function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function getNowMinutesPrecise() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
}

function formatNowTime() {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

const LAST_STOP_MINUTES = 45;

let nowIndicatorTimer = null;

const WALKER_HTML = `
  <span class="timeline-now__ring" aria-hidden="true"></span>
  <span class="timeline-now__time" id="timeline-now-time"></span>
  <span class="walker" aria-hidden="true">
    <svg class="walker__svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g class="walker__figure">
        <circle cx="15" cy="5.5" r="4" fill="currentColor"/>
        <path d="M15 9.8v10.2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <g class="walker__arm walker__arm--back">
          <path d="M15 11.5 10.5 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M10.5 16 9.2 19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </g>
        <g class="walker__arm walker__arm--front">
          <path d="M15 11.5 19.5 15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M19.5 15.5 20.8 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </g>
        <g class="walker__leg walker__leg--back">
          <g class="walker__thigh-wrap">
            <path d="M15 20.5 12 27.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            <g class="walker__shin-wrap">
              <g class="walker__shin-rot">
                <path d="M12 27.2 11 35.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </g>
            </g>
          </g>
        </g>
        <g class="walker__leg walker__leg--front">
          <g class="walker__thigh-wrap">
            <path d="M15 20.5 18 27.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            <g class="walker__shin-wrap">
              <g class="walker__shin-rot">
                <path d="M18 27.2 19.2 35.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  </span>
`;

/**
 * Google Maps deep link (iOS Safari / PWA friendly)
 * @see https://developers.google.com/maps/documentation/urls/get-started
 */
function googleMapsUrl(place) {
  const lat = parseFloat(place.lat);
  const lng = parseFloat(place.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const parts = [place.name, place.address].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
}

// ——— Render ———

function render() {
  renderTripSelect();
  renderWelcomeOrPanel();
  renderDaysNav();
  renderTimeline();
}

function renderTripSelect() {
  const select = $("#trip-select");
  const deleteBtn = $("#btn-delete-trip");
  const trips = state.data.trips;

  select.innerHTML = "";
  if (trips.length === 0) {
    select.disabled = true;
    deleteBtn.hidden = true;
    return;
  }

  select.disabled = false;
  deleteBtn.hidden = false;
  trips.forEach((trip) => {
    const opt = document.createElement("option");
    opt.value = trip.id;
    opt.textContent = trip.name;
    if (trip.id === state.activeTripId) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderWelcomeOrPanel() {
  const welcome = $("#welcome");
  const panel = $("#day-panel");
  const hasTrip = state.data.trips.length > 0 && state.activeTripId;

  if (!hasTrip) {
    welcome.hidden = false;
    panel.hidden = true;
    return;
  }

  welcome.hidden = true;
  panel.hidden = false;

  const day = getActiveDay();
  const title = $("#day-title");
  const editDayBtn = $("#btn-edit-day");
  if (day) {
    const label = day.label ? ` · ${day.label}` : "";
    title.textContent = `${formatDate(day.date)}${label}`;
    editDayBtn.hidden = false;
  } else {
    title.textContent = "일자를 선택하거나 추가하세요";
    editDayBtn.hidden = true;
  }
}

function renderDaysNav() {
  const nav = $("#days-nav");
  nav.innerHTML = "";

  const trip = getActiveTrip();
  if (!trip) return;

  trip.days.forEach((day) => {
    const btn = document.createElement("button");
    const isToday = day.date === getTodayISO();
    btn.type = "button";
    btn.className = [
      "day-chip",
      day.id === state.activeDayId ? "day-chip--active" : "",
      isToday ? "day-chip--today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    btn.dataset.dayId = day.id;
    btn.innerHTML = `
      <span class="day-chip__date">${formatDate(day.date)}</span>
      ${day.label ? `<span class="day-chip__label">${escapeHtml(day.label)}</span>` : ""}
    `;
    btn.addEventListener("click", () => selectDay(day.id));
    nav.appendChild(btn);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "day-chip day-chip--add";
  addBtn.textContent = "+ 일자";
  addBtn.addEventListener("click", openDayModal);
  nav.appendChild(addBtn);

  if (!state.activeDayId && trip.days.length > 0) {
    selectDay(trip.days[0].id);
  }
}

function getScheduleWindow(day) {
  if (!day?.places?.length) return null;
  const times = day.places.map((p) => timeToMinutes(p.time));
  return { start: times[0], end: times[times.length - 1] + LAST_STOP_MINUTES };
}

function isNowInSchedule(day) {
  if (day.date !== getTodayISO()) return false;
  const window = getScheduleWindow(day);
  if (!window) return false;
  const now = getNowMinutes();
  return now >= window.start && now <= window.end;
}

function getRailY(item, timelineEl, timelineRect) {
  const track = item.querySelector(".timeline-item__track");
  const r = track.getBoundingClientRect();
  const dotY = parseFloat(getComputedStyle(timelineEl).getPropertyValue("--tl-dot-y")) || 22;
  return r.top + dotY - timelineRect.top;
}

function getWalkerTopPx(timeline, day) {
  const items = [...timeline.querySelectorAll(".timeline-item")];
  if (!items.length) return null;

  const now = getNowMinutesPrecise();
  const places = day.places;
  const timelineRect = timeline.getBoundingClientRect();
  const railY = (item) => getRailY(item, timeline, timelineRect);

  if (places.length === 1) {
    const t0 = timeToMinutes(places[0].time);
    if (now < t0 || now > t0 + LAST_STOP_MINUTES) return null;
    return railY(items[0]);
  }

  for (let i = 0; i < places.length - 1; i++) {
    const t0 = timeToMinutes(places[i].time);
    const t1 = timeToMinutes(places[i + 1].time);
    if (now >= t0 && now <= t1) {
      const y0 = railY(items[i]);
      const y1 = railY(items[i + 1]);
      const ratio = t1 === t0 ? 0 : (now - t0) / (t1 - t0);
      return y0 + ratio * (y1 - y0);
    }
  }

  const lastT = timeToMinutes(places[places.length - 1].time);
  if (now > lastT && now <= lastT + LAST_STOP_MINUTES) {
    return railY(items[items.length - 1]);
  }

  return null;
}

function markTimelineProgress(day) {
  if (day.date !== getTodayISO()) return;

  const now = getNowMinutesPrecise();
  const items = document.querySelectorAll(".timeline-item");

  items.forEach((item, i) => {
    item.classList.remove("timeline-item--passed", "timeline-item--current");
    const place = day.places[i];
    if (!place) return;

    const t = timeToMinutes(place.time);
    const nextT =
      i < day.places.length - 1
        ? timeToMinutes(day.places[i + 1].time)
        : t + LAST_STOP_MINUTES;

    if (now > nextT) {
      item.classList.add("timeline-item--passed");
    } else if (now >= t && now <= nextT) {
      item.classList.add("timeline-item--current");
    }
  });
}

function updateTimelineNow() {
  const timeline = $("#timeline");
  const nowEl = $("#timeline-now");
  const timeLabel = $("#timeline-now-time");
  if (!timeline || !nowEl) return;

  const day = getActiveDay();
  const showLive = Boolean(day && isNowInSchedule(day));

  timeline.classList.toggle("timeline--live", showLive);

  if (!showLive) {
    nowEl.hidden = true;
    document.querySelectorAll(".timeline-item--passed, .timeline-item--current").forEach((el) => {
      el.classList.remove("timeline-item--passed", "timeline-item--current");
    });
    return;
  }

  const top = getWalkerTopPx(timeline, day);
  if (top == null) {
    nowEl.hidden = true;
    timeline.classList.remove("timeline--live");
    return;
  }

  markTimelineProgress(day);
  nowEl.hidden = false;
  nowEl.style.top = `${top}px`;
  if (timeLabel) timeLabel.textContent = formatNowTime();
}

function scheduleNowIndicator() {
  clearInterval(nowIndicatorTimer);
  updateTimelineNow();
  nowIndicatorTimer = setInterval(updateTimelineNow, 30_000);
}

function renderTimeline() {
  const timeline = $("#timeline");
  const empty = $("#places-empty");
  timeline.innerHTML = "";

  const day = getActiveDay();
  if (!day) {
    empty.hidden = false;
    scheduleNowIndicator();
    return;
  }

  if (day.places.length === 0) {
    empty.hidden = false;
    scheduleNowIndicator();
    return;
  }

  empty.hidden = true;

  const nowEl = document.createElement("div");
  nowEl.className = "timeline-now";
  nowEl.id = "timeline-now";
  nowEl.hidden = true;
  nowEl.setAttribute("aria-hidden", "true");
  nowEl.innerHTML = WALKER_HTML;
  timeline.appendChild(nowEl);

  day.places.forEach((place) => {
    const item = document.createElement("article");
    item.className = "timeline-item";
    item.setAttribute("role", "listitem");
    item.dataset.time = place.time;

    const mapsUrl = googleMapsUrl(place);
    const todosHtml = place.todos?.trim()
      ? `<p class="timeline-card__todos">${escapeHtml(place.todos)}</p>`
      : "";

    item.innerHTML = `
      <div class="timeline-item__time-col">
        <span class="timeline-item__time">${formatTime(place.time)}</span>
      </div>
      <div class="timeline-item__track" aria-hidden="true">
        <span class="timeline-item__dot"></span>
      </div>
      <div class="timeline-card">
        <h3 class="timeline-card__name">${escapeHtml(place.name)}</h3>
        ${place.address ? `<p class="timeline-card__address">${escapeHtml(place.address)}</p>` : ""}
        ${todosHtml}
        <div class="timeline-card__actions">
          <a class="btn-maps" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            구글맵 보기
          </a>
          <div class="btn-action-group">
            <button type="button" class="btn-action btn-action--edit" data-edit="${place.id}" aria-label="장소 수정">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
              <span>수정</span>
            </button>
            <button type="button" class="btn-action btn-action--delete" data-delete="${place.id}" aria-label="장소 삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
              <span>삭제</span>
            </button>
          </div>
        </div>
      </div>
    `;

    item.querySelector(`[data-edit="${place.id}"]`).addEventListener("click", () =>
      openPlaceModal(place.id)
    );
    item.querySelector(`[data-delete="${place.id}"]`).addEventListener("click", () =>
      deletePlace(place.id)
    );

    timeline.appendChild(item);
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(scheduleNowIndicator);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ——— Actions ———

function selectTrip(tripId) {
  state.activeTripId = tripId;
  state.data.activeTripId = tripId;
  const trip = getActiveTrip();
  state.activeDayId = trip?.days[0]?.id || null;
  state.data.activeDayId = state.activeDayId;
  saveData();
  render();
}

function selectDay(dayId) {
  state.activeDayId = dayId;
  state.data.activeDayId = dayId;
  saveData();
  renderDaysNav();
  renderWelcomeOrPanel();
  renderTimeline();
}

function openTripModal() {
  const modal = $("#modal-trip");
  $("#modal-trip-title").textContent = "새 여행";
  $("#trip-name").value = "";
  modal.showModal();
  $("#trip-name").focus();
}

function createTrip(name) {
  const trip = {
    id: uid(),
    name: name.trim(),
    days: [],
  };
  state.data.trips.push(trip);
  state.activeTripId = trip.id;
  state.activeDayId = null;
  state.data.activeTripId = trip.id;
  state.data.activeDayId = null;
  saveData();
  render();
}

function deleteActiveTrip() {
  const trip = getActiveTrip();
  if (!trip) return;
  if (!confirm(`「${trip.name}」 여행과 모든 일정을 삭제할까요?`)) return;

  state.data.trips = state.data.trips.filter((t) => t.id !== trip.id);
  state.activeTripId = state.data.trips[0]?.id || null;
  state.activeDayId = getActiveTrip()?.days[0]?.id || null;
  state.data.activeTripId = state.activeTripId;
  state.data.activeDayId = state.activeDayId;
  saveData();
  render();
}

function openDayModal(dayId = null) {
  state.editingDayId = dayId;
  const modal = $("#modal-day");
  const isEdit = Boolean(dayId);

  $("#modal-day-title").textContent = isEdit ? "일자 수정" : "일자 추가";
  $("#btn-day-submit").textContent = isEdit ? "저장" : "추가";

  if (isEdit) {
    const trip = getActiveTrip();
    const day = trip?.days.find((d) => d.id === dayId);
    if (!day) return;
    $("#day-date").value = day.date || "";
    $("#day-label").value = day.label || "";
  } else {
    $("#day-date").value = new Date().toISOString().slice(0, 10);
    $("#day-label").value = "";
  }

  modal.showModal();
  $("#day-date").focus();
}

function saveDay(date, label) {
  const trip = getActiveTrip();
  if (!trip) return;

  const trimmedLabel = label.trim();
  const duplicate = trip.days.find(
    (d) => d.date === date && d.id !== state.editingDayId
  );
  if (duplicate) {
    alert("이미 같은 날짜의 일정이 있습니다.");
    return false;
  }

  if (state.editingDayId) {
    const day = trip.days.find((d) => d.id === state.editingDayId);
    if (!day) return false;
    day.date = date;
    day.label = trimmedLabel;
    trip.days.sort((a, b) => a.date.localeCompare(b.date));
    state.activeDayId = day.id;
    state.data.activeDayId = day.id;
  } else {
    const day = {
      id: uid(),
      date,
      label: trimmedLabel,
      places: [],
    };
    trip.days.push(day);
    trip.days.sort((a, b) => a.date.localeCompare(b.date));
    state.activeDayId = day.id;
    state.data.activeDayId = day.id;
  }

  state.editingDayId = null;
  saveData();
  render();
  return true;
}

function openPlaceModal(placeId = null) {
  state.editingPlaceId = placeId;
  const modal = $("#modal-place");
  const isEdit = Boolean(placeId);
  $("#modal-place-title").textContent = isEdit ? "장소 수정" : "장소 추가";

  if (isEdit) {
    const day = getActiveDay();
    const place = day?.places.find((p) => p.id === placeId);
    if (!place) return;
    $("#place-time").value = place.time || "09:00";
    $("#place-name").value = place.name || "";
    $("#place-address").value = place.address || "";
    $("#place-lat").value = place.lat ?? "";
    $("#place-lng").value = place.lng ?? "";
    $("#place-todos").value = place.todos || "";
  } else {
    $("#form-place").reset();
    $("#place-time").value = "09:00";
  }

  modal.showModal();
  $("#place-name").focus();
}

function savePlace(formData) {
  const day = getActiveDay();
  if (!day) return;

  const place = {
    id: state.editingPlaceId || uid(),
    time: formData.time,
    name: formData.name,
    address: formData.address,
    lat: formData.lat,
    lng: formData.lng,
    todos: formData.todos,
  };

  if (state.editingPlaceId) {
    const idx = day.places.findIndex((p) => p.id === state.editingPlaceId);
    if (idx >= 0) day.places[idx] = place;
  } else {
    day.places.push(place);
  }

  day.places.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  state.editingPlaceId = null;
  saveData();
  render();
}

function deletePlace(placeId) {
  const day = getActiveDay();
  if (!day) return;
  if (!confirm("이 장소를 삭제할까요?")) return;
  day.places = day.places.filter((p) => p.id !== placeId);
  saveData();
  render();
}

// ——— Share / import ———

function sanitizeFilename(name) {
  return String(name || "여행")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .slice(0, 48) || "여행";
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildExportObject(scope) {
  const exportedAt = new Date().toISOString();
  if (scope === "full") {
    return {
      type: EXPORT_TYPE,
      version: EXPORT_VERSION,
      scope: "full",
      exportedAt,
      data: JSON.parse(JSON.stringify(state.data)),
    };
  }
  const trip = getActiveTrip();
  if (!trip) throw new Error("선택된 여행이 없습니다.");
  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    scope: "trip",
    exportedAt,
    trip: JSON.parse(JSON.stringify(trip)),
  };
}

function cloneTripWithNewIds(trip) {
  return {
    id: uid(),
    name: trip.name || "가져온 여행",
    days: (trip.days || []).map((d) => ({
      id: uid(),
      date: d.date,
      label: (d.label || "").trim(),
      places: (d.places || []).map((p) => ({
        id: uid(),
        time: p.time || "09:00",
        name: p.name || "",
        address: p.address || "",
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        todos: p.todos || "",
      })),
    })),
  };
}

function parseImportPayload(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("JSON 내용이 비어 있습니다.");
  const raw = JSON.parse(trimmed);
  if (!raw || typeof raw !== "object") throw new Error("올바른 JSON이 아닙니다.");

  if (raw.type === EXPORT_TYPE && raw.version === EXPORT_VERSION) {
    if (raw.scope === "full" && raw.data && Array.isArray(raw.data.trips)) {
      return { kind: "full", data: raw.data };
    }
    if (raw.scope === "trip" && raw.trip) {
      return { kind: "trip", trip: raw.trip };
    }
  }

  if (Array.isArray(raw.trips)) {
    return {
      kind: "full",
      data: {
        trips: raw.trips,
        activeTripId: raw.activeTripId ?? null,
        activeDayId: raw.activeDayId ?? null,
      },
    };
  }

  throw new Error("지원하지 않는 백업 형식입니다. 이 앱에서보낸 JSON인지 확인해 주세요.");
}

function getImportMode() {
  return document.querySelector('input[name="import-mode"]:checked')?.value || "merge";
}

function updateImportModeVisibility(parsedKind) {
  const wrap = $("#import-mode-wrap");
  if (!wrap) return;
  wrap.hidden = parsedKind === "trip";
}

function flashShareStatus(msg) {
  const el = $("#save-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("footer__status--saved");
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    el.textContent = "";
    el.classList.remove("footer__status--saved");
  }, 2500);
}

async function runExport() {
  const scope = document.querySelector('input[name="export-scope"]:checked')?.value || "trip";
  if (scope === "trip" && !getActiveTrip()) {
    alert("보낼 여행을 먼저 선택해 주세요.");
    return;
  }
  if (scope === "full" && (!state.data.trips || state.data.trips.length === 0)) {
    alert("저장된 여행이 없습니다.");
    return;
  }

  const obj = buildExportObject(scope);
  const json = JSON.stringify(obj, null, 2);
  const filename =
    scope === "full"
      ? `여행-전체백업-${new Date().toISOString().slice(0, 10)}.json`
      : `여행-${sanitizeFilename(getActiveTrip().name)}.json`;

  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const file = new File([blob], filename, { type: "application/json" });

  let usedShare = false;
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "여행 일정",
        text: filename,
      });
      usedShare = true;
    } catch (e) {
      if (e.name !== "AbortError") {
        console.warn(e);
      }
    }
  }

  if (!usedShare) {
    downloadBlob(blob, filename);
  }
  flashShareStatus(usedShare ? "공유했어요" : "파일로 저장했어요");
}

function applyImport() {
  const text = $("#import-text")?.value || "";
  let parsed;
  try {
    parsed = parseImportPayload(text);
  } catch (e) {
    alert(e.message || "가져오기에 실패했습니다.");
    return;
  }

  if (parsed.kind === "trip") {
    const nt = cloneTripWithNewIds(parsed.trip);
    state.data.trips.push(nt);
    state.activeTripId = nt.id;
    state.activeDayId = nt.days[0]?.id || null;
    state.data.activeTripId = state.activeTripId;
    state.data.activeDayId = state.activeDayId;
    saveData();
    $("#modal-share").close();
    $("#import-text").value = "";
    render();
    flashShareStatus("여행을 추가했어요");
    return;
  }

  const mode = getImportMode();
  if (mode === "replace") {
    if (!confirm("기기에 있는 모든 여행이 삭제되고, 백업 내용으로 바뀝니다. 계속할까요?")) return;
    state.data = normalizeData(JSON.parse(JSON.stringify(parsed.data)));
    state.activeTripId = state.data.activeTripId;
    state.activeDayId = state.data.activeDayId;
    if (state.activeTripId && !getActiveTrip()) {
      state.activeTripId = state.data.trips[0]?.id || null;
      state.data.activeTripId = state.activeTripId;
    }
    const trip = getActiveTrip();
    state.activeDayId = trip?.days[0]?.id || null;
    state.data.activeDayId = state.activeDayId;
  } else {
    const incoming = parsed.data.trips || [];
    if (incoming.length === 0) {
      alert("가져올 여행이 없습니다.");
      return;
    }
    for (const t of incoming) {
      state.data.trips.push(cloneTripWithNewIds(t));
    }
    const last = state.data.trips[state.data.trips.length - 1];
    state.activeTripId = last.id;
    state.activeDayId = last.days[0]?.id || null;
    state.data.activeTripId = state.activeTripId;
    state.data.activeDayId = state.activeDayId;
  }

  saveData();
  $("#modal-share").close();
  $("#import-text").value = "";
  render();
  flashShareStatus(mode === "replace" ? "백업으로 복원했어요" : "여행을 목록에 추가했어요");
}

function openShareModal() {
  const modal = $("#modal-share");
  const tripRadio = modal?.querySelector('input[name="export-scope"][value="trip"]');
  const fullRadio = modal?.querySelector('input[name="export-scope"][value="full"]');
  const btnExport = $("#btn-export");
  if (!modal) return;

  const hasTrips = state.data.trips.length > 0;
  if (tripRadio) {
    tripRadio.disabled = !hasTrips;
    tripRadio.checked = hasTrips;
  }
  if (fullRadio) {
    fullRadio.disabled = !hasTrips;
    fullRadio.checked = false;
  }
  if (btnExport) btnExport.disabled = !hasTrips;

  updateImportModeVisibility("full");
  modal.showModal();
}

function setupShareImport() {
  $("#btn-share")?.addEventListener("click", openShareModal);

  $("#btn-export")?.addEventListener("click", () => {
    runExport().catch((e) => alert(e.message || "보내기에 실패했습니다."));
  });

  $("#btn-import-file")?.addEventListener("click", () => {
    $("#import-file")?.click();
  });

  $("#import-file")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const ta = $("#import-text");
      if (ta) ta.value = text;
      try {
        const parsed = parseImportPayload(text);
        updateImportModeVisibility(parsed.kind);
      } catch {
        updateImportModeVisibility("full");
      }
    } catch {
      alert("파일을 읽지 못했습니다.");
    }
    e.target.value = "";
  });

  $("#import-text")?.addEventListener("input", () => {
    const ta = $("#import-text");
    if (!ta?.value.trim()) {
      updateImportModeVisibility("full");
      return;
    }
    try {
      const parsed = parseImportPayload(ta.value);
      updateImportModeVisibility(parsed.kind);
    } catch {
      updateImportModeVisibility("full");
    }
  });

  $("#btn-import-apply")?.addEventListener("click", applyImport);
}

// ——— Modals ———

function setupModals() {
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const dialog = e.target.closest("dialog");
      dialog?.close();
    });
  });

  $("#form-trip").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#trip-name").value;
    if (!name.trim()) return;
    createTrip(name);
    $("#modal-trip").close();
  });

  $("#modal-day").addEventListener("close", () => {
    state.editingDayId = null;
  });

  $("#form-day").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = $("#day-date").value;
    const label = $("#day-label").value;
    if (!date) return;
    if (saveDay(date, label)) {
      $("#modal-day").close();
    }
  });

  $("#form-place").addEventListener("submit", (e) => {
    e.preventDefault();
    const latRaw = $("#place-lat").value.trim();
    const lngRaw = $("#place-lng").value.trim();
    savePlace({
      time: $("#place-time").value,
      name: $("#place-name").value.trim(),
      address: $("#place-address").value.trim(),
      lat: latRaw === "" ? null : parseFloat(latRaw),
      lng: lngRaw === "" ? null : parseFloat(lngRaw),
      todos: $("#place-todos").value.trim(),
    });
    $("#modal-place").close();
  });
}

// ——— Service Worker ———

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .catch((err) => console.warn("SW registration failed:", err));
  });
}

// ——— Init ———

function init() {
  state.data = loadData();
  state.activeTripId = state.data.activeTripId;
  state.activeDayId = state.data.activeDayId;

  if (state.activeTripId && !getActiveTrip()) {
    state.activeTripId = state.data.trips[0]?.id || null;
  }

  $("#btn-new-trip").addEventListener("click", openTripModal);
  $("#btn-welcome-new").addEventListener("click", openTripModal);
  $("#btn-delete-trip").addEventListener("click", deleteActiveTrip);
  $("#btn-edit-day").addEventListener("click", () => {
    const day = getActiveDay();
    if (!day) return;
    openDayModal(day.id);
  });

  $("#btn-add-place").addEventListener("click", () => {
    if (!getActiveDay()) {
      alert("먼저 일자를 추가해 주세요.");
      openDayModal();
      return;
    }
    openPlaceModal();
  });

  $("#trip-select").addEventListener("change", (e) => {
    selectTrip(e.target.value);
  });

  setupModals();
  setupShareImport();
  registerServiceWorker();
  window.addEventListener("resize", updateTimelineNow);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateTimelineNow();
  });
  render();
}

init();
