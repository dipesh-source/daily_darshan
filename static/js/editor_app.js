/* ================================================================
   Daily Darshan Editor  –  Multi-Artboard Canvas Engine
   Requires: Fabric.js 5.x

   Architecture:
     - One infinite Fabric.Canvas fills the full canvas-area.
     - Each FrameConfig becomes an "Artboard" — a logical region on
       that canvas with its own offset, its own Fabric objects, and
       its own slot definitions.
     - Artboards are laid out left-to-right with a 120px gap.
     - All artboard objects are offset by the artboard's (ox, oy).
     - The left panel shows slots/layers for the *active* artboard.
     - Clicking any object on the canvas activates its artboard.
================================================================ */
"use strict";

// ─────────────────────────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────────────────────────
const ARTBOARD_GAP   = 140;   // px between artboards (at display scale)
const DISPLAY_HEIGHT = 700;   // fixed display height for all artboards (px)
const LABEL_HEIGHT   = 36;    // px above artboard for the name label
const SLOT_IMAGE_BLEED_RATIO = 0.025;
const SLOT_IMAGE_BLEED_MIN   = 10;
const SLOT_IMAGE_BLEED_MAX   = 20;

// ─────────────────────────────────────────────────────────────────
// AUTO-TEXT SYSTEM
// Three text fields are auto-placed on every artboard:
//   darshan_title  · date  · temple_name
// Editing the text on any artboard propagates to all others.
// Positions are in NATIVE canvas pixels (scaled at render time).
// ─────────────────────────────────────────────────────────────────
const DARSHAN_LABELS = {
  mangala:  "Mangala Darshan",
  shanagar: "Shanagar Darshan",
  shayan:   "Shayan Darshan",
};
// Temple name is already baked into the frame PNG — not added as auto-text.

// Layout definitions per frame_type (native px).
// x/y are where the text anchor sits in the native canvas coordinate space.
// originX: "center" = x is the mid-point; "right" = x is right edge.
const _PORTRAIT_TEXT = [
  { key:"darshan_title", x:576,  y:75,   originX:"center", fontSize:54, bold:true,  color:"#FFFFFF" },
  { key:"date",          x:576,  y:1956, originX:"center", fontSize:42, bold:false, color:"#FFFFFF" },
];
const _WIDE_TEXT = [
  { key:"darshan_title", x:2950, y:78,   originX:"right",  fontSize:54, bold:true,  color:"#FFFFFF" },
  { key:"date",          x:1597, y:1956, originX:"center", fontSize:42, bold:false, color:"#FFFFFF" },
];
const _3IN1_TEXT = [
  { key:"darshan_title", x:1669, y:95,   originX:"center", fontSize:55, bold:true,  color:"#FFFFFF" },
  { key:"date",          x:1094, y:1958, originX:"center", fontSize:42, bold:false, color:"#FFFFFF" },
];
const AUTO_TEXT_LAYOUT = {
  full:   _PORTRAIT_TEXT,
  left:   _PORTRAIT_TEXT,
  center: _PORTRAIT_TEXT,
  right:  _PORTRAIT_TEXT,
  wide:   _WIDE_TEXT,
  "3in1_l": _3IN1_TEXT,
  "3in1_r": _3IN1_TEXT,
};

function sessionDateDisplay() {
  const d = window.SESSION?.darshan_date || "";  // "2026-04-11"
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;   // DD/MM/YYYY
}

function autoTextValue(key) {
  const type = window.SESSION?.darshan_type || "";
  switch (key) {
    case "darshan_title": return DARSHAN_LABELS[type] || type;
    case "date":          return sessionDateDisplay();
    default:              return "";
  }
}

function addAutoTextToArtboard(state) {
  const layout = AUTO_TEXT_LAYOUT[state.config.frame_type];
  if (!layout) return;

  // Collect textKeys already present for this artboard (from restored JSON)
  const existingKeys = new Set(
    canvas.getObjects()
      .filter(o => o.data?.frameId === state.frameId && o.data?.textKey)
      .map(o => o.data.textKey)
  );

  const s = state.scale;
  layout.forEach(def => {
    if (existingKeys.has(def.key)) return;  // already present from saved session

    const txt = new fabric.IText(autoTextValue(def.key), {
      left:       state.ox + def.x * s,
      top:        state.oy + def.y * s,
      originX:    def.originX,
      originY:    "center",
      fontSize:   Math.round(def.fontSize * s),
      fontFamily: "Arial",
      fontWeight: def.bold ? "bold" : "normal",
      fill:       def.color,
      shadow:     new fabric.Shadow({ color:"rgba(0,0,0,0.75)", blur:6, offsetX:1, offsetY:2 }),
      selectable: true,
      hasControls: true,
      lockScalingX: false, lockScalingY: false,
      data: { type:"text-overlay", frameId: state.frameId, textKey: def.key },
    });
    canvas.add(txt);
    state.textObjs.push(txt);
  });
}

// Propagate new text content to same textKey on all other artboards.
function syncAutoText(sourceFrameId, textKey, newContent) {
  canvas.getObjects().forEach(o => {
    if (o.data?.textKey === textKey && o.data?.frameId !== sourceFrameId) {
      o.set("text", newContent);
    }
  });
  canvas.requestRenderAll();
}

// One-per-artboard state map  { frameId → ArtboardState }
const ArtboardMap = {};

let canvas        = null;   // the single fabric.Canvas instance
let activeFrameId = null;   // currently focused artboard
let globalScale   = 1;      // uniform display scale (DISPLAY_HEIGHT / tallest_native_height)
let canvasTotalW  = 0;      // total width of the infinite canvas element
let canvasH       = 0;      // canvas element height

let undoStack     = [];
let redoStack     = [];
let autosaveTimer = null;
let isPanning     = false;
let lastPanPt     = { x: 0, y: 0 };
let currentTool   = "select";

// ─────────────────────────────────────────────────────────────────
// ARTBOARD STATE
// ─────────────────────────────────────────────────────────────────
function makeArtboardState(ab, ox, oy, dispW, dispH) {
  return {
    frameId:    ab.id,
    config:     ab,          // raw config from server
    ox, oy,                  // top-left offset on the infinite canvas (px)
    dispW, dispH,            // display dimensions (px)
    scale:      dispW / ab.canvas_width,  // native→display scale for this artboard
    slotImages: {},          // slotIndex → fabric.Image
    slotFilters: {},         // slotIndex → filter values
    overlayObj: null,        // fabric.Image for the frame PNG
    placeholders: [],        // all placeholder fabric objects for this artboard
    textObjs:   [],          // text overlay fabric objects
    selectedSlotIdx: null,
  };
}

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  computeLayout();
  initCanvas();
  initArtboards();
  bindToolButtons();
  bindArtboardTabs();
  bindColorControls();
  bindBlendControls();
  bindTransformControls();
  bindTextControls();
  bindTopBar();
  bindLayersPanel();
  bindKeyboard();
  bindAutoTextSync();
  activateArtboard(window.ARTBOARDS[0].id);
  renderArtboardListPanel();
  // Fit all artboards into view on startup
  requestAnimationFrame(fitAll);
});

// ─────────────────────────────────────────────────────────────────
// LAYOUT  (compute display size + offset for every artboard)
// ─────────────────────────────────────────────────────────────────
function computeLayout() {
  const artboards = window.ARTBOARDS;

  // Uniform scale: fit DISPLAY_HEIGHT to the tallest native height
  const maxH = Math.max(...artboards.map(a => a.canvas_height));
  globalScale = DISPLAY_HEIGHT / maxH;

  let curX = 60;  // left margin
  artboards.forEach(ab => {
    const dispW = Math.round(ab.canvas_width  * globalScale);
    const dispH = Math.round(ab.canvas_height * globalScale);
    const oy    = LABEL_HEIGHT + 40;  // top margin (space for label + top padding)
    ArtboardMap[ab.id] = makeArtboardState(ab, curX, oy, dispW, dispH);
    curX += dispW + ARTBOARD_GAP;
  });

  canvasTotalW = curX + 60;
  canvasH      = DISPLAY_HEIGHT + LABEL_HEIGHT + 100;
}

// ─────────────────────────────────────────────────────────────────
// CANVAS SETUP
// ─────────────────────────────────────────────────────────────────
function initCanvas() {
  const area = document.getElementById("canvasArea");
  // Canvas element = viewport size only. Fabric's viewport transform handles pan/zoom.
  // DO NOT size to world layout dimensions — that causes clipping when zoomed in.
  const areaW = area.clientWidth  || window.innerWidth  - 480;
  const areaH = area.clientHeight || window.innerHeight - 48;

  canvas = new fabric.Canvas("mainCanvas", {
    width:                  areaW,
    height:                 areaH,
    backgroundColor:        "#141414",
    preserveObjectStacking: true,
    selection:              true,
    stopContextMenu:        true,
  });

  // Keep canvas pixel-perfect with the viewport at all times
  const _onResize = () => {
    const w = area.clientWidth  || window.innerWidth  - 480;
    const h = area.clientHeight || window.innerHeight - 48;
    canvas.setDimensions({ width: w, height: h });
    canvas.requestRenderAll();
    updateLabelPositions();
    updateZoomDisplay();
  };
  window.addEventListener("resize", _onResize);
  // Also watch for sidebar collapse / panel resize via ResizeObserver
  if (window.ResizeObserver) {
    new ResizeObserver(_onResize).observe(area);
  }

  canvas.on("mouse:wheel",  onWheel);
  canvas.on("mouse:down",   onMouseDown);
  canvas.on("mouse:move",   onMouseMove);
  canvas.on("mouse:up",     onMouseUp);
  canvas.on("selection:created", onSelectionChange);
  canvas.on("selection:updated", onSelectionChange);
  canvas.on("selection:cleared", onSelectionCleared);
  canvas.on("object:modified",   e => {
    const slotBinding = getSlotForImageObject(e.target);
    if (slotBinding) {
      e.target.data = { ...(e.target.data || {}), manualCrop: true };
      ensureSlotImageCoverage(slotBinding.state, slotBinding.slot, e.target);
    }
    pushUndo();
    scheduleAutosave();
  });
  canvas.on("object:added",      () => refreshLayersPanel());
  canvas.on("object:removed",    () => refreshLayersPanel());

  // Artboard background rects (drawn first so they sit below everything)
  Object.values(ArtboardMap).forEach(ab => {
    const bg = new fabric.Rect({
      left: ab.ox, top: ab.oy, width: ab.dispW, height: ab.dispH,
      fill: "#1A1A1A", selectable: false, evented: false, hoverCursor: "default",
      data: { type: "artboard-bg", frameId: ab.frameId },
    });
    canvas.add(bg);
    ab._bgRect = bg;
  });

  renderFloatingLabels();
  canvas.renderAll();
}

// ─────────────────────────────────────────────────────────────────
// FLOATING ARTBOARD LABELS  (HTML divs, positioned over canvas)
// ─────────────────────────────────────────────────────────────────
function renderFloatingLabels() {
  const container = document.getElementById("artboardLabels");
  container.innerHTML = "";
  Object.values(ArtboardMap).forEach(ab => {
    const lbl = document.createElement("div");
    lbl.className = "artboard-label";
    lbl.id        = "abl-" + ab.frameId;
    lbl.textContent = ab.config.display_name;
    lbl.dataset.frameId = ab.frameId;
    container.appendChild(lbl);
    lbl.addEventListener("click", () => activateArtboard(ab.frameId));
  });
  updateLabelPositions();
}

function updateLabelPositions() {
  const vpt = canvas.viewportTransform;
  Object.values(ArtboardMap).forEach(ab => {
    const lbl = document.getElementById("abl-" + ab.frameId);
    if (!lbl) return;
    // Transform artboard top-left through viewport transform to screen coords
    const screenX = vpt[0] * ab.ox + vpt[4];
    const screenY = vpt[3] * ab.oy + vpt[5] - LABEL_HEIGHT + 4;
    const w       = ab.dispW * vpt[0];
    lbl.style.left      = screenX + "px";
    lbl.style.top       = screenY + "px";
    lbl.style.width     = w + "px";
    lbl.style.display   = (w < 30) ? "none" : "flex";
    lbl.classList.toggle("active", ab.frameId === activeFrameId);
  });
}

// ─────────────────────────────────────────────────────────────────
// INIT ARTBOARDS  (placeholders + existing JSON)
// ─────────────────────────────────────────────────────────────────
function initArtboards() {
  window.ARTBOARDS.forEach(ab => {
    const state = ArtboardMap[ab.id];
    ab.slots.forEach(slot => {
      state.slotFilters[slot.index] = defaultFilters();
    });

    if (ab.canvas_json && ab.canvas_json.objects && ab.canvas_json.objects.length > 0) {
      loadArtboardFromJSON(state, ab.canvas_json);
    } else {
      createSlotPlaceholders(state);
      if (ab.overlay_url) {
        loadFrameOverlay(state, ab.overlay_url);
        // addAutoTextToArtboard is called inside loadFrameOverlay callback
        // so text is added AFTER overlay, keeping correct z-order
      } else {
        addAutoTextToArtboard(state);
      }
    }
  });
  pushUndo();
}

// ─────────────────────────────────────────────────────────────────
// SLOT PLACEHOLDERS
// ─────────────────────────────────────────────────────────────────
function createSlotPlaceholders(state) {
  const s  = state.scale;

  state.config.slots.forEach(slot => {
    // Offset slot coords by artboard origin
    const sx = state.ox + slot.x * s;
    const sy = state.oy + slot.y * s;
    const sw = slot.w * s;
    const sh = slot.h * s;
    const sr = (slot.radius || 0) * s;

    const bg = new fabric.Rect({
      left: sx, top: sy, width: sw, height: sh, rx: sr, ry: sr,
      fill: "#2A1E10",
      stroke: null, strokeWidth: 0,
      selectable: false, evented: true, hoverCursor: "pointer",
      data: { type: "slot-placeholder", frameId: state.frameId, slotIndex: slot.index },
    });

    const plus = new fabric.Text("+", {
      left: sx + sw / 2, top: sy + sh / 2 - clamp(16 * s, 10, 20),
      originX: "center", originY: "center",
      fontSize: clamp(44 * s, 20, 52), fill: "#D4A017",
      selectable: false, evented: false,
      data: { type: "slot-label", frameId: state.frameId },
    });

    const hint = new fabric.Text("Tap to upload photo", {
      left: sx + sw / 2, top: sy + sh / 2 + clamp(14 * s, 8, 18),
      originX: "center", originY: "center",
      fontSize: clamp(12 * s, 7, 14), fill: "#8A7A5A",
      selectable: false, evented: false,
      data: { type: "slot-label", frameId: state.frameId },
    });

    const num = new fabric.Text(`Slot ${slot.index + 1}`, {
      left: sx + sw / 2, top: sy + sh / 2 - clamp(34 * s, 18, 40),
      originX: "center", originY: "center",
      fontSize: clamp(10 * s, 7, 13), fill: "#D4A017", fontWeight: "bold",
      selectable: false, evented: false,
      data: { type: "slot-label", frameId: state.frameId },
    });

    canvas.add(bg, num, plus, hint);
    state.placeholders.push(bg, num, plus, hint);
  });

  // Click placeholder → trigger upload
  canvas.on("mouse:down", e => {
    if (!e.target) return;
    const d = e.target.data;
    if (d && d.type === "slot-placeholder") {
      // Activate artboard first (synchronous DOM work), then open file picker
      // immediately after so Chrome considers it a trusted event.
      activateArtboard(d.frameId);
      const st = ArtboardMap[d.frameId];
      if (st) ensureFileInputs(d.frameId, st.config.slots);
      const inp = document.getElementById(`fi-${d.frameId}-${d.slotIndex}`);
      inp?.click();
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// LOAD ARTBOARD FROM SAVED JSON
// ─────────────────────────────────────────────────────────────────
function loadArtboardFromJSON(state, savedJSON) {
  // The saved JSON was captured on the same scale, same offsets.
  // We just need to add each object to the shared canvas.
  const objs = savedJSON.objects || [];
  fabric.util.enlivenObjects(objs, loaded => {
    loaded.forEach(obj => {
      canvas.add(obj);
      const d = obj.data || {};
      if (d.type === "slot-image"  && d.frameId === state.frameId) {
        state.slotImages[d.slotIndex] = obj;
        const slot = state.config.slots.find(s => s.index === d.slotIndex);
        obj.clipPath = makeSlotClip(state, slot);
        ensureSlotImageCoverage(state, slot, obj);
      }
      if (d.type === "frame-overlay" && d.frameId === state.frameId) {
        state.overlayObj = obj;
        obj.set({ selectable: false, evented: false });
      }
    });
    addAutoTextToArtboard(state);  // add any missing auto-text fields
    bringOverlayToFront(state);
    canvas.renderAll();
  });

  // Re-create placeholders for any slot that has no image
  state.config.slots.forEach(slot => {
    if (!state.slotImages[slot.index]) {
      // Only placeholder for this slot
      const s  = state.scale;
      const sx = state.ox + slot.x * s;
      const sy = state.oy + slot.y * s;
      const sw = slot.w * s;
      const sh = slot.h * s;
      const sr = (slot.radius || 0) * s;
      const bg = new fabric.Rect({
        left: sx, top: sy, width: sw, height: sh, rx: sr, ry: sr,
        fill: "#2A1E10", stroke: null, strokeWidth: 0,
        selectable: false, evented: true, hoverCursor: "pointer",
        data: { type: "slot-placeholder", frameId: state.frameId, slotIndex: slot.index },
      });
      canvas.add(bg);
      state.placeholders.push(bg);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// FRAME OVERLAY
// ─────────────────────────────────────────────────────────────────
function loadFrameOverlay(state, url) {
  fabric.Image.fromURL(url, img => {
    img.set({
      left:      state.ox,
      top:       state.oy,
      scaleX:    state.dispW / img.width,
      scaleY:    state.dispH / img.height,
      selectable: false, evented: false, hoverCursor: "default",
      data: { type: "frame-overlay", frameId: state.frameId },
    });
    if (state.overlayObj) canvas.remove(state.overlayObj);
    canvas.add(img);
    state.overlayObj = img;
    addAutoTextToArtboard(state);  // place text AFTER overlay so it renders on top
    bringOverlayToFront(state);
    canvas.renderAll();
  }, { crossOrigin: "anonymous" });
}

function bringOverlayToFront(state) {
  if (state.overlayObj) canvas.bringToFront(state.overlayObj);
  // Text always stays above overlay
  canvas.getObjects().forEach(o => {
    if (o.data && o.data.type === "text-overlay" && o.data.frameId === state.frameId) {
      canvas.bringToFront(o);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// SLOT SYNC  — upload to one tall-portrait slot → mirrors to all
//             equivalent tall slots in the same darshan session.
//
// Sync groups (frame_type → slot_index):
//   full/0  ↔  3in1_l/0  ↔  3in1_r/2
//
// This covers Mangala, Shanagar (excl. left/center/right), Shayan.
// Wide is intentionally excluded (landscape, different composition).
// Small stacked slots in 3-in-1 (slot 1 & 2 of L, slot 0 & 1 of R)
// are also excluded — those get individual photos.
// ─────────────────────────────────────────────────────────────────
const SYNC_MEMBERS = [
  { frame_type: "full",    slotIndex: 0 },
  { frame_type: "3in1_l",  slotIndex: 0 },
  { frame_type: "3in1_r",  slotIndex: 2 },
];

function getSyncTargets(sourceFrameId, sourceSlotIndex) {
  const src = ArtboardMap[sourceFrameId];
  if (!src) return [];

  // Is this slot a sync member?
  const isMember = SYNC_MEMBERS.some(
    m => m.frame_type === src.config.frame_type && m.slotIndex === sourceSlotIndex
  );
  if (!isMember) return [];

  // Find all other artboards in the same darshan that are also sync members
  return Object.values(ArtboardMap).filter(state => {
    if (state.frameId === sourceFrameId) return false;
    if (state.config.darshan_type !== src.config.darshan_type) return false;
    return SYNC_MEMBERS.some(
      m => m.frame_type === state.config.frame_type && state.config.slots.some(s => s.index === m.slotIndex)
    );
  }).map(state => {
    const member = SYNC_MEMBERS.find(m => m.frame_type === state.config.frame_type);
    return { frameId: state.frameId, slotIndex: member.slotIndex };
  });
}

// ─────────────────────────────────────────────────────────────────
// LOAD PHOTO INTO SLOT
// ─────────────────────────────────────────────────────────────────
function loadPhotoIntoSlot(frameId, slotIndex, imageUrl, photoId, fileName, _isSyncCall = false) {
  const state = ArtboardMap[frameId];
  if (!state) return;

  const slot  = state.config.slots.find(s => s.index === slotIndex);
  if (!slot)  return;

  const s  = state.scale;
  const sw = slot.w * s;
  const sh = slot.h * s;

  fabric.Image.fromURL(imageUrl, img => {
    const { w: natW, h: natH } = imgNaturalDims(img);
    const fitScale = getRequiredSlotImageScale(sw, sh, natW, natH);

    img.set({
      left:     Math.round(state.ox + (slot.x + slot.w / 2) * state.scale),
      top:      Math.round(state.oy + (slot.y + slot.h / 2) * state.scale),
      originX:  "center",
      originY:  "center",
      scaleX:   fitScale,
      scaleY:   fitScale,
      selectable:    true,
      hasControls:   true,
      hasBorders:    true,
      lockUniScaling: false,
      data: { type: "slot-image", frameId, slotIndex, photoId, fileName: fileName || "", manualCrop: false },
    });

    // Clip to the slot shape
    img.clipPath = makeSlotClip(state, slot);
    ensureSlotImageCoverage(state, slot, img);

    // Remove previous image for this slot
    if (state.slotImages[slotIndex]) canvas.remove(state.slotImages[slotIndex]);
    removePlaceholdersForSlot(state, slotIndex);

    canvas.add(img);
    bringOverlayToFront(state);
    state.slotImages[slotIndex] = img;

    applyFiltersToSlot(frameId, slotIndex);
    canvas.setActiveObject(img);
    canvas.renderAll();
    pushUndo();
    scheduleAutosave();
    refreshLayersPanel();
    updateSlotPanelThumb(frameId, slotIndex, imageUrl);

    if (!_isSyncCall) {
      // Mirror to all linked tall-portrait slots in this darshan
      const targets = getSyncTargets(frameId, slotIndex);
      targets.forEach(t => {
        loadPhotoIntoSlot(t.frameId, t.slotIndex, imageUrl, photoId, fileName, true);
      });
      const syncCount = targets.length;
      notify(
        syncCount > 0
          ? `Photo synced to ${syncCount + 1} frames (${state.config.short_name} + ${syncCount} others)`
          : `Photo loaded into ${state.config.short_name} Slot ${slotIndex + 1}`,
        "success"
      );
    }
  }, { crossOrigin: "anonymous" });
}

function makeSlotClip(state, slot) {
  const s = state.scale;
  return new fabric.Rect({
    left:               Math.round(state.ox + slot.x * s),
    top:                Math.round(state.oy + slot.y * s),
    width:              Math.round(slot.w * s),
    height:             Math.round(slot.h * s),
    rx:                 Math.round((slot.radius || 0) * s),
    ry:                 Math.round((slot.radius || 0) * s),
    absolutePositioned: true,
  });
}

function getSlotBleedPx(slotW, slotH) {
  return clamp(
    Math.round(Math.min(slotW, slotH) * SLOT_IMAGE_BLEED_RATIO),
    SLOT_IMAGE_BLEED_MIN,
    SLOT_IMAGE_BLEED_MAX
  );
}

function getRequiredSlotImageScale(slotW, slotH, imageW, imageH) {
  if (!slotW || !slotH || !imageW || !imageH) return 1;
  // bleed: extra pixels added on each side so no dark-background gap ever shows
  const bleed = getSlotBleedPx(slotW, slotH);
  return Math.max((slotW + bleed * 2) / imageW, (slotH + bleed * 2) / imageH);
}

function imgNaturalDims(fabricImg) {
  // Prefer naturalWidth/naturalHeight from the underlying <img> element —
  // these are always the true pixel dimensions regardless of devicePixelRatio.
  const el = fabricImg._element;
  const w = (el && el.naturalWidth)  || fabricImg.width  || 1;
  const h = (el && el.naturalHeight) || fabricImg.height || 1;
  return { w, h };
}

function ensureSlotImageCoverage(state, slot, img) {
  // Enforce minimum scale so the image always covers the slot — no position clamping,
  // so the user can freely pan the image to show any desired portion.
  if (!state || !slot || !img) return;
  const { w: natW, h: natH } = imgNaturalDims(img);
  if (!natW || !natH) return;
  const slotW = slot.w * state.scale;
  const slotH = slot.h * state.scale;
  const minScale = getRequiredSlotImageScale(slotW, slotH, natW, natH);
  img.set({
    scaleX: Math.max(Math.abs(img.scaleX || 1), minScale),
    scaleY: Math.max(Math.abs(img.scaleY || 1), minScale),
  });
  img.setCoords();
}
function getSlotForImageObject(obj) {
  const d = obj?.data || {};
  if (d.type !== "slot-image") return null;
  const state = ArtboardMap[d.frameId];
  if (!state) return null;
  const slot = state.config.slots.find(s => s.index === d.slotIndex);
  if (!slot) return null;
  return { state, slot };
}

function removePlaceholdersForSlot(state, slotIndex) {
  // Remove from tracked array
  state.placeholders = state.placeholders.filter(p => {
    const d = p.data || {};
    if (d.frameId === state.frameId && (d.slotIndex === slotIndex || d.type === "slot-label")) {
      canvas.remove(p);
      return false;
    }
    return true;
  });
  // Hard sweep — remove ANY canvas object for this slot that slipped tracking
  canvas.getObjects().forEach(o => {
    const d = o.data || {};
    if (d.frameId === state.frameId && d.slotIndex === slotIndex &&
        (d.type === "slot-placeholder" || d.type === "slot-label")) {
      canvas.remove(o);
    }
  });
}

function restorePlaceholderForSlot(state, slotIndex) {
  const slot = state.config.slots.find(s => s.index === slotIndex);
  if (!slot) return;
  const s  = state.scale;
  const sx = state.ox + slot.x * s;
  const sy = state.oy + slot.y * s;
  const sw = slot.w * s;
  const sh = slot.h * s;
  const sr = (slot.radius || 0) * s;

  const bg = new fabric.Rect({
    left: sx, top: sy, width: sw, height: sh, rx: sr, ry: sr,
    fill: "#2A1E10", stroke: null, strokeWidth: 0,
    selectable: false, evented: true, hoverCursor: "pointer",
    data: { type: "slot-placeholder", frameId: state.frameId, slotIndex },
  });
  const plus = new fabric.Text("+", {
    left: sx + sw / 2, top: sy + sh / 2,
    originX: "center", originY: "center",
    fontSize: clamp(44 * s, 20, 52), fill: "#D4A017",
    selectable: false, evented: false,
    data: { type: "slot-label", frameId: state.frameId },
  });
  canvas.add(bg, plus);
  state.placeholders.push(bg, plus);
  canvas.renderAll();
}

// ─────────────────────────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────────────────────────
function defaultFilters() {
  return {
    brightness: 0, contrast: 0, saturation: 0, hue: 0,
    blur: 0, noise: 0,
    gamma_r: 1, gamma_g: 1, gamma_b: 1,
    grayscale: false, sepia: false, invert: false,
    vintage: false, sharpen: false, polaroid: false, kodachrome: false,
    opacity: 1, blendMode: "source-over",
  };
}

function applyFiltersToSlot(frameId, slotIndex) {
  const state = ArtboardMap[frameId];
  const img   = state?.slotImages[slotIndex];
  const f     = state?.slotFilters[slotIndex];
  if (!img || !f) return;

  const filters = [];
  if (f.brightness !== 0) filters.push(new fabric.Image.filters.Brightness({ brightness: f.brightness }));
  if (f.contrast   !== 0) filters.push(new fabric.Image.filters.Contrast({ contrast: f.contrast }));
  if (f.saturation !== 0) filters.push(new fabric.Image.filters.Saturation({ saturation: f.saturation }));
  if (f.hue        !== 0) filters.push(new fabric.Image.filters.HueRotation({ rotation: f.hue * (Math.PI / 180) }));
  if (f.blur        > 0)  filters.push(new fabric.Image.filters.Blur({ blur: f.blur / 100 }));
  if (f.noise       > 0)  filters.push(new fabric.Image.filters.Noise({ noise: f.noise }));
  if (f.gamma_r !== 1 || f.gamma_g !== 1 || f.gamma_b !== 1)
    filters.push(new fabric.Image.filters.Gamma({ gamma: [f.gamma_r, f.gamma_g, f.gamma_b] }));
  if (f.grayscale)  filters.push(new fabric.Image.filters.Grayscale());
  if (f.sepia)      filters.push(new fabric.Image.filters.Sepia());
  if (f.invert)     filters.push(new fabric.Image.filters.Invert());
  if (f.vintage)    filters.push(new fabric.Image.filters.Vintage());
  if (f.polaroid)   filters.push(new fabric.Image.filters.Polaroid());
  if (f.kodachrome) filters.push(new fabric.Image.filters.Kodachrome());
  if (f.sharpen)    filters.push(new fabric.Image.filters.Convolute({ matrix: [0,-1,0,-1,5,-1,0,-1,0] }));

  img.filters = filters;
  img.set({ opacity: f.opacity, globalCompositeOperation: f.blendMode || "source-over" });
  img.applyFilters();
  canvas.renderAll();
}

// ─────────────────────────────────────────────────────────────────
// ACTIVATE ARTBOARD
// ─────────────────────────────────────────────────────────────────
function activateArtboard(frameId) {
  activeFrameId = frameId;

  // Highlight background
  Object.values(ArtboardMap).forEach(ab => {
    ab._bgRect?.set({ shadowColor: "transparent", shadowBlur: 0 });
  });
  const active = ArtboardMap[frameId];
  active?._bgRect?.set({ shadowColor: "#D4A017", shadowBlur: 16, shadowOffsetX: 0, shadowOffsetY: 0 });
  canvas.renderAll();

  // Sync tab buttons
  document.querySelectorAll(".artboard-tab").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.frameId) === frameId);
  });

  updateLabelPositions();
  renderSlotsPanel(frameId);
  renderActiveFrameInfo(frameId);
  refreshLayersPanel();
}

// ─────────────────────────────────────────────────────────────────
// SLOTS PANEL  (left panel, updates for active artboard)
// ─────────────────────────────────────────────────────────────────
function renderSlotsPanel(frameId) {
  const panel = document.getElementById("slotsPanel");
  const state = ArtboardMap[frameId];
  if (!state) { panel.innerHTML = "<p class='filter-hint'>No artboard</p>"; return; }

  panel.innerHTML = "";

  state.config.slots.forEach(slot => {
    const row = document.createElement("div");
    row.className = "slot-row";
    row.dataset.slot = slot.index;

    const hasImg = !!state.slotImages[slot.index];
    const thumb  = state.slotImages[slot.index]?._element?.src || "";

    row.innerHTML = `
      <div class="slot-thumb ${hasImg ? "has-image" : ""}" id="slotThumb-${frameId}-${slot.index}">
        ${hasImg ? `<img src="${thumb}" alt="">` : `<span class="slot-num">${slot.index + 1}</span>`}
      </div>
      <div class="slot-actions">
        <button class="slot-upload-btn" data-frame="${frameId}" data-slot="${slot.index}">Upload</button>
        ${hasImg ? `<button class="slot-clear-btn" data-frame="${frameId}" data-slot="${slot.index}">✕</button>` : ""}
      </div>`;
    panel.appendChild(row);
  });

  // Bind buttons — activate artboard BEFORE calling triggerSlotUpload so
  // the file-input click happens while the button element is still in the DOM.
  panel.querySelectorAll(".slot-upload-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const fid   = parseInt(btn.dataset.frame);
      const sidx  = parseInt(btn.dataset.slot);
      // Ensure inputs exist now, while the button is still attached to DOM
      const st = ArtboardMap[fid];
      if (st) ensureFileInputs(fid, st.config.slots);
      const input = document.getElementById(`fi-${fid}-${sidx}`);
      // Open file picker immediately (still in trusted event chain)
      input?.click();
      // Update active artboard highlight after the dialog is requested
      if (activeFrameId !== fid) activateArtboard(fid);
    });
  });
  panel.querySelectorAll(".slot-clear-btn").forEach(btn => {
    btn.addEventListener("click", () => clearSlot(parseInt(btn.dataset.frame), parseInt(btn.dataset.slot)));
  });

  // Ensure hidden file inputs exist
  ensureFileInputs(frameId, state.config.slots);
}

function updateSlotPanelThumb(frameId, slotIndex, imageUrl) {
  const thumb = document.getElementById(`slotThumb-${frameId}-${slotIndex}`);
  if (!thumb) return;
  thumb.innerHTML = `<img src="${imageUrl}" alt="">`;
  thumb.classList.add("has-image");
  // Re-render the panel to add the clear button
  renderSlotsPanel(frameId);
}

function ensureFileInputs(frameId, slots) {
  const container = document.getElementById("hiddenFileInputs");
  slots.forEach(slot => {
    const inputId = `fi-${frameId}-${slot.index}`;
    if (document.getElementById(inputId)) return;
    const input = document.createElement("input");
    input.type     = "file";
    input.id       = inputId;
    input.accept   = "image/*";
    input.style.display = "none";
    input.dataset.frame = frameId;
    input.dataset.slot  = slot.index;
    input.addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      await uploadPhoto(parseInt(input.dataset.frame), parseInt(input.dataset.slot), file);
      input.value = "";
    });
    container.appendChild(input);
  });
}

function triggerSlotUpload(frameId, slotIndex) {
  // Do NOT call activateArtboard here — that rebuilds the DOM (panel.innerHTML="")
  // which detaches the Upload button that triggered this call, causing Chrome to
  // block the subsequent input.click() as an untrusted programmatic click.
  const state = ArtboardMap[frameId];
  if (state) ensureFileInputs(frameId, state.config.slots);
  const input = document.getElementById(`fi-${frameId}-${slotIndex}`);
  input?.click();
}

async function uploadPhoto(frameId, slotIndex, file) {
  notify("Uploading…", "info");
  const fd = new FormData();
  fd.append("photo",           file);
  fd.append("frame_config_id", frameId);
  fd.append("slot_index",      slotIndex);

  const r = await apiFormPost("/api/upload/", fd);
  if (r.success) {
    loadPhotoIntoSlot(frameId, slotIndex, r.url, r.photo_id, file.name);
  } else {
    notify("Upload failed: " + r.error, "error");
  }
}

function clearSlot(frameId, slotIndex) {
  const state = ArtboardMap[frameId];
  if (!state) return;
  const img = state.slotImages[slotIndex];
  if (img) { canvas.remove(img); delete state.slotImages[slotIndex]; }
  state.slotFilters[slotIndex] = defaultFilters();
  restorePlaceholderForSlot(state, slotIndex);
  renderSlotsPanel(frameId);
  pushUndo(); scheduleAutosave();
}

// ─────────────────────────────────────────────────────────────────
// DRAG & DROP onto canvas
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const area = document.getElementById("canvasArea");
  area.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  area.addEventListener("drop", async e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    // Find which artboard slot the drop is over
    const rect = area.getBoundingClientRect();
    const vpt  = canvas.viewportTransform;
    const canX = (e.clientX - rect.left - vpt[4]) / vpt[0];
    const canY = (e.clientY - rect.top  - vpt[5]) / vpt[3];

    let targetFrame = activeFrameId;
    let targetSlot  = 0;
    outer:
    for (const ab of Object.values(ArtboardMap)) {
      for (const slot of ab.config.slots) {
        const s  = ab.scale;
        const sx = ab.ox + slot.x * s;
        const sy = ab.oy + slot.y * s;
        if (canX >= sx && canX <= sx + slot.w * s && canY >= sy && canY <= sy + slot.h * s) {
          targetFrame = ab.frameId;
          targetSlot  = slot.index;
          break outer;
        }
      }
    }
    await uploadPhoto(targetFrame, targetSlot, file);
  });
});

// ─────────────────────────────────────────────────────────────────
// SELECTION EVENTS
// ─────────────────────────────────────────────────────────────────
function onSelectionChange(e) {
  const obj = e.selected ? e.selected[0] : null;
  if (!obj) return;
  const d = obj.data || {};

  // Auto-activate the artboard this object belongs to
  if (d.frameId && d.frameId !== activeFrameId) activateArtboard(d.frameId);

  if (d.type === "slot-image") {
    const state = ArtboardMap[d.frameId];
    if (state) state.selectedSlotIdx = d.slotIndex;

    showEl("filterControls"); hideEl("filterHint");
    showEl("blendControls");  hideEl("blendHint");
    showEl("transformControls"); hideEl("transformHint");
    syncColorPanel(d.frameId, d.slotIndex);
    syncBlendPanel(d.frameId, d.slotIndex);
    syncTransformPanel(obj);
    hideEl("selectedTextEdit");
    showSlotInfoInRight(obj);
  } else if (d.type === "text-overlay") {
    hideEl("filterControls"); showEl("filterHint");
    hideEl("blendControls");  showEl("blendHint");
    showEl("transformControls"); hideEl("transformHint");
    syncTransformPanel(obj);
    showEl("selectedTextEdit");
    document.getElementById("txtEditContent").value = obj.text || "";
  } else {
    hideEl("filterControls"); showEl("filterHint");
    hideEl("blendControls");  showEl("blendHint");
    hideEl("transformControls"); showEl("transformHint");
    hideEl("selectedTextEdit");
  }
}

function onSelectionCleared() {
  hideEl("filterControls"); showEl("filterHint");
  hideEl("blendControls");  showEl("blendHint");
  hideEl("transformControls"); showEl("transformHint");
  hideEl("selectedTextEdit");
}

function showSlotInfoInRight(obj) {
  // Update right panel active frame info with per-slot photo info
  const d = obj.data || {};
  const infoBody = document.getElementById("activeFrameInfoBody");
  if (!infoBody) return;
  // Append or update photo info row
  let photoRow = infoBody.querySelector(".photo-info-row");
  if (!photoRow) {
    photoRow = document.createElement("div");
    photoRow.className = "photo-info-row";
    infoBody.appendChild(photoRow);
  }
  photoRow.innerHTML = `
    <div class="info-row"><span>Slot</span><strong>Slot ${(d.slotIndex ?? 0) + 1}</strong></div>
    <div class="info-row"><span>File</span><strong style="font-size:10px;word-break:break-all">${d.fileName || "–"}</strong></div>
    <div class="info-row"><span>Scale</span><strong>${obj.scaleX.toFixed(2)}×</strong></div>
    <div class="info-row"><span>Pos</span><strong>${Math.round(obj.left)}, ${Math.round(obj.top)}</strong></div>`;
}

// ─────────────────────────────────────────────────────────────────
// ARTBOARD LIST PANEL  (right panel)
// ─────────────────────────────────────────────────────────────────
function renderArtboardListPanel() {
  const list = document.getElementById("artboardList");
  list.innerHTML = "";
  window.ARTBOARDS.forEach(ab => {
    const item = document.createElement("div");
    item.className = "layer-item artboard-list-item";
    item.id = "ali-" + ab.id;
    item.innerHTML = `
      <span class="layer-icon">🖼</span>
      <span class="layer-name">${ab.display_name}</span>
      <span style="font-size:10px;color:var(--editor-muted)">${ab.canvas_width}×${ab.canvas_height}</span>`;
    item.addEventListener("click", () => {
      activateArtboard(ab.id);
      scrollToArtboard(ab.id);
    });
    list.appendChild(item);
  });
}

function scrollToArtboard(frameId) {
  const state = ArtboardMap[frameId];
  if (!state) return;

  const area  = document.getElementById("canvasArea");
  const viewW = area.clientWidth  || window.innerWidth  - 480;
  const viewH = area.clientHeight || window.innerHeight - 48;

  // Fit artboard into 88% of the visible viewport.
  // No artificial upper cap — the viewport itself is the boundary now that
  // canvas dimensions always equal the viewport size.
  const padding = 0.88;
  const zoom = Math.min(
    (viewW * padding) / state.dispW,
    (viewH * padding) / state.dispH
  );

  // Center of the artboard in world coordinates
  const cx = state.ox + state.dispW / 2;
  const cy = state.oy + state.dispH / 2;

  // Pan so the artboard center lands at the viewport center
  const vpt = canvas.viewportTransform.slice();
  vpt[0] = zoom; vpt[3] = zoom;
  vpt[4] = viewW / 2 - cx * zoom;
  vpt[5] = viewH / 2 - cy * zoom;
  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
  updateLabelPositions();
  updateZoomDisplay();
}

function renderActiveFrameInfo(frameId) {
  const state = ArtboardMap[frameId];
  const body  = document.getElementById("activeFrameInfoBody");
  if (!body || !state) return;
  body.innerHTML = `
    <div class="info-row"><span>Frame</span><strong>${state.config.display_name}</strong></div>
    <div class="info-row"><span>Size</span><strong>${state.config.canvas_width}×${state.config.canvas_height}</strong></div>
    <div class="info-row"><span>Slots</span><strong>${state.config.slot_count}</strong></div>
    <div class="info-row"><span>Date</span><strong>${window.DARSHAN_DATE}</strong></div>
    <button class="slot-upload-btn" style="margin-top:8px;width:100%" id="btnExportActive">Export this frame</button>`;
  document.getElementById("btnExportActive")?.addEventListener("click", () => exportFrame(frameId));
}

// ─────────────────────────────────────────────────────────────────
// LAYERS PANEL
// ─────────────────────────────────────────────────────────────────
function bindLayersPanel() {
  document.getElementById("btnRefreshLayers")?.addEventListener("click", refreshLayersPanel);
}

function refreshLayersPanel() {
  const list = document.getElementById("layersList");
  if (!list) return;
  list.innerHTML = "";
  const objs = canvas.getObjects().filter(o => {
    const d = o.data || {};
    return d.frameId === activeFrameId
      && d.type !== "slot-label"
      && d.type !== "artboard-bg";
  });
  if (!objs.length) { list.innerHTML = "<p class='filter-hint'>No objects</p>"; return; }

  [...objs].reverse().forEach(obj => {
    const d    = obj.data || {};
    const item = document.createElement("div");
    item.className = "layer-item";
    const icon = d.type === "slot-image"    ? "📷"
               : d.type === "text-overlay"  ? "T"
               : d.type === "frame-overlay" ? "🖼"
               : d.type === "slot-placeholder" ? "⬜"
               : "◻";
    const name = d.type === "slot-image"   ? `Photo – Slot ${(d.slotIndex ?? 0) + 1}`
               : d.type === "text-overlay" ? (obj.text || "Text").slice(0, 22)
               : d.type === "frame-overlay"? "Frame Overlay"
               : "Object";
    item.innerHTML = `<span class="layer-icon">${icon}</span><span class="layer-name">${name}</span>`;
    item.addEventListener("click", () => {
      if (d.type !== "frame-overlay" && d.type !== "slot-placeholder") {
        canvas.setActiveObject(obj);
        canvas.renderAll();
      }
    });
    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────────────────────────
// COLOR / BLEND / TRANSFORM PANELS
// ─────────────────────────────────────────────────────────────────
function syncColorPanel(frameId, slotIndex) {
  const f = ArtboardMap[frameId]?.slotFilters[slotIndex];
  if (!f) return;
  sv("fBrightness", f.brightness * 100, "fBrightness_val", Math.round(f.brightness * 100));
  sv("fContrast",   f.contrast   * 100, "fContrast_val",   Math.round(f.contrast * 100));
  sv("fSaturation", f.saturation * 100, "fSaturation_val", Math.round(f.saturation * 100));
  sv("fHue",        f.hue,              "fHue_val",        Math.round(f.hue) + "°");
  sv("fBlur",       f.blur,             "fBlur_val",       f.blur);
  sv("fNoise",      f.noise,            "fNoise_val",      f.noise);
  sv("fGammaR",     f.gamma_r * 100,    "fGammaR_val",     f.gamma_r.toFixed(2));
  sv("fGammaG",     f.gamma_g * 100,    "fGammaG_val",     f.gamma_g.toFixed(2));
  sv("fGammaB",     f.gamma_b * 100,    "fGammaB_val",     f.gamma_b.toFixed(2));
  sc("fGrayscale", f.grayscale); sc("fSepia", f.sepia); sc("fInvert", f.invert);
  sc("fVintage",   f.vintage);   sc("fSharpen", f.sharpen);
  sc("fPolaroid",  f.polaroid);  sc("fKodachrome", f.kodachrome);
}
function sv(id, val, vid, disp) {
  const el = document.getElementById(id); if (el) el.value = val;
  const ve = document.getElementById(vid); if (ve) ve.textContent = disp;
}
function sc(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }

function syncBlendPanel(frameId, slotIndex) {
  const f = ArtboardMap[frameId]?.slotFilters[slotIndex];
  if (!f) return;
  sv("fOpacity", Math.round(f.opacity * 100), "fOpacity_val", Math.round(f.opacity * 100) + "%");
  const bm = document.getElementById("fBlendMode"); if (bm) bm.value = f.blendMode || "source-over";
}

function syncTransformPanel(obj) {
  document.getElementById("tfX").value   = Math.round(obj.left);
  document.getElementById("tfY").value   = Math.round(obj.top);
  document.getElementById("tfW").value   = Math.round(obj.getScaledWidth());
  document.getElementById("tfH").value   = Math.round(obj.getScaledHeight());
  document.getElementById("tfRot").value = Math.round(obj.angle || 0);
}

function bindColorControls() {
  function mkSlider(id, vid, toDisplay, setter) {
    document.getElementById(id)?.addEventListener("input", () => {
      const obj = canvas.getActiveObject();
      if (!obj?.data) return;
      const { frameId, slotIndex } = obj.data;
      if (frameId == null || slotIndex == null) return;
      const f   = ArtboardMap[frameId]?.slotFilters[slotIndex];
      if (!f) return;
      const val = parseFloat(document.getElementById(id).value);
      setter(f, val);
      document.getElementById(vid).textContent = toDisplay(val);
      applyFiltersToSlot(frameId, slotIndex);
      scheduleAutosave();
    });
  }
  mkSlider("fBrightness","fBrightness_val", v=>Math.round(v),     (f,v)=>f.brightness = v/100);
  mkSlider("fContrast",  "fContrast_val",   v=>Math.round(v),     (f,v)=>f.contrast   = v/100);
  mkSlider("fSaturation","fSaturation_val", v=>Math.round(v),     (f,v)=>f.saturation = v/100);
  mkSlider("fHue",       "fHue_val",        v=>Math.round(v)+"°", (f,v)=>f.hue        = v);
  mkSlider("fBlur",      "fBlur_val",       v=>Math.round(v),     (f,v)=>f.blur       = v);
  mkSlider("fNoise",     "fNoise_val",      v=>Math.round(v),     (f,v)=>f.noise      = v);
  mkSlider("fGammaR",    "fGammaR_val",     v=>(v/100).toFixed(2),(f,v)=>f.gamma_r    = v/100);
  mkSlider("fGammaG",    "fGammaG_val",     v=>(v/100).toFixed(2),(f,v)=>f.gamma_g    = v/100);
  mkSlider("fGammaB",    "fGammaB_val",     v=>(v/100).toFixed(2),(f,v)=>f.gamma_b    = v/100);

  ["fGrayscale","fSepia","fInvert","fVintage","fSharpen","fPolaroid","fKodachrome"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      const obj = canvas.getActiveObject();
      if (!obj?.data) return;
      const { frameId, slotIndex } = obj.data;
      const f = ArtboardMap[frameId]?.slotFilters[slotIndex];
      if (!f) return;
      f[id.replace("f","").toLowerCase()] = document.getElementById(id).checked;
      applyFiltersToSlot(frameId, slotIndex);
      scheduleAutosave();
    });
  });

  document.getElementById("btnAutoColor")?.addEventListener("click", async () => {
    const obj = canvas.getActiveObject();
    if (!obj?.data?.photoId) { notify("Select a slot photo first", "info"); return; }
    notify("Running auto color correction…", "info");
    const r = await apiFetch(`/api/auto-color/${obj.data.photoId}/`);
    if (r.success) {
      const { frameId, slotIndex } = obj.data;

      // Build list: the active object + any synced-slot objects (same tall-portrait group)
      const syncTargets = getSyncTargets(frameId, slotIndex);
      const allSwaps = [
        { targetObj: obj, fid: frameId, sid: slotIndex },
        ...syncTargets
          .map(t => ({
            targetObj: ArtboardMap[t.frameId]?.slotImages[t.slotIndex],
            fid: t.frameId,
            sid: t.slotIndex,
          }))
          .filter(t => t.targetObj),
      ];

      // Load the corrected image once; browser caches it for subsequent swaps
      fabric.Image.fromURL(r.url, newImg => {
        allSwaps.forEach(({ targetObj, fid, sid }) => {
          // Snapshot every transform so position is never disturbed
          const snap = {
            left:    targetObj.left,
            top:     targetObj.top,
            scaleX:  targetObj.scaleX,
            scaleY:  targetObj.scaleY,
            angle:   targetObj.angle,
            flipX:   targetObj.flipX,
            flipY:   targetObj.flipY,
            originX: targetObj.originX,
            originY: targetObj.originY,
            clipPath: targetObj.clipPath,
            data:    { ...targetObj.data },
          };

          // Swap the underlying image element in-place
          targetObj._element         = newImg._element;
          targetObj._originalElement = newImg._originalElement;
          targetObj.width            = newImg.width;
          targetObj.height           = newImg.height;

          targetObj.set(snap);

          const state = ArtboardMap[fid];
          const slot  = state?.config.slots.find(s => s.index === sid);
          ensureSlotImageCoverage(state, slot, targetObj);
          applyFiltersToSlot(fid, sid);
          targetObj.setCoords();
        });

        canvas.renderAll();
        pushUndo();
        scheduleAutosave();
        const n = allSwaps.length;
        notify(
          n > 1
            ? `Auto color applied to ${n} frames ✓`
            : "Auto color applied — position unchanged ✓",
          "success"
        );
      }, { crossOrigin: "anonymous" });
    } else {
      notify("Auto color failed: " + r.error, "error");
    }
  });

  document.getElementById("btnResetColor")?.addEventListener("click", () => {
    const obj = canvas.getActiveObject();
    if (!obj?.data) return;
    const { frameId, slotIndex } = obj.data;
    if (frameId == null || slotIndex == null) return;
    ArtboardMap[frameId].slotFilters[slotIndex] = defaultFilters();
    syncColorPanel(frameId, slotIndex);
    syncBlendPanel(frameId, slotIndex);
    applyFiltersToSlot(frameId, slotIndex);
    scheduleAutosave();
  });
}

function bindBlendControls() {
  document.getElementById("fOpacity")?.addEventListener("input", () => {
    const obj = canvas.getActiveObject();
    if (!obj?.data) return;
    const { frameId, slotIndex } = obj.data;
    const f = ArtboardMap[frameId]?.slotFilters[slotIndex]; if (!f) return;
    f.opacity = parseFloat(document.getElementById("fOpacity").value) / 100;
    document.getElementById("fOpacity_val").textContent = Math.round(f.opacity * 100) + "%";
    applyFiltersToSlot(frameId, slotIndex); scheduleAutosave();
  });
  document.getElementById("fBlendMode")?.addEventListener("change", () => {
    const obj = canvas.getActiveObject();
    if (!obj?.data) return;
    const { frameId, slotIndex } = obj.data;
    const f = ArtboardMap[frameId]?.slotFilters[slotIndex]; if (!f) return;
    f.blendMode = document.getElementById("fBlendMode").value;
    applyFiltersToSlot(frameId, slotIndex); scheduleAutosave();
  });
}

function bindTransformControls() {
  const applyTf = () => {
    const obj = canvas.getActiveObject(); if (!obj) return;
    const x   = parseFloat(document.getElementById("tfX").value);
    const y   = parseFloat(document.getElementById("tfY").value);
    const w   = parseFloat(document.getElementById("tfW").value);
    const h   = parseFloat(document.getElementById("tfH").value);
    const rot = parseFloat(document.getElementById("tfRot").value);
    if (!isNaN(x))   obj.set("left",  x);
    if (!isNaN(y))   obj.set("top",   y);
    if (!isNaN(rot)) obj.set("angle", rot);
    if (!isNaN(w) && w > 0) obj.scaleX = w / obj.width;
    if (!isNaN(h) && h > 0) obj.scaleY = h / obj.height;
    const slotBinding = getSlotForImageObject(obj);
    if (slotBinding) {
      obj.data = { ...(obj.data || {}), manualCrop: true };
      ensureSlotImageCoverage(slotBinding.state, slotBinding.slot, obj);
    }
    obj.setCoords(); canvas.renderAll(); pushUndo(); scheduleAutosave();
  };
  ["tfX","tfY","tfW","tfH","tfRot"].forEach(id => document.getElementById(id)?.addEventListener("change", applyTf));
  document.getElementById("btnFlipH")?.addEventListener("click", () => {
    const o = canvas.getActiveObject(); if (!o) return;
    o.set("flipX", !o.flipX); canvas.renderAll(); pushUndo();
  });
  document.getElementById("btnFlipV")?.addEventListener("click", () => {
    const o = canvas.getActiveObject(); if (!o) return;
    o.set("flipY", !o.flipY); canvas.renderAll(); pushUndo();
  });
  const syncTransformHud = target => {
    syncTransformPanel(target);
    updateHud(target);
  };
  canvas.on("object:moving",   e => syncTransformHud(e.target));
  canvas.on("object:scaling",  e => syncTransformHud(e.target));
  canvas.on("object:rotating", e => syncTransformHud(e.target));
  canvas.on("mouse:up",        () => hideHud());
  canvas.on("selection:cleared", () => hideHud());
}

// ─────────────────────────────────────────────────────────────────
// TEXT
// ─────────────────────────────────────────────────────────────────
function addText(text, overrides = {}) {
  const state  = ArtboardMap[activeFrameId];
  if (!state) return;
  const defaults = {
    left:       state.ox + state.dispW / 2,
    top:        state.oy + state.dispH / 2,
    originX:    "center", originY: "center",
    fontFamily: document.getElementById("txtFont").value,
    fontSize:   parseInt(document.getElementById("txtSize").value, 10) || 60,
    fill:       document.getElementById("txtColor").value,
    fontWeight: document.getElementById("txtBold").checked      ? "bold"   : "normal",
    fontStyle:  document.getElementById("txtItalic").checked    ? "italic" : "normal",
    underline:  document.getElementById("txtUnderline").checked,
    textAlign:  document.getElementById("txtAlign").value,
    stroke:     document.getElementById("txtStrokeColor").value,
    strokeWidth: parseInt(document.getElementById("txtStrokeW").value, 10) || 0,
    shadow: document.getElementById("txtShadow").checked
      ? new fabric.Shadow({ color: "rgba(0,0,0,.65)", blur: 10, offsetX: 2, offsetY: 2 })
      : null,
    data: { type: "text-overlay", frameId: activeFrameId },
  };
  const itext = new fabric.IText(text, { ...defaults, ...overrides });
  canvas.add(itext);
  bringOverlayToFront(state);
  canvas.setActiveObject(itext);
  canvas.renderAll();
  pushUndo(); scheduleAutosave();
}

function bindTextControls() {
  document.getElementById("btnAddText")?.addEventListener("click", () => {
    const txt = prompt("Enter text:", "Jay Swaminarayan 🙏");
    if (txt?.trim()) addText(txt);
  });
  document.getElementById("btnAddDate")?.addEventListener("click", () => {
    const d = new Date();
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    addText(`${d.getDate()} ${mon[d.getMonth()]} ${d.getFullYear()}`, { fontSize: 48 });
  });
  document.getElementById("btnAddTitle")?.addEventListener("click", () => {
    const state = ArtboardMap[activeFrameId];
    addText(state?.config?.display_name || "Darshan", { fontSize: 64 });
  });

  document.getElementById("txtEditContent")?.addEventListener("input", () => {
    const obj = canvas.getActiveObject();
    if (obj?.type === "i-text" || obj?.type === "text") {
      const newVal = document.getElementById("txtEditContent").value;
      obj.set("text", newVal);
      // If this is an auto-text field, propagate to all other artboards
      if (obj.data?.textKey) syncAutoText(obj.data.frameId, obj.data.textKey, newVal);
    }
    canvas.renderAll(); scheduleAutosave();
  });

  const textProps = {
    txtFont:        (o,v) => o.set("fontFamily",  v),
    txtSize:        (o,v) => o.set("fontSize",    parseInt(v,10)||36),
    txtColor:       (o,v) => o.set("fill",        v),
    txtStrokeColor: (o,v) => o.set("stroke",      v),
    txtStrokeW:     (o,v) => o.set("strokeWidth", parseInt(v,10)||0),
    txtAlign:       (o,v) => o.set("textAlign",   v),
  };
  Object.entries(textProps).forEach(([id, setter]) => {
    document.getElementById(id)?.addEventListener("change", () => {
      const obj = canvas.getActiveObject();
      if (!obj || (obj.type !== "i-text" && obj.type !== "text")) return;
      setter(obj, document.getElementById(id).value);
      canvas.renderAll(); scheduleAutosave();
    });
  });
  ["txtBold","txtItalic","txtUnderline","txtShadow"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      const obj = canvas.getActiveObject();
      if (!obj || (obj.type !== "i-text" && obj.type !== "text")) return;
      const on = document.getElementById(id).checked;
      if (id === "txtBold")      obj.set("fontWeight", on ? "bold"   : "normal");
      if (id === "txtItalic")    obj.set("fontStyle",  on ? "italic" : "normal");
      if (id === "txtUnderline") obj.set("underline",  on);
      if (id === "txtShadow")    obj.set("shadow", on ? new fabric.Shadow({color:"rgba(0,0,0,.65)",blur:10,offsetX:2,offsetY:2}) : null);
      canvas.renderAll(); scheduleAutosave();
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// TOOL BUTTONS
// ─────────────────────────────────────────────────────────────────
function bindToolButtons() {
  document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setTool(btn.dataset.tool);
    });
  });
}
function setTool(tool) {
  currentTool = tool;
  if (tool === "select") {
    canvas.isDrawingMode = false;
    canvas.selection     = true;
    canvas.defaultCursor = "default";
  } else if (tool === "hand") {
    canvas.isDrawingMode = false;
    canvas.selection     = false;
    canvas.discardActiveObject();
    canvas.defaultCursor = "grab";
    canvas.renderAll();
  } else if (tool === "text") {
    setTool("select");
    const txt = prompt("Enter text:", "Jay Swaminarayan 🙏");
    if (txt?.trim()) addText(txt);
    document.querySelector(".tool-btn[data-tool='select']")?.classList.add("active");
    document.querySelector(".tool-btn[data-tool='text']")?.classList.remove("active");
  }
}

// ─────────────────────────────────────────────────────────────────
// ARTBOARD TABS
// ─────────────────────────────────────────────────────────────────
function bindArtboardTabs() {
  document.querySelectorAll(".artboard-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const fid = parseInt(btn.dataset.frameId);
      activateArtboard(fid);
      scrollToArtboard(fid);
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// TOP BAR
// ─────────────────────────────────────────────────────────────────
function bindTopBar() {
  document.getElementById("btnSave")?.addEventListener("click",   saveSession);
  document.getElementById("btnExport")?.addEventListener("click",    () => exportFrame(activeFrameId));
  document.getElementById("btnExportAll")?.addEventListener("click", () => exportAll());
  document.getElementById("btnUndo")?.addEventListener("click",   undo);
  document.getElementById("btnRedo")?.addEventListener("click",   redo);
  document.getElementById("btnZoomIn")?.addEventListener("click",  () => adjustZoom(1.2));
  document.getElementById("btnZoomOut")?.addEventListener("click", () => adjustZoom(1/1.2));
  document.getElementById("btnFitAll")?.addEventListener("click",    fitAll);
  document.getElementById("btnFocusFrame")?.addEventListener("click", focusActiveFrame);
  document.getElementById("btnDeleteSelected")?.addEventListener("click", () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const d = obj.data || {};
    if (["frame-overlay","slot-placeholder","slot-label","artboard-bg"].includes(d.type)) return;
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
    pushUndo(); scheduleAutosave();
  });
}

// ─────────────────────────────────────────────────────────────────
// ZOOM / PAN
// ─────────────────────────────────────────────────────────────────
function onWheel(opt) {
  const delta = opt.e.deltaY;
  const zoom  = clamp(canvas.getZoom() * Math.pow(0.999, delta), 0.05, 10);
  canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
  opt.e.preventDefault(); opt.e.stopPropagation();
  updateZoomDisplay(); updateLabelPositions();
}
function onMouseDown(opt) {
  if (currentTool !== "hand") return;
  isPanning  = true;
  lastPanPt  = { x: opt.e.clientX, y: opt.e.clientY };
  canvas.defaultCursor = "grabbing";
}
function onMouseMove(opt) {
  if (!isPanning) return;
  const vpt = canvas.viewportTransform;
  vpt[4] += opt.e.clientX - lastPanPt.x;
  vpt[5] += opt.e.clientY - lastPanPt.y;
  canvas.requestRenderAll();
  lastPanPt = { x: opt.e.clientX, y: opt.e.clientY };
  updateLabelPositions();
}
function onMouseUp() {
  isPanning = false;
  if (currentTool === "hand") canvas.defaultCursor = "grab";
}

function adjustZoom(factor) {
  const zoom = clamp(canvas.getZoom() * factor, 0.05, 10);
  canvas.zoomToPoint({ x: canvas.width/2, y: canvas.height/2 }, zoom);
  updateZoomDisplay(); updateLabelPositions();
}
function fitAll() {
  const area  = document.getElementById("canvasArea");
  const viewW = area.clientWidth  || window.innerWidth  - 480;
  const viewH = area.clientHeight || window.innerHeight - 48;

  const xs   = Object.values(ArtboardMap).map(a => a.ox);
  const ys   = Object.values(ArtboardMap).map(a => a.oy);
  const x2   = Math.max(...Object.values(ArtboardMap).map(a => a.ox + a.dispW));
  const y2   = Math.max(...Object.values(ArtboardMap).map(a => a.oy + a.dispH));
  const allW = x2 - Math.min(...xs) + 120;
  const allH = y2 - Math.min(...ys) + 100;
  const zoom = Math.min(viewW / allW, viewH / allH, 1) * 0.92;
  const cx   = (Math.min(...xs) + x2) / 2;
  const cy   = (Math.min(...ys) + y2) / 2;
  canvas.setZoom(zoom);
  canvas.viewportTransform[4] = viewW / 2 - cx * zoom;
  canvas.viewportTransform[5] = viewH / 2 - cy * zoom;
  canvas.requestRenderAll();
  updateZoomDisplay(); updateLabelPositions();
}
// Jump to and fit the currently active frame (Ctrl/Cmd+0)
function focusActiveFrame() {
  if (!activeFrameId) return;
  scrollToArtboard(activeFrameId);
}
function updateZoomDisplay() {
  const el = document.getElementById("zoomDisplay");
  if (el) el.textContent = Math.round(canvas.getZoom() * 100) + "%";
}

// ─────────────────────────────────────────────────────────────────
// UNDO / REDO
// ─────────────────────────────────────────────────────────────────
function pushUndo() {
  const snap = serializeAll();
  undoStack.push(snap);
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
}
function undo() {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  restoreAll(undoStack[undoStack.length - 1]);
}
function redo() {
  if (!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(snap);
  restoreAll(snap);
}
function serializeAll() {
  // Snapshot per-artboard canvas objects
  const snap = {};
  Object.values(ArtboardMap).forEach(ab => {
    const objs = canvas.getObjects().filter(o => {
      const d = o.data || {};
      return d.frameId === ab.frameId && d.type !== "artboard-bg";
    });
    snap[ab.frameId] = objs.map(o => o.toObject(["data", "clipPath"]));
  });
  return JSON.stringify(snap);
}
function restoreAll(snapStr) {
  const snap = JSON.parse(snapStr);
  // Remove all non-bg objects first
  canvas.getObjects().filter(o => {
    const d = o.data || {};
    return d.type !== "artboard-bg";
  }).forEach(o => canvas.remove(o));

  // Restore per-artboard
  Object.entries(snap).forEach(([fid, objs]) => {
    const state = ArtboardMap[parseInt(fid)];
    if (!state) return;
    state.slotImages  = {};
    state.overlayObj  = null;
    state.placeholders = [];

    fabric.util.enlivenObjects(objs, loaded => {
      loaded.forEach(obj => {
        canvas.add(obj);
        const d = obj.data || {};
        if (d.type === "slot-image") {
          const slot = state.config.slots.find(s => s.index === d.slotIndex);
          state.slotImages[d.slotIndex] = obj;
          obj.clipPath = makeSlotClip(state, slot);
          ensureSlotImageCoverage(state, slot, obj);
        }
        if (d.type === "frame-overlay") { state.overlayObj = obj; obj.set({selectable:false,evented:false}); }
        if (d.type === "slot-placeholder") state.placeholders.push(obj);
      });
      canvas.renderAll();
    });
  });
  refreshLayersPanel();
  renderSlotsPanel(activeFrameId);
}

// ─────────────────────────────────────────────────────────────────
// SAVE & EXPORT
// ─────────────────────────────────────────────────────────────────
async function saveSession() {
  setStatus("Saving…");
  // Build artboards map: {frameId → canvas_json_for_that_frame}
  const artboards = {};
  Object.values(ArtboardMap).forEach(ab => {
    const objs = canvas.getObjects().filter(o => {
      const d = o.data || {};
      return d.frameId === ab.frameId && d.type !== "artboard-bg" && d.type !== "slot-placeholder" && d.type !== "slot-label";
    });
    artboards[ab.frameId] = {
      objects: objs.map(o => o.toObject(["data", "clipPath"])),
      display_scale: ab.scale,
      display_ox: ab.ox,
      display_oy: ab.oy,
    };
  });

  const r = await apiPost("/api/session/save/", {
    session_id: window.SESSION.id,
    artboards,
  });
  if (r.success) {
    setStatus("Saved ✓");
    setTimeout(() => setStatus(""), 2500);
  } else {
    setStatus("Save failed");
    notify("Save failed: " + r.error, "error");
  }
}

// ─────────────────────────────────────────────────────────────────
// EXPORT  — pixel-perfect client-side PNG at native resolution
//
// KEY FIX: Fabric.js toDataURL(left/top/width/height) uses SCREEN
// coordinates (after viewport transform). If the user has panned or
// zoomed, those coords are wrong. We must:
//   1. Save current viewport transform
//   2. Reset to identity [1,0,0,1,0,0]  (zoom=1, no pan)
//   3. Capture with world coordinates (ox,oy,dispW,dispH)
//   4. Restore viewport transform
// The multiplier = native_width / display_width gives native res.
// ─────────────────────────────────────────────────────────────────

function _exportFilename(state) {
  const date = window.SESSION?.darshan_date || "export";
  return `${state.config.darshan_type}_${state.config.frame_type}_${date}.png`;
}

function _captureArtboard(state) {
  // 1. Deselect so handles don't appear
  canvas.discardActiveObject();

  // 2. Save viewport transform
  const savedVpt = canvas.viewportTransform.slice();

  // 3. Reset to identity — objects are now at their raw layout positions
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  // 4. Capture: left/top/width/height are now correct world coords
  const multiplier = state.config.canvas_width / state.dispW;
  const dataURL = canvas.toDataURL({
    format:     "png",
    multiplier: multiplier,
    left:       state.ox,
    top:        state.oy,
    width:      state.dispW,
    height:     state.dispH,
  });

  // 5. Restore viewport transform
  canvas.setViewportTransform(savedVpt);
  canvas.renderAll();

  return dataURL;
}

function _dataURLtoBlob(dataURL) {
  const [header, b64] = dataURL.split(",");
  const mime   = header.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportFrame(frameId) {
  const state = ArtboardMap[frameId];
  if (!state) return;

  const hasPhoto = canvas.getObjects().some(o =>
    o.data?.frameId === frameId && o.data?.type === "slot-image"
  );
  if (!hasPhoto) { notify("Upload at least one photo first", "info"); return; }

  const overlay = document.getElementById("exportOverlay");
  const msg     = document.getElementById("exportMsg");
  overlay.style.display = "flex";
  msg.textContent = `Exporting ${state.config.display_name} — ${state.config.canvas_width}×${state.config.canvas_height}px…`;

  // Let the overlay paint before blocking the thread
  await new Promise(r => setTimeout(r, 60));

  try {
    const dataURL = _captureArtboard(state);
    const blob    = _dataURLtoBlob(dataURL);
    _downloadBlob(blob, _exportFilename(state));
    notify(`✓ Exported ${state.config.display_name} (${state.config.canvas_width}×${state.config.canvas_height})`, "success");
  } catch (err) {
    notify("Export failed: " + err.message, "error");
    console.error("Export error:", err);
  } finally {
    overlay.style.display = "none";
  }
}

async function exportAll() {
  const toExport = Object.values(ArtboardMap).filter(s =>
    canvas.getObjects().some(o => o.data?.frameId === s.frameId && o.data?.type === "slot-image")
  );
  if (!toExport.length) { notify("Upload photos first before bulk export", "info"); return; }

  const overlay = document.getElementById("exportOverlay");
  const msg     = document.getElementById("exportMsg");
  overlay.style.display = "flex";

  // ── Step 1: render all frames to blobs ───────────────────────
  msg.textContent = `Rendering ${toExport.length} frames…`;
  await new Promise(r => setTimeout(r, 60));

  const rendered = [];
  try {
    for (let i = 0; i < toExport.length; i++) {
      const state = toExport[i];
      msg.textContent = `Rendering ${i + 1} / ${toExport.length}: ${state.config.display_name}…`;
      await new Promise(r => setTimeout(r, 30));
      const dataURL = _captureArtboard(state);
      const blob    = await (await fetch(dataURL)).blob();
      rendered.push({ blob, filename: _exportFilename(state), name: state.config.display_name });
    }
  } catch (err) {
    notify("Render failed: " + err.message, "error");
    overlay.style.display = "none";
    return;
  }

  // ── Step 2: pick a folder once, save all files silently ──────
  // File System Access API: supported in Chrome 86+, Edge 86+, Safari 15.2+
  if (window.showDirectoryPicker) {
    try {
      msg.textContent = "Pick a folder — all images will save there automatically…";
      const dirHandle = await window.showDirectoryPicker({ mode: "readwrite", startIn: "downloads" });

      for (let i = 0; i < rendered.length; i++) {
        const { blob, filename, name } = rendered[i];
        msg.textContent = `Saving ${i + 1} / ${rendered.length}: ${name}…`;
        await new Promise(r => setTimeout(r, 20));
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable   = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      }
      overlay.style.display = "none";
      notify(`✓ All ${rendered.length} PNGs saved to the selected folder`, "success");
      return;
    } catch (err) {
      if (err.name !== "AbortError") {
        notify("Save failed: " + err.message, "error");
        overlay.style.display = "none";
        return;
      }
      // User cancelled the folder picker — fall through to sequential downloads
    }
  }

  // ── Fallback: sequential individual downloads ────────────────
  // Chrome/Edge will prompt once "allow multiple downloads" then save all.
  // Safari will save each to Downloads automatically without prompting.
  try {
    msg.textContent = `Downloading ${rendered.length} PNG files…`;
    for (let i = 0; i < rendered.length; i++) {
      const { blob, filename, name } = rendered[i];
      msg.textContent = `Downloading ${i + 1} / ${rendered.length}: ${name}…`;
      _downloadBlob(blob, filename);
      await new Promise(r => setTimeout(r, 300));
    }
    notify(`✓ Exported ${rendered.length} PNG files`, "success");
  } catch (err) {
    notify("Bulk export failed: " + err.message, "error");
    console.error("Bulk export error:", err);
  } finally {
    overlay.style.display = "none";
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveSession, 15000);
}

// ─────────────────────────────────────────────────────────────────
// KEYBOARD
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// AUTO-TEXT SYNC  — propagate edits to same field on all artboards
// ─────────────────────────────────────────────────────────────────
function bindAutoTextSync() {
  // When user finishes editing an auto-text IText, sync to all artboards
  canvas.on("text:editing:exited", e => {
    const obj = e.target;
    if (!obj?.data?.textKey) return;
    syncAutoText(obj.data.frameId, obj.data.textKey, obj.text);
    pushUndo();
    scheduleAutosave();
  });

  // Also sync on every keystroke so other artboards update live
  canvas.on("text:changed", e => {
    const obj = e.target;
    if (!obj?.data?.textKey) return;
    syncAutoText(obj.data.frameId, obj.data.textKey, obj.text);
  });
}

function bindKeyboard() {
  document.addEventListener("keydown", e => {
    if (isTyping()) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (e.key === "s") { e.preventDefault(); saveSession(); return; }
      if (e.key === "0") { e.preventDefault(); focusActiveFrame(); return; }
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      const obj = canvas.getActiveObject();
      if (!obj) return;
      const d = obj.data || {};
      if (["frame-overlay","slot-placeholder","slot-label","artboard-bg"].includes(d.type)) return;
      canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll();
      pushUndo(); scheduleAutosave();
    }
    switch (e.key.toLowerCase()) {
      case "v": setTool("select"); setActiveTool("select"); break;
      case "h": setTool("hand");   setActiveTool("hand");   break;
      case "t": document.querySelector(".tool-btn[data-tool='text']")?.click(); break;
      case "f": fitAll(); break;
      case "+": case "=": adjustZoom(1.2); break;
      case "-": adjustZoom(1/1.2); break;
    }
    // Number keys 1-9 → jump to artboard
    const n = parseInt(e.key);
    if (!isNaN(n) && n >= 1) {
      const ab = window.ARTBOARDS[n - 1];
      if (ab) { activateArtboard(ab.id); scrollToArtboard(ab.id); }
    }
  });
}
function isTyping() {
  const a = canvas.getActiveObject();
  return (a && a.isEditing) ||
    ["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName);
}
function setActiveTool(tool) {
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
}

// ─────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const r = await fetch(url, { headers: { "X-CSRFToken": csrf(), "Accept": "application/json" } });
  return r.json();
}
async function apiPost(url, data) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
    body: JSON.stringify(data),
  });
  return r.json();
}
async function apiFormPost(url, fd) {
  const r = await fetch(url, { method: "POST", headers: { "X-CSRFToken": csrf() }, body: fd });
  return r.json();
}
function csrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/); return m ? m[1] : "";
}


// ─────────────────────────────────────────────────────────────────
// ADJUSTMENT HUD — real-time % readout while moving/scaling images
// ─────────────────────────────────────────────────────────────────
function _getSlotBinding(obj) {
  if (!obj?.data || obj.data.type !== "slot-image") return null;
  const { frameId, slotIndex } = obj.data;
  const state = ArtboardMap[frameId];
  if (!state) return null;
  const slot = state.config.slots.find(s => s.index === slotIndex);
  return slot ? { state, slot } : null;
}

function updateHud(obj) {
  const hud = document.getElementById("adjustHud");
  if (!hud || !obj) return;

  const binding = _getSlotBinding(obj);
  if (!binding) { hud.style.display = "none"; return; }

  const { state, slot } = binding;
  const s        = state.scale;
  const slotLeft = state.ox + slot.x * s;
  const slotTop  = state.oy + slot.y * s;
  const slotW    = slot.w * s;
  const slotH    = slot.h * s;

  // Image center as % within slot  (50 = perfectly centred)
  const px = ((obj.left - slotLeft) / slotW * 100);
  const py = ((obj.top  - slotTop ) / slotH * 100);

  // Zoom % relative to minimum-fit scale  (100 = just covers slot)
  const { w: natW, h: natH } = imgNaturalDims(obj);
  const minSc  = getRequiredSlotImageScale(slotW, slotH, natW, natH);
  const zoomPct = minSc > 0 ? Math.round((obj.scaleX / minSc) * 100) : 100;

  const rot    = Math.round(obj.angle || 0);
  const isCenX = Math.abs(px - 50) < 2;
  const isCenY = Math.abs(py - 50) < 2;

  // Object centre in canvas-area screen coordinates
  const vpt   = canvas.viewportTransform;
  const area  = document.getElementById("canvasArea");
  const scrX  = obj.left * vpt[0] + vpt[4];   // screen x (0 = left of canvas-area)
  const scrY  = obj.top  * vpt[3] + vpt[5];   // screen y (0 = top  of canvas-area)
  const hudW  = 150;
  let hudX = scrX + 14;
  let hudY = scrY - 36;
  if (hudX + hudW > area.clientWidth  - 8) hudX = scrX - hudW - 14;
  if (hudY < 8) hudY = scrY + 14;

  hud.style.left    = Math.max(8, hudX) + "px";
  hud.style.top     = Math.max(8, hudY) + "px";
  hud.style.display = "block";

  hud.innerHTML =
    `<div class="hud-title">Slot ${slot.index + 1} of ${state.config.short_name}</div>` +
    `<div class="hud-row"><span class="hud-label">↔ X pos</span>` +
      `<span class="hud-val${isCenX ? " hud-center" : ""}">${px.toFixed(1)}%</span></div>` +
    `<div class="hud-row"><span class="hud-label">↕ Y pos</span>` +
      `<span class="hud-val${isCenY ? " hud-center" : ""}">${py.toFixed(1)}%</span></div>` +
    `<div class="hud-row"><span class="hud-label">⊕ Zoom</span>` +
      `<span class="hud-val">${zoomPct}%</span></div>` +
    (rot ? `<div class="hud-row"><span class="hud-label">↻ Angle</span>` +
      `<span class="hud-val">${rot}°</span></div>` : "");
}

function hideHud() {
  const hud = document.getElementById("adjustHud");
  if (hud) hud.style.display = "none";
}

// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────
function notify(msg, type = "info") {
  const el = document.createElement("div");
  el.className  = `notification notification-${type}`;
  el.textContent = msg;
  document.getElementById("notifications").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function setStatus(msg) {
  const el = document.getElementById("saveStatus"); if (el) el.textContent = msg;
}
function showEl(id) { const e = document.getElementById(id); if (e) e.style.display = "block"; }
function hideEl(id) { const e = document.getElementById(id); if (e) e.style.display = "none"; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
