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
const FILTER_PREVIEW_DELAY = 32;

function configureStableFilterBackend() {
  if (typeof fabric === "undefined") return;
  fabric.enableGLFiltering = false;
  if (fabric.Canvas2dFilterBackend) {
    fabric.filterBackend = new fabric.Canvas2dFilterBackend();
  }
}

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

// Ensure a Google Font (or any web font) is loaded into the document before
// Fabric.js tries to render it on canvas. If the font is already present the
// callback fires synchronously-ish; otherwise we wait up to 3 s.
function ensureFontLoaded(fontFamily, callback) {
  if (!fontFamily || typeof document === "undefined") { callback?.(); return; }
  document.fonts.load(`16px "${fontFamily}"`).then(() => callback?.()).catch(() => callback?.());
}

// Pre-load all fonts listed in the selector so they're ready before first render.
function preloadAllFonts() {
  const sel = document.getElementById("txtFont");
  if (!sel) return;
  Array.from(sel.options).forEach(opt => {
    if (opt.value) document.fonts.load(`16px "${opt.value}"`).catch(() => {});
  });
}

function addAutoTextToArtboard(state) {
  const layout = AUTO_TEXT_LAYOUT[state.config.frame_type];
  if (!layout) return;

  // Build a map of already-present auto-text objects for this artboard
  const existingByKey = {};
  canvas.getObjects()
    .filter(o => o.data?.frameId === state.frameId && o.data?.textKey)
    .forEach(o => { existingByKey[o.data.textKey] = o; });

  const s = state.scale;
  layout.forEach(def => {
    if (existingByKey[def.key]) {
      // Ensure existing auto-text objects are locked (covers sessions saved before locking)
      const existing = existingByKey[def.key];
      if (!existing.data) existing.data = {};
      existing.data.locked = true;
      // evented:true so clicks don't fall through to photos below; selectable:false prevents dragging
      existing.set({ selectable: false, evented: true, hoverCursor: "not-allowed" });
      if (canvas.getActiveObject() === existing) canvas.discardActiveObject();
      return;
    }

    const txt = new fabric.IText(autoTextValue(def.key), {
      left:        state.ox + def.x * s,
      top:         state.oy + def.y * s,
      originX:     def.originX,
      originY:     "center",
      fontSize:    Math.round(def.fontSize * s),
      fontFamily:  "Arial",
      fontWeight:  def.bold ? "bold" : "normal",
      fill:        def.color,
      shadow:      new fabric.Shadow({ color:"rgba(0,0,0,0.75)", blur:6, offsetX:1, offsetY:2 }),
      selectable:  false,
      evented:     true,   // consumes clicks so photos below are not accidentally moved
      hoverCursor: "not-allowed",
      data: { type:"text-overlay", frameId: state.frameId, textKey: def.key, locked: true },
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
  configureStableFilterBackend();
  computeLayout();
  initCanvas();
  initArtboards();
  bindToolButtons();
  bindArtboardTabs();
  bindColorControls();
  bindBlendControls();
  bindTransformControls();
  bindTextControls();
  bindSliderKeyboard();
  bindSettingsIO();
  bindShortcutsModal();
  bindTour();
  preloadAllFonts();
  bindTopBar();
  bindLayersPanel();
  bindKeyboard();
  bindAutoTextSync();
  initGlobalTooltip();
  initGuideDrag();
  bindGuidePanel();
  activateArtboard(window.ARTBOARDS[0].id);
  renderArtboardListPanel();
  bindExportSelector();
  bindQCModal();
  // Fit all artboards into view on startup
  requestAnimationFrame(fitAll);
});

// ─────────────────────────────────────────────────────────────────
// LAYOUT  (compute display size + offset for every artboard)
// ─────────────────────────────────────────────────────────────────
function computeLayout() {
  const artboards = window.ARTBOARDS;

  // Each artboard scales independently: height always fills DISPLAY_HEIGHT.
  // This ensures portrait, square, landscape, or any future aspect ratio all
  // display at the same visual height — slot coordinates scale correctly for
  // every frame regardless of its native canvas dimensions.
  globalScale = 1; // kept for legacy reference; not used for per-artboard scale

  let curX = 60;  // left margin
  artboards.forEach(ab => {
    const perScale = DISPLAY_HEIGHT / ab.canvas_height;  // per-artboard fit
    const dispW = Math.round(ab.canvas_width  * perScale);
    const dispH = Math.round(ab.canvas_height * perScale);  // always == DISPLAY_HEIGHT
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
  canvas.on("after:render", updateScrollbars);
  initScrollbars();

  // Slot placeholder click → open file picker (registered ONCE to avoid
  // multiple inp.click() calls when createSlotPlaceholders fires per artboard).
  canvas.on("mouse:down", e => {
    if (!e.target) return;
    const d = e.target.data;
    if (d && d.type === "slot-placeholder") {
      activateArtboard(d.frameId);
      const st = ArtboardMap[d.frameId];
      if (st) ensureFileInputs(d.frameId, st.config.slots);
      const inp = document.getElementById(`fi-${d.frameId}-${d.slotIndex}`);
      inp?.click();
    }
  });
  canvas.on("selection:created", onSelectionChange);
  canvas.on("selection:updated", onSelectionChange);
  canvas.on("selection:cleared", onSelectionCleared);
  canvas.on("object:modified",   e => {
    const slotBinding = getSlotForImageObject(e.target);
    if (slotBinding) {
      e.target.data = { ...(e.target.data || {}), manualCrop: true };
      ensureSlotImageCoverage(slotBinding.state, slotBinding.slot, e.target);
      _propagateCropToSyncedSlots(e.target, slotBinding.state, slotBinding.slot);
    }
    pushUndo();
    scheduleAutosave();
  });
  canvas.on("object:added",      () => refreshLayersPanel());
  canvas.on("object:removed",    () => refreshLayersPanel());

  // ── Per-slot guides drawn on a separate overlay canvas ────────
  canvas.on("after:render", _drawSlotCenterGuides);

  // ── Smart snap + distance lines while dragging a photo ────────
  canvas.on("object:moving",  _onObjectMoving);
  canvas.on("object:modified", () => { _smartGuides = []; _isDraggingPhoto = false; canvas.renderAll(); });
  canvas.on("mouse:up",        () => { _smartGuides = []; _isDraggingPhoto = false; canvas.renderAll(); });

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
}

// ─────────────────────────────────────────────────────────────────
// LOAD ARTBOARD FROM SAVED JSON
// ─────────────────────────────────────────────────────────────────
function loadArtboardFromJSON(state, savedJSON) {
  // The saved JSON was captured at a specific display scale/offset.
  // If the layout changed (e.g. a new frame with different aspect ratio was added),
  // remap every object's position and scale from the saved layout to the current one.
  const savedScale = savedJSON.display_scale || state.scale;
  const savedOx    = savedJSON.display_ox    ?? state.ox;
  const savedOy    = savedJSON.display_oy    ?? state.oy;

  // Remap factor: how much the display scale changed relative to saved state
  const scaleFactor = state.scale / savedScale;
  const needsRemap  = Math.abs(scaleFactor - 1) > 0.001
                   || Math.abs(state.ox - savedOx)   > 0.5
                   || Math.abs(state.oy - savedOy)   > 0.5;

  function remapObj(obj) {
    if (!needsRemap) return;
    const d = obj.data || {};
    if (d.type === "artboard-bg" || d.type === "frame-overlay") return;
    // Convert saved canvas position → native coords → current canvas position
    const nativeX = (obj.left - savedOx) / savedScale;
    const nativeY = (obj.top  - savedOy) / savedScale;
    obj.set({
      left:   state.ox + nativeX * state.scale,
      top:    state.oy + nativeY * state.scale,
      scaleX: (obj.scaleX || 1) * scaleFactor,
      scaleY: (obj.scaleY || 1) * scaleFactor,
    });
    if (obj.fontSize) obj.set({ fontSize: Math.round(obj.fontSize * scaleFactor) });
    obj.setCoords();
  }

  const objs = savedJSON.objects || [];
  fabric.util.enlivenObjects(objs, loaded => {
    loaded.forEach(obj => {
      const d = obj.data || {};
      // Frame overlays are NEVER restored from saved JSON — always reload fresh from server
      if (d.type === "frame-overlay") return;
      remapObj(obj);
      canvas.add(obj);
      if (d.type === "slot-image" && d.frameId === state.frameId) {
        state.slotImages[d.slotIndex] = obj;
        const slot = state.config.slots.find(s => s.index === d.slotIndex);
        normalizeSlotImageObject(state, slot, obj);
      }
      // Re-apply lock state for any object that carries a locked flag
      if (typeof d.locked === "boolean") applyLayerLock(obj);
    });
    addAutoTextToArtboard(state);  // add any missing auto-text fields (also locks them)
    canvas.renderAll();
  });

  // Always reload frame overlay fresh from the server URL (never from DB)
  if (state.config.overlay_url) {
    loadFrameOverlay(state, state.config.overlay_url);
  }

  // Re-create placeholders for any slot that has no image
  state.config.slots.forEach(slot => {
    if (!state.slotImages[slot.index]) {
      restorePlaceholderForSlot(state, slot.index);
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
// Sync groups — each group is an array of { frame_type, slotIndex } members.
// When a photo is loaded into any slot in a group, it mirrors to all other
// members of the same group within the same darshan_type.
//
//  3in1_R slot numbering: 0=big right (Slot 1), 1=top-left (Slot 2), 2=bottom-left (Slot 3)
//  3in1_L slot numbering: 0=big left  (Slot 1), 1=top-right (Slot 2), 2=bottom-right (Slot 3)
//
//  Group 0 — tall portrait   : full/0  ↔  3in1_l/0  ↔  3in1_r/0
//  Group 1 — top small pair  : 3in1_l/1  ↔  3in1_r/1
//  Group 2 — bottom small pair: 3in1_l/2  ↔  3in1_r/2
// ─────────────────────────────────────────────────────────────────
const SYNC_GROUPS = [
  // Tall portrait (full frame + tall slot in 3-in-1 L + R)
  [
    { frame_type: "full",   slotIndex: 0 },
    { frame_type: "3in1_l", slotIndex: 0 },
    { frame_type: "3in1_r", slotIndex: 0 },
  ],
  // Top small — 3in1_L top-right  ↔  3in1_R top-left
  [
    { frame_type: "3in1_l", slotIndex: 1 },
    { frame_type: "3in1_r", slotIndex: 1 },
  ],
  // Bottom small — 3in1_L bottom-right  ↔  3in1_R bottom-left
  [
    { frame_type: "3in1_l", slotIndex: 2 },
    { frame_type: "3in1_r", slotIndex: 2 },
  ],
];

function getSyncTargets(sourceFrameId, sourceSlotIndex) {
  const src = ArtboardMap[sourceFrameId];
  if (!src) return [];

  // Find which group this slot belongs to
  const group = SYNC_GROUPS.find(g =>
    g.some(m => m.frame_type === src.config.frame_type && m.slotIndex === sourceSlotIndex)
  );
  if (!group) return [];

  // Return all other artboards in the same darshan that match another member of this group
  const targets = [];
  for (const state of Object.values(ArtboardMap)) {
    if (state.frameId === sourceFrameId) continue;
    if (state.config.darshan_type !== src.config.darshan_type) continue;
    const member = group.find(
      m => m.frame_type === state.config.frame_type &&
           state.config.slots.some(s => s.index === m.slotIndex)
    );
    if (member) targets.push({ frameId: state.frameId, slotIndex: member.slotIndex });
  }
  return targets;
}

// ─────────────────────────────────────────────────────────────────
// LOAD PHOTO INTO SLOT
// ─────────────────────────────────────────────────────────────────
function loadPhotoIntoSlot(frameId, slotIndex, imageUrl, photoId, fileName, _isSyncCall = false, _onDone = null) {
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
      lockUniScaling: true,
      data: { type: "slot-image", frameId, slotIndex, photoId, fileName: fileName || "", manualCrop: false },
    });

    normalizeSlotImageObject(state, slot, img);

    // Remove previous image for this slot
    if (state.slotImages[slotIndex]) canvas.remove(state.slotImages[slotIndex]);
    removePlaceholdersForSlot(state, slotIndex);

    canvas.add(img);
    bringOverlayToFront(state);
    state.slotImages[slotIndex] = img;

    applyFiltersToSlot(frameId, slotIndex);
    canvas.setActiveObject(img);
    canvas.renderAll();
    refreshLayersPanel();
    updateSlotPanelThumb(frameId, slotIndex, imageUrl);

    if (_isSyncCall) {
      // Sync call — signal completion so primary can push one shared undo
      _onDone?.();
      return;
    }

    // Primary call — wait for all synced frames to finish loading before pushing undo
    const targets = getSyncTargets(frameId, slotIndex);
    if (targets.length === 0) {
      pushUndo();
      scheduleAutosave();
    } else {
      let remaining = targets.length;
      const onSyncDone = () => {
        remaining--;
        if (remaining === 0) { pushUndo(); scheduleAutosave(); }
      };
      targets.forEach(t => {
        loadPhotoIntoSlot(t.frameId, t.slotIndex, imageUrl, photoId, fileName, true, onSyncDone);
      });
    }

    const syncCount = targets.length;
    notify(
      syncCount > 0
        ? `Photo synced to ${syncCount + 1} frames (${state.config.short_name} + ${syncCount} others)`
        : `Photo loaded into ${state.config.short_name} Slot ${slotIndex + 1}`,
      "success"
    );
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

// Proportional-scale action handler for ml / mr controls.
// Delegates to Fabric's built-in scalingX (which handles left vs right via
// transform.originX) then forces scaleY to maintain the original aspect ratio —
// exactly like Photoshop's proportional resize from a side handle.
function _proportionalScaleX(eventData, transform, x, y) {
  const target  = transform.target;
  const cu      = fabric.controlsUtils;
  if (!cu || !cu.scalingX) return false;   // safety: Fabric utils not available

  // Delegate horizontal scale computation to Fabric's built-in handler
  const changed = cu.scalingX(eventData, transform, x, y);

  if (changed) {
    // Restore the original aspect ratio using the scale values captured at
    // drag-start (transform.original is set once when the drag begins).
    const origScaleX = transform.original.scaleX || 1;
    const origScaleY = transform.original.scaleY || 1;
    if (!target.lockScalingY) {
      target.set("scaleY", target.scaleX * (origScaleY / origScaleX));
    }
  }
  return changed;
}

// Render callback for the side resize handle — green circle with ↔ arrows.
// Distinct from the blue rotate handle so the user knows which is which.
function _drawResizeHandle(ctx, left, top) {
  const r = 7;
  ctx.save();
  ctx.translate(left, top);
  // Background circle
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "#2E7D32";   // dark-green
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // ↔ left arrow
  ctx.beginPath();
  ctx.moveTo(-1, 0); ctx.lineTo(-4, 0);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-4, -2); ctx.lineTo(-6, 0); ctx.lineTo(-4, 2);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke();
  // ↔ right arrow
  ctx.beginPath();
  ctx.moveTo(1, 0); ctx.lineTo(4, 0);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, -2); ctx.lineTo(6, 0); ctx.lineTo(4, 2);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}

// Render callback for the custom rotation handle (blue circle with arrow).
// Called by Fabric for each control render pass.
function _drawRotateHandle(ctx, left, top) {
  const r = 7;
  ctx.save();
  ctx.translate(left, top);
  // Circle background
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1976D2";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Rotation arc arrow
  ctx.beginPath();
  ctx.arc(0, 0, 3.8, -Math.PI * 0.75, Math.PI * 0.55);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Arrowhead at arc end
  const angle = Math.PI * 0.55;
  const cx = Math.cos(angle) * 3.8, cy = Math.sin(angle) * 3.8;
  const tx = -Math.sin(angle), ty = Math.cos(angle);  // tangent at arc end
  ctx.beginPath();
  ctx.moveTo(cx + tx * 2.2 - ty * 1.1, cy + ty * 2.2 + tx * 1.1);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx - tx * 2.2 - ty * 1.1, cy - ty * 2.2 + tx * 1.1);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function normalizeSlotImageObject(state, slot, img) {
  if (!state || !slot || !img) return;
  img.set({
    clipPath:       makeSlotClip(state, slot),
    dirty:          true,
    lockUniScaling: true,   // proportional scaling only — no stretching
  });

  // Set up per-instance controls once per img instance.
  // MUST happen before setControlsVisibility, otherwise the replacement
  // img.controls = Object.assign(...) would undo the visibility settings.
  if (!img._cornerRotationSet) {
    img._cornerRotationSet = true;
    // Shallow-copy prototype controls so changes only affect this instance
    img.controls = Object.assign({}, fabric.Object.prototype.controls);

    const mtrBase = fabric.Object.prototype.controls.mtr;
    if (mtrBase) {
      // ── Rotate handles ───────────────────────────────────────────
      // Top-right corner rotate handle (original)
      img.controls.mtr = new fabric.Control({
        x:              0.5,
        y:             -0.5,
        offsetX:        12,
        offsetY:       -12,
        cursorStyle:   "crosshair",
        actionHandler:  mtrBase.actionHandler,
        actionName:    "rotate",
        render:         _drawRotateHandle,
        cornerSize:     18,
        withConnection: false,
      });
      // Middle-left rotate handle — sits 16 px OUTSIDE the left edge
      img.controls.mtrLeft = new fabric.Control({
        x:             -0.5,
        y:              0,
        offsetX:       -16,
        offsetY:         0,
        cursorStyle:   "crosshair",
        actionHandler:  mtrBase.actionHandler,
        actionName:    "rotate",
        render:         _drawRotateHandle,
        cornerSize:     18,
        withConnection: false,
      });
      // Middle-right rotate handle — sits 16 px OUTSIDE the right edge
      img.controls.mtrRight = new fabric.Control({
        x:              0.5,
        y:              0,
        offsetX:        16,
        offsetY:         0,
        cursorStyle:   "crosshair",
        actionHandler:  mtrBase.actionHandler,
        actionName:    "rotate",
        render:         _drawRotateHandle,
        cornerSize:     18,
        withConnection: false,
      });
    }

    // ── Proportional-resize handles on left / right edges ────────
    // These replace the default ml/mr (which stretch only X).
    // _proportionalScaleX scales both axes together = no stretch.
    img.controls.ml = new fabric.Control({
      x:             -0.5,
      y:              0,
      offsetX:        0,
      offsetY:        0,
      cursorStyle:   "ew-resize",
      actionHandler:  _proportionalScaleX,
      actionName:    "scale",
      render:         _drawResizeHandle,
      cornerSize:     18,
      withConnection: false,
    });
    img.controls.mr = new fabric.Control({
      x:              0.5,
      y:              0,
      offsetX:        0,
      offsetY:        0,
      cursorStyle:   "ew-resize",
      actionHandler:  _proportionalScaleX,
      actionName:    "scale",
      render:         _drawResizeHandle,
      cornerSize:     18,
      withConnection: false,
    });
  }

  // Hide only top/bottom edge handles — left/right are now our custom resize icons.
  // Called AFTER controls setup so flags apply to the per-instance map.
  img.setControlsVisibility({ mt: false, mb: false });

  ensureSlotImageCoverage(state, slot, img);
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

// Propagate pan/zoom crop from one slot-image to all synced counterparts.
// Uses slot-relative coordinates so the crop maps correctly across different slot sizes.
function _propagateCropToSyncedSlots(srcImg, srcState, srcSlot) {
  const { frameId, slotIndex } = srcImg.data || {};
  const targets = getSyncTargets(frameId, slotIndex);
  if (!targets.length) return;

  // Source slot dimensions in display-pixels
  const srcSlotW = srcSlot.w * srcState.scale;
  const srcSlotH = srcSlot.h * srcState.scale;
  const srcSlotCX = srcState.ox + srcSlot.x * srcState.scale + srcSlotW / 2;
  const srcSlotCY = srcState.oy + srcSlot.y * srcState.scale + srcSlotH / 2;

  // Natural image dimensions
  const { w: natW, h: natH } = imgNaturalDims(srcImg);

  // Min scale the source image needs to cover its slot
  const srcMinScale = getRequiredSlotImageScale(srcSlotW, srcSlotH, natW, natH);

  // How much extra zoom the user applied beyond the minimum
  const extraScaleRatio = srcImg.scaleX / srcMinScale;

  // Pan offset from slot center, normalised to slot size (–1..1 range = half-slot)
  const relPanX = (srcImg.left - srcSlotCX) / srcSlotW;
  const relPanY = (srcImg.top  - srcSlotCY) / srcSlotH;

  targets.forEach(t => {
    const tState = ArtboardMap[t.frameId];
    if (!tState) return;
    const tSlot = tState.config.slots.find(s => s.index === t.slotIndex);
    if (!tSlot) return;
    const tImg = tState.slotImages[t.slotIndex];
    if (!tImg) return;

    const tSlotW = tSlot.w * tState.scale;
    const tSlotH = tSlot.h * tState.scale;
    const tSlotCX = tState.ox + tSlot.x * tState.scale + tSlotW / 2;
    const tSlotCY = tState.oy + tSlot.y * tState.scale + tSlotH / 2;

    const { w: tNatW, h: tNatH } = imgNaturalDims(tImg);
    const tMinScale = getRequiredSlotImageScale(tSlotW, tSlotH, tNatW, tNatH);
    const tNewScale = tMinScale * extraScaleRatio;

    tImg.set({
      scaleX: Math.max(tNewScale, tMinScale),
      scaleY: Math.max(tNewScale, tMinScale),
      left:   tSlotCX + relPanX * tSlotW,
      top:    tSlotCY + relPanY * tSlotH,
      angle:  srcImg.angle,
      flipX:  srcImg.flipX,
      flipY:  srcImg.flipY,
    });
    tImg.data = { ...(tImg.data || {}), manualCrop: true };
    ensureSlotImageCoverage(tState, tSlot, tImg);
    tImg.setCoords();
  });

  canvas.renderAll();
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

let filterPreviewTimer = null;
const pendingFilterPreviews = new Map();

function slotFilterPreviewKey(frameId, slotIndex) {
  return `${frameId}:${slotIndex}`;
}

function queueSlotFilterPreview(frameId, slotIndex) {
  pendingFilterPreviews.set(slotFilterPreviewKey(frameId, slotIndex), { frameId, slotIndex });
  if (filterPreviewTimer) return;
  filterPreviewTimer = setTimeout(() => {
    filterPreviewTimer = null;
    const jobs = [...pendingFilterPreviews.values()];
    pendingFilterPreviews.clear();
    jobs.forEach(({ frameId: fid, slotIndex: sid }) => applyFiltersToSlot(fid, sid));
  }, FILTER_PREVIEW_DELAY);
}

function flushSlotFilterPreview(frameId, slotIndex) {
  pendingFilterPreviews.delete(slotFilterPreviewKey(frameId, slotIndex));
  applyFiltersToSlot(frameId, slotIndex);
}

function slotFilterSignature(f) {
  return [
    f.brightness, f.contrast, f.saturation, f.hue,
    f.blur, f.noise,
    f.gamma_r, f.gamma_g, f.gamma_b,
    f.grayscale, f.sepia, f.invert,
    f.vintage, f.sharpen, f.polaroid, f.kodachrome,
  ].join("|");
}

function applyFiltersToSlot(frameId, slotIndex) {
  const state = ArtboardMap[frameId];
  const img   = state?.slotImages[slotIndex];
  const f     = state?.slotFilters[slotIndex];
  const slot  = state?.config.slots.find(s => s.index === slotIndex);
  if (!img || !f || !slot) return;

  const snap = {
    left: img.left,
    top: img.top,
    originX: img.originX,
    originY: img.originY,
    scaleX: img.scaleX,
    scaleY: img.scaleY,
    angle: img.angle,
    flipX: img.flipX,
    flipY: img.flipY,
    skewX: img.skewX,
    skewY: img.skewY,
    cropX: img.cropX || 0,
    cropY: img.cropY || 0,
  };

  const signature = slotFilterSignature(f);
  if (img._slotFilterSignature !== signature) {
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
    img.applyFilters();
    img._slotFilterSignature = signature;
  }
  img.set({
    ...snap,
    opacity: f.opacity,
    globalCompositeOperation: f.blendMode || "source-over",
  });
  normalizeSlotImageObject(state, slot, img);
  canvas.requestRenderAll();
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
  _renderGuidePanel();
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
    const thumb  = state.slotImages[slot.index]?._originalElement?.src
                || state.slotImages[slot.index]?._element?.src
                || "";

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
  _renderGuidePanel();
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

function clearSlot(frameId, slotIndex, _isSyncCall = false) {
  const state = ArtboardMap[frameId];
  if (!state) return;
  const img = state.slotImages[slotIndex];
  if (img) { canvas.remove(img); delete state.slotImages[slotIndex]; }
  state.slotFilters[slotIndex] = defaultFilters();
  restorePlaceholderForSlot(state, slotIndex);
  renderSlotsPanel(frameId);

  if (!_isSyncCall) {
    // Also clear all synced slots atomically
    getSyncTargets(frameId, slotIndex).forEach(t => clearSlot(t.frameId, t.slotIndex, true));
    pushUndo();
    scheduleAutosave();
    refreshLayersPanel();
  }
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

  _syncLayerHighlight(obj);

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
  _syncLayerHighlight(null);
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
  updateScrollbars();
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
// Apply or remove interactive lock on a Fabric object based on data.locked.
// Only acts on objects that explicitly carry a boolean locked flag.
function applyLayerLock(obj) {
  if (!obj || obj.data?.locked === undefined) return;
  const locked   = !!obj.data.locked;
  const isText   = obj.data?.type === "text-overlay";
  obj.set({
    selectable:  !locked,
    // Text overlays stay evented:true even when locked so clicks on them don't
    // fall through to photos underneath. Other objects (photos) use evented:false
    // when locked so they are fully invisible to canvas interaction.
    evented:     isText ? true : !locked,
    hoverCursor: locked ? "not-allowed" : null,
  });
  if (locked && canvas.getActiveObject() === obj) canvas.discardActiveObject();
  // When a text layer is unlocked, ensure it's on top so it's hit-testable before photos
  if (!locked && isText) canvas.bringToFront(obj);
}

function toggleLayerLock(obj) {
  if (!obj || !obj.data) return;
  obj.data.locked = !obj.data.locked;
  applyLayerLock(obj);
  canvas.renderAll();
  refreshLayersPanel();
  pushUndo();
  scheduleAutosave();
}

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

  const activeObj = canvas.getActiveObject();
  [...objs].reverse().forEach(obj => {
    const d         = obj.data || {};
    const isSystem  = d.type === "frame-overlay" || d.type === "slot-placeholder";
    const isLocked  = !!d.locked;
    const canSelect = !isLocked && !isSystem;
    const canLock   = !isSystem; // frame-overlay and placeholders are always non-interactive

    const item = document.createElement("div");
    item._fabricObj = obj;
    item.className = "layer-item"
      + (obj === activeObj && canSelect ? " layer-item--active" : "")
      + (isLocked ? " layer-item--locked" : "");

    const icon = d.type === "slot-image"       ? "📷"
               : d.type === "text-overlay"     ? "T"
               : d.type === "frame-overlay"    ? "🖼"
               : d.type === "slot-placeholder" ? "⬜"
               : "◻";
    const name = d.type === "slot-image"    ? `Photo – Slot ${(d.slotIndex ?? 0) + 1}`
               : d.type === "text-overlay"  ? (obj.text || "Text").slice(0, 22)
               : d.type === "frame-overlay" ? "Frame Overlay"
               : "Object";

    const lockBtn = canLock
      ? `<button class="layer-lock-btn${isLocked ? " locked" : ""}" title="${isLocked ? "Unlock layer" : "Lock layer"}">${isLocked ? "🔒" : "🔓"}</button>`
      : "";
    item.innerHTML = `<span class="layer-icon">${icon}</span><span class="layer-name">${name}</span>${lockBtn}`;

    if (canSelect) {
      item.addEventListener("click", e => {
        if (e.target.closest(".layer-lock-btn")) return; // handled below
        canvas.setActiveObject(obj);
        canvas.renderAll();
        _syncLayerHighlight(obj);
      });
    } else if (isLocked) {
      item.addEventListener("click", e => {
        if (e.target.closest(".layer-lock-btn")) return;
        notify("Layer is locked — click 🔒 to unlock", "info");
      });
    }

    if (canLock) {
      item.querySelector(".layer-lock-btn").addEventListener("click", e => {
        e.stopPropagation();
        toggleLayerLock(obj);
      });
    }

    list.appendChild(item);
  });
}

function _syncLayerHighlight(activeObj) {
  const target = activeObj ?? canvas.getActiveObject();
  document.querySelectorAll("#layersList .layer-item").forEach(item => {
    item.classList.toggle("layer-item--active", item._fabricObj === target);
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

// Copy slotFilters from source slot to all synced slots and re-apply.
function _propagateFiltersToSyncedSlots(frameId, slotIndex) {
  const srcFilters = ArtboardMap[frameId]?.slotFilters[slotIndex];
  if (!srcFilters) return;
  const targets = getSyncTargets(frameId, slotIndex);
  targets.forEach(t => {
    const tState = ArtboardMap[t.frameId];
    if (!tState) return;
    tState.slotFilters[t.slotIndex] = { ...srcFilters };
    flushSlotFilterPreview(t.frameId, t.slotIndex);
  });
}

function bindColorControls() {
  const commitFilterChange = (frameId, slotIndex) => {
    flushSlotFilterPreview(frameId, slotIndex);
    _propagateFiltersToSyncedSlots(frameId, slotIndex);
    pushUndo();
    scheduleAutosave();
  };

  function mkSlider(id, vid, toDisplay, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    const sync = commit => {
      const obj = canvas.getActiveObject();
      if (!obj?.data) return;
      const { frameId, slotIndex } = obj.data;
      if (frameId == null || slotIndex == null) return;
      const f   = ArtboardMap[frameId]?.slotFilters[slotIndex];
      if (!f) return;
      const val = parseFloat(el.value);
      setter(f, val);
      document.getElementById(vid).textContent = toDisplay(val);
      if (commit) commitFilterChange(frameId, slotIndex);
      else queueSlotFilterPreview(frameId, slotIndex);
    };
    el.addEventListener("input",  () => sync(false));
    el.addEventListener("change", () => sync(true));
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
      commitFilterChange(frameId, slotIndex);
    });
  });

  document.getElementById("btnAutoColor")?.addEventListener("click", async () => {
    const obj = canvas.getActiveObject();
    if (!obj?.data?.photoId) { notify("Select a slot photo first", "info"); return; }
    notify("Analysing image…", "info");
    const r = await apiFetch(`/api/auto-color/${obj.data.photoId}/`);
    if (r.success) {
      const { frameId, slotIndex } = obj.data;
      const p = r.filter_params;

      // Build target list: active slot + any synced slots
      const syncTargets = getSyncTargets(frameId, slotIndex);
      const allTargets = [
        { fid: frameId, sid: slotIndex },
        ...syncTargets.map(t => ({ fid: t.frameId, sid: t.slotIndex })),
      ];

      allTargets.forEach(({ fid, sid }) => {
        const state = ArtboardMap[fid];
        if (!state) return;
        const existing = state.slotFilters[sid] ?? defaultFilters();
        // Merge computed params; preserve opacity and blend mode the user may have set
        state.slotFilters[sid] = {
          ...existing,
          brightness: p.brightness,
          contrast:   p.contrast,
          saturation: p.saturation,
          gamma_r:    p.gamma_r,
          gamma_g:    p.gamma_g,
          gamma_b:    p.gamma_b,
          sharpen:    p.sharpen,
          hue:        p.hue,
          blur:       p.blur,
          noise:      p.noise,
          grayscale:  p.grayscale,
          sepia:      p.sepia,
          invert:     p.invert,
          vintage:    p.vintage,
          polaroid:   p.polaroid,
          kodachrome: p.kodachrome,
        };
        flushSlotFilterPreview(fid, sid);
      });

      // Sync sliders to reflect what was applied on the active slot
      syncColorPanel(frameId, slotIndex);
      pushUndo();
      scheduleAutosave();

      const n = allTargets.length;
      notify(
        n > 1
          ? `Auto color applied to ${n} slots — sliders updated ✓`
          : "Auto color applied — adjust sliders to fine-tune ✓",
        "success"
      );
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
    commitFilterChange(frameId, slotIndex); // already calls _propagateFiltersToSyncedSlots
  });
}

function bindBlendControls() {
  const commitBlendChange = (frameId, slotIndex) => {
    flushSlotFilterPreview(frameId, slotIndex);
    _propagateFiltersToSyncedSlots(frameId, slotIndex);
    pushUndo();
    scheduleAutosave();
  };
  const opacityEl = document.getElementById("fOpacity");
  const onOpacity = commit => {
    const obj = canvas.getActiveObject();
    if (!obj?.data) return;
    const { frameId, slotIndex } = obj.data;
    const f = ArtboardMap[frameId]?.slotFilters[slotIndex]; if (!f) return;
    f.opacity = parseFloat(opacityEl.value) / 100;
    document.getElementById("fOpacity_val").textContent = Math.round(f.opacity * 100) + "%";
    if (commit) commitBlendChange(frameId, slotIndex);
    else queueSlotFilterPreview(frameId, slotIndex);
  };
  opacityEl?.addEventListener("input", () => onOpacity(false));
  opacityEl?.addEventListener("change", () => onOpacity(true));
  document.getElementById("fBlendMode")?.addEventListener("change", () => {
    const obj = canvas.getActiveObject();
    if (!obj?.data) return;
    const { frameId, slotIndex } = obj.data;
    const f = ArtboardMap[frameId]?.slotFilters[slotIndex]; if (!f) return;
    f.blendMode = document.getElementById("fBlendMode").value;
    commitBlendChange(frameId, slotIndex);
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
      _propagateCropToSyncedSlots(obj, slotBinding.state, slotBinding.slot);
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
  const fontFamily = defaults.fontFamily;
  ensureFontLoaded(fontFamily, () => {
    const itext = new fabric.IText(text, { ...defaults, ...overrides });
    canvas.add(itext);
    bringOverlayToFront(state);
    canvas.setActiveObject(itext);
    canvas.renderAll();
    pushUndo(); scheduleAutosave();
  });
}

// ─────────────────────────────────────────────────────────────────
// COLOR SLIDER KEYBOARD CONTROL
// ─────────────────────────────────────────────────────────────────
function bindSliderKeyboard() {
  const SLIDERS = [
    "fBrightness","fContrast","fSaturation","fHue",
    "fBlur","fNoise","fGammaR","fGammaG","fGammaB","fOpacity",
  ];

  SLIDERS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("keydown", e => {
      const isUp   = e.key === "ArrowUp"   || e.key === "ArrowRight";
      const isDown = e.key === "ArrowDown" || e.key === "ArrowLeft";
      if (!isUp && !isDown) return;

      // Prevent canvas nudge / page scroll
      e.preventDefault();
      e.stopPropagation();

      const step = e.shiftKey ? 5 : 1;
      const min  = parseFloat(el.min);
      const max  = parseFloat(el.max);
      const next = Math.max(min, Math.min(max, parseFloat(el.value) + (isUp ? step : -step)));
      el.value   = next;

      // Fire both events: input → live preview, change → commit + push undo
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Double-click resets slider to its default (zero / 100 for gamma)
    el.addEventListener("dblclick", () => {
      const def = (id.startsWith("fGamma") || id === "fOpacity") ? "100" : "0";
      el.value  = def;
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

function bindTextControls() {
  document.getElementById("btnAddText")?.addEventListener("click", () => {
    const txt = prompt("Enter text:", "Jay Swaminarayan 🙏");
    if (txt?.trim()) addText(txt);
  });
  document.getElementById("btnAddDate")?.addEventListener("click", () => {
    addText(sessionDateDisplay(), { fontSize: 48 });
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

  // Live font preview bar
  const _fontPreviewBar = document.getElementById("fontPreviewBar");
  const _fontSel = document.getElementById("txtFont");
  function updateFontPreview() {
    if (!_fontPreviewBar || !_fontSel) return;
    const f = _fontSel.value;
    _fontPreviewBar.style.fontFamily = `"${f}", serif`;
    _fontPreviewBar.title = f;
  }
  _fontSel?.addEventListener("change", updateFontPreview);
  updateFontPreview(); // set on load

  const textProps = {
    txtFont:        (o,v) => { o.set("fontFamily", v); ensureFontLoaded(v, () => canvas.renderAll()); },
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

// ═════════════════════════════════════════════════════════════════
// SLOT GUIDES  –  multi-guide · draggable · rule-of-thirds · snap
//   • Drawn on a separate overlay <canvas> (never touches Fabric's
//     upper canvas so selection handles stay intact).
//   • Drag any guide to reposition; double-click to reset to centre;
//     right-click for context menu (delete / mirror / duplicate).
//   • Rule-of-thirds toggle (Shift+R), guides toggle (G), snap (S).
//   • Photo-centre crosshair + live distance labels while dragging.
// ═════════════════════════════════════════════════════════════════

// ── colours ────────────────────────────────────────────────────
const GUIDE_IDLE_C      = "rgba(0, 200, 255, 0.65)";
const GUIDE_ACTIVE_C    = "#00e5ff";
const GUIDE_THIRDS_C    = "rgba(255, 210, 60, 0.50)";
const GUIDE_SNAP_C      = "#e040fb";
const GUIDE_SNAP_EDGE_C = "#ff1744";
const GUIDE_DIST_C      = "rgba(255, 160, 30, 0.90)";
const SNAP_THRESH       = 8;
const GUIDE_HIT_THRESH  = 7;

// ── per-slot guide list ─────────────────────────────────────────
// _slotGuides["frameId:slotIndex"] = [{ id, axis:"v"|"h", frac }]
const _slotGuides = {};
let _guidesVisible   = true;
let _thirdsVisible   = false;
let _snapEnabled     = true;
let _draggingGuide   = null;   // { state, slot, guide }
let _smartGuides     = [];
let _isDraggingPhoto = false;
let _guideSeq        = 0;

function _newGid()              { return `g${++_guideSeq}`; }
function _guideKey(fId, sIdx)   { return `${fId}:${sIdx}`; }

function _getGuides(frameId, slotIndex) {
  const k = _guideKey(frameId, slotIndex);
  if (!_slotGuides[k]) {
    _slotGuides[k] = [
      { id: _newGid(), axis: "v", frac: 0.5 },
      { id: _newGid(), axis: "h", frac: 0.5 },
    ];
  }
  return _slotGuides[k];
}

function _addGuide(frameId, slotIndex, axis, frac) {
  if (frac === undefined) frac = 0.5;
  _getGuides(frameId, slotIndex).push({ id: _newGid(), axis, frac });
  _renderGuidePanel();
  canvas.renderAll();
}

function _deleteGuide(frameId, slotIndex, gid) {
  const k = _guideKey(frameId, slotIndex);
  if (_slotGuides[k]) _slotGuides[k] = _slotGuides[k].filter(function(g){ return g.id !== gid; });
  _renderGuidePanel();
  canvas.renderAll();
}

// native-px <-> fraction helpers
function _fracToPx(frac, dim)   { return Math.round(frac * dim); }
function _pxToFrac(px, dim)     { return Math.max(0.005, Math.min(0.995, px / dim)); }

// ── slot world -> screen ────────────────────────────────────────
function _slotScreenRect(state, slot) {
  const vpt  = canvas.viewportTransform;
  const zoom = vpt[0], tx = vpt[4], ty = vpt[5];
  const s = state.scale;
  const L = (state.ox + slot.x * s) * zoom + tx;
  const T = (state.oy + slot.y * s) * zoom + ty;
  const R = L + slot.w * s * zoom;
  const B = T + slot.h * s * zoom;
  return { L: L, T: T, R: R, B: B };
}

// ── hit-test all guides ─────────────────────────────────────────
function _hitTestGuide(sx, sy) {
  if (!_guidesVisible) return null;
  var states = Object.values(ArtboardMap);
  for (var si = 0; si < states.length; si++) {
    var state = states[si];
    var slots = state.config.slots || [];
    for (var qi = 0; qi < slots.length; qi++) {
      var slot = slots[qi];
      if (!state.slotImages[slot.index]) continue;
      var r = _slotScreenRect(state, slot);
      if (sx < r.L - GUIDE_HIT_THRESH || sx > r.R + GUIDE_HIT_THRESH) continue;
      if (sy < r.T - GUIDE_HIT_THRESH || sy > r.B + GUIDE_HIT_THRESH) continue;
      var guides = _getGuides(state.frameId, slot.index);
      for (var gi = guides.length - 1; gi >= 0; gi--) {
        var g  = guides[gi];
        var gp = g.axis === "v" ? r.L + (r.R - r.L) * g.frac : r.T + (r.B - r.T) * g.frac;
        var inBand = g.axis === "v"
          ? (Math.abs(sx - gp) <= GUIDE_HIT_THRESH && sy >= r.T - 2 && sy <= r.B + 2)
          : (Math.abs(sy - gp) <= GUIDE_HIT_THRESH && sx >= r.L - 2 && sx <= r.R + 2);
        if (inBand) return { state: state, slot: slot, guide: g };
      }
    }
  }
  return null;
}

// ── overlay canvas ──────────────────────────────────────────────
var _guideOvCanvas = null;

function _ensureGuideOverlay() {
  if (_guideOvCanvas && _guideOvCanvas.parentNode) return _guideOvCanvas;
  var area = document.getElementById("canvasArea");
  if (!area) return null;
  var ov = document.createElement("canvas");
  ov.id = "guideOverlayCanvas";
  ov.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:8";
  area.style.position = "relative";
  area.appendChild(ov);
  _guideOvCanvas = ov;
  _sizeGuideOverlay();
  if (window.ResizeObserver) {
    new ResizeObserver(_sizeGuideOverlay).observe(area);
  }
  return ov;
}
function _sizeGuideOverlay() {
  var ov = _guideOvCanvas;
  var lc = canvas && canvas.lowerCanvasEl;
  if (!ov || !lc) return;
  var w = lc.offsetWidth  || lc.clientWidth  || 800;
  var h = lc.offsetHeight || lc.clientHeight || 600;
  ov.style.width  = w + "px";
  ov.style.height = h + "px";
  ov.width  = w;
  ov.height = h;
}

// ── label pill ─────────────────────────────────────────────────
function _pill(ctx, x, y, text, col) {
  ctx.save();
  ctx.font = "bold 10px system-ui,sans-serif";
  var tw = ctx.measureText(text).width;
  var pw = tw + 8, ph = 15;
  var bx = Math.max(2, x - pw / 2);
  var by = Math.max(2, y - ph - 4);
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(bx, by, pw, ph);
  ctx.fillStyle = col || "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + 4, by + ph / 2);
  ctx.restore();
}

// ── main draw ──────────────────────────────────────────────────
function _drawSlotCenterGuides() {
  var ov = _ensureGuideOverlay();
  if (!ov) return;
  var ctx = ov.getContext("2d");
  ctx.clearRect(0, 0, ov.width, ov.height);
  if (!_guidesVisible) return;

  var vpt  = canvas.viewportTransform;
  var zoom = vpt[0], tx = vpt[4], ty = vpt[5];

  Object.values(ArtboardMap).forEach(function(state) {
    (state.config.slots || []).forEach(function(slot) {
      if (!state.slotImages[slot.index]) return;
      var r = _slotScreenRect(state, slot);
      var sW = r.R - r.L, sH = r.B - r.T;

      // rule-of-thirds
      if (_thirdsVisible) {
        ctx.save();
        ctx.strokeStyle = GUIDE_THIRDS_C;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        [1/3, 2/3].forEach(function(f) {
          ctx.beginPath(); ctx.moveTo(r.L + sW * f, r.T); ctx.lineTo(r.L + sW * f, r.B); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(r.L, r.T + sH * f); ctx.lineTo(r.R, r.T + sH * f); ctx.stroke();
        });
        ctx.restore();
      }

      // custom guides
      var guides = _getGuides(state.frameId, slot.index);
      guides.forEach(function(g) {
        var active = _draggingGuide && _draggingGuide.guide === g;
        var gp     = g.axis === "v" ? r.L + sW * g.frac : r.T + sH * g.frac;

        ctx.save();
        ctx.strokeStyle = active ? GUIDE_ACTIVE_C : GUIDE_IDLE_C;
        ctx.lineWidth   = active ? 1.5 : 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        if (g.axis === "v") { ctx.moveTo(gp, r.T); ctx.lineTo(gp, r.B); }
        else                { ctx.moveTo(r.L, gp); ctx.lineTo(r.R, gp); }
        ctx.stroke();

        // drag-handle diamond
        ctx.setLineDash([]);
        var hx = g.axis === "v" ? gp : r.L + sW * 0.5;
        var hy = g.axis === "v" ? r.T + sH * 0.5 : gp;
        var hr = active ? 5 : 4;
        ctx.fillStyle = active ? GUIDE_ACTIVE_C : "rgba(0,200,255,0.75)";
        ctx.beginPath();
        ctx.moveTo(hx, hy - hr); ctx.lineTo(hx + hr, hy);
        ctx.lineTo(hx, hy + hr); ctx.lineTo(hx - hr, hy);
        ctx.closePath(); ctx.fill();

        // coord label during drag
        if (active) {
          var dim   = g.axis === "v" ? slot.w : slot.h;
          var px    = _fracToPx(g.frac, dim);
          var pct   = Math.round(g.frac * 100);
          var label = (g.axis === "v" ? "X" : "Y") + ": " + px + "px \u00b7 " + pct + "%";
          if (g.axis === "v") _pill(ctx, gp, r.T + 16, label, GUIDE_ACTIVE_C);
          else                _pill(ctx, r.L + 46, gp, label, GUIDE_ACTIVE_C);
        }
        ctx.restore();
      });

      // photo-centre crosshair on selected image
      var img = state.slotImages[slot.index];
      if (img && canvas.getActiveObject() === img) {
        var cp = img.getCenterPoint();
        var cx = cp.x * zoom + tx;
        var cy = cp.y * zoom + ty;

        if (cx > r.L && cx < r.R && cy > r.T && cy < r.B) {
          ctx.save();
          ctx.strokeStyle = "rgba(255, 70, 70, 0.9)";
          ctx.lineWidth   = 1;
          ctx.setLineDash([3, 3]);
          var A = 10;
          ctx.beginPath(); ctx.moveTo(cx - A, cy); ctx.lineTo(cx + A, cy); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, cy - A); ctx.lineTo(cx, cy + A); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(255,70,70,0.95)";
          ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          // live distance lines to each guide while dragging
          if (_isDraggingPhoto) {
            guides.forEach(function(g) {
              var gp = g.axis === "v" ? r.L + sW * g.frac : r.T + sH * g.frac;
              ctx.save();
              ctx.strokeStyle = GUIDE_DIST_C;
              ctx.lineWidth   = 1;
              ctx.setLineDash([2, 3]);
              ctx.beginPath();
              if (g.axis === "v") { ctx.moveTo(cx, cy); ctx.lineTo(gp, cy); }
              else                { ctx.moveTo(cx, cy); ctx.lineTo(cx, gp); }
              ctx.stroke();
              var screenDist = g.axis === "v" ? Math.abs(cx - gp) : Math.abs(cy - gp);
              var nativeDist = Math.round(screenDist / (state.scale * zoom));
              var lx = g.axis === "v" ? (cx + gp) / 2 : cx + 8;
              var ly = g.axis === "v" ? cy - 9          : (cy + gp) / 2;
              _pill(ctx, lx, ly, nativeDist + "px", GUIDE_DIST_C);
              ctx.restore();
            });
            // absolute photo-centre position within slot
            var relX = Math.round((cx - r.L) / (state.scale * zoom));
            var relY = Math.round((cy - r.T) / (state.scale * zoom));
            _pill(ctx, Math.min(cx + 14, r.R - 35), cy - 22, relX + ", " + relY, "rgba(255,200,80,1)");
          }
        }
      }

      // snap highlights
      _smartGuides.forEach(function(sg) {
        var sr = _slotScreenRect(sg.state, sg.slot);
        ctx.save();
        ctx.strokeStyle = sg.isEdge ? GUIDE_SNAP_EDGE_C : GUIDE_SNAP_C;
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        if (sg.axis === "v") { ctx.moveTo(sg.x, sr.T); ctx.lineTo(sg.x, sr.B); }
        else                  { ctx.moveTo(sr.L, sg.y); ctx.lineTo(sr.R, sg.y); }
        ctx.stroke();
        ctx.restore();
      });
    });
  });
}

// ── guide drag (capture-phase on Fabric upper canvas) ──────────
function initGuideDrag() {
  var el = canvas.upperCanvasEl;

  el.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    var hit = _hitTestGuide(e.offsetX, e.offsetY);
    if (!hit) return;
    e.stopPropagation(); e.preventDefault();
    _draggingGuide = hit;
    el.style.cursor = hit.guide.axis === "v" ? "col-resize" : "row-resize";
    canvas.renderAll();
  }, true);

  window.addEventListener("mousemove", function(e) {
    if (!_draggingGuide) return;
    var rect = el.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;
    var r = _slotScreenRect(_draggingGuide.state, _draggingGuide.slot);
    var g = _draggingGuide.guide;
    if (g.axis === "v") g.frac = Math.max(0.005, Math.min(0.995, (sx - r.L) / (r.R - r.L)));
    else                g.frac = Math.max(0.005, Math.min(0.995, (sy - r.T) / (r.B - r.T)));
    canvas.renderAll();
  });

  window.addEventListener("mouseup", function() {
    if (!_draggingGuide) return;
    _draggingGuide = null;
    el.style.cursor = "";
    _renderGuidePanel();
    canvas.renderAll();
  });

  el.addEventListener("mousemove", function(e) {
    if (_draggingGuide) return;
    var hit = _hitTestGuide(e.offsetX, e.offsetY);
    el.style.cursor = hit ? (hit.guide.axis === "v" ? "col-resize" : "row-resize") : "";
  });

  el.addEventListener("dblclick", function(e) {
    var hit = _hitTestGuide(e.offsetX, e.offsetY);
    if (!hit) return;
    e.stopPropagation();
    hit.guide.frac = 0.5;
    _renderGuidePanel(); canvas.renderAll();
    notify("Guide reset to centre", "info");
  }, true);

  el.addEventListener("contextmenu", function(e) {
    var hit = _hitTestGuide(e.offsetX, e.offsetY);
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    _showGuideCtxMenu(e.clientX, e.clientY, hit);
  }, true);
}

// ── context menu ───────────────────────────────────────────────
function _showGuideCtxMenu(cx, cy, hit) {
  var menu = document.getElementById("guideCtxMenu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "guideCtxMenu";
    document.body.appendChild(menu);
  }
  menu.className = "guide-ctx-menu";
  var dim  = hit.guide.axis === "v" ? hit.slot.w : hit.slot.h;
  var px   = _fracToPx(hit.guide.frac, dim);
  var pct  = Math.round(hit.guide.frac * 100);
  menu.innerHTML =
    '<div class="gcm-title">' + (hit.guide.axis === "v" ? "Vertical" : "Horizontal") + ' Guide \u00b7 ' + px + 'px (' + pct + '%)</div>' +
    '<div class="gcm-item" data-a="center">\u21a9 Reset to centre (50%)</div>' +
    '<div class="gcm-item" data-a="mirror">\u21c4 Mirror to ' + (100 - pct) + '%</div>' +
    '<div class="gcm-item" data-a="dup">+ Duplicate mirrored</div>' +
    '<div class="gcm-item" data-a="third1">\u2192 Move to \u2153 (33%)</div>' +
    '<div class="gcm-item" data-a="third2">\u2192 Move to \u2154 (67%)</div>' +
    '<div class="gcm-sep"></div>' +
    '<div class="gcm-item gcm-del" data-a="del">\u2715 Delete guide</div>';
  menu.style.cssText = "left:" + cx + "px;top:" + cy + "px;display:block";
  requestAnimationFrame(function() {
    var mr = menu.getBoundingClientRect();
    if (mr.right  > window.innerWidth)  menu.style.left = (cx - mr.width)  + "px";
    if (mr.bottom > window.innerHeight) menu.style.top  = (cy - mr.height) + "px";
  });

  menu.onclick = function(e) {
    var a = e.target.dataset.a;
    if (!a) return;
    var state = hit.state, slot = hit.slot, guide = hit.guide;
    if      (a === "center") { guide.frac = 0.5; }
    else if (a === "mirror") { guide.frac = 1 - guide.frac; }
    else if (a === "dup")    { _addGuide(state.frameId, slot.index, guide.axis, 1 - guide.frac); }
    else if (a === "third1") { guide.frac = 1/3; }
    else if (a === "third2") { guide.frac = 2/3; }
    else if (a === "del")    { _deleteGuide(state.frameId, slot.index, guide.id); }
    _renderGuidePanel(); canvas.renderAll();
    menu.style.display = "none";
  };

  var close = function(ev) {
    if (!menu.contains(ev.target)) { menu.style.display = "none"; document.removeEventListener("mousedown", close); }
  };
  setTimeout(function() { document.addEventListener("mousedown", close); }, 50);
}

// ── guide panel render ─────────────────────────────────────────
function _renderGuidePanel() {
  var list  = document.getElementById("guideList");
  var badge = document.getElementById("guideBadge");
  if (!list) return;

  var state = ArtboardMap[activeFrameId];
  if (!state) { list.innerHTML = '<p class="filter-hint">No active frame</p>'; return; }

  var slots = (state.config.slots || []).filter(function(sl) { return state.slotImages[sl.index]; });
  if (!slots.length) {
    list.innerHTML = '<p class="filter-hint">Upload a photo to use guides</p>';
    if (badge) badge.textContent = "";
    return;
  }

  var totalGuides = 0;
  var html = "";
  slots.forEach(function(sl) {
    var guides = _getGuides(state.frameId, sl.index);
    totalGuides += guides.length;
    html += '<div class="guide-slot-group"><div class="guide-slot-label">Slot ' + (sl.index + 1) + '</div>';
    guides.forEach(function(g) {
      var dim = g.axis === "v" ? sl.w : sl.h;
      var px  = _fracToPx(g.frac, dim);
      var pct = Math.round(g.frac * 100);
      html +=
        '<div class="guide-item">' +
          '<span class="gax gax-' + g.axis + '">' + g.axis.toUpperCase() + '</span>' +
          '<input class="gpx" type="number" value="' + px + '" min="1" max="' + (dim - 1) + '"' +
            ' data-gid="' + g.id + '" data-fid="' + state.frameId + '" data-sidx="' + sl.index + '"' +
            ' data-axis="' + g.axis + '" data-dim="' + dim + '" title="Position in native pixels">' +
          '<span class="gpct">' + pct + '%</span>' +
          '<button class="gdel" data-gid="' + g.id + '" data-fid="' + state.frameId + '" data-sidx="' + sl.index + '" title="Delete">\u2715</button>' +
        '</div>';
    });
    html +=
      '<div class="guide-add-btns">' +
        '<button class="gadd" data-axis="v" data-fid="' + state.frameId + '" data-sidx="' + sl.index + '">+ Vertical</button>' +
        '<button class="gadd" data-axis="h" data-fid="' + state.frameId + '" data-sidx="' + sl.index + '">+ Horizontal</button>' +
      '</div></div>';
  });
  list.innerHTML = html;
  if (badge) badge.textContent = totalGuides || "";

  list.querySelectorAll(".gpx").forEach(function(inp) {
    inp.addEventListener("change", function() {
      var fId  = parseInt(inp.dataset.fid);
      var sIdx = parseInt(inp.dataset.sidx);
      var dim  = parseInt(inp.dataset.dim);
      var px   = Math.max(1, Math.min(dim - 1, parseInt(inp.value) || 0));
      inp.value = px;
      var g = _getGuides(fId, sIdx).find(function(gg) { return gg.id === inp.dataset.gid; });
      if (g) { g.frac = _pxToFrac(px, dim); canvas.renderAll(); }
      _renderGuidePanel();
    });
  });
  list.querySelectorAll(".gdel").forEach(function(btn) {
    btn.addEventListener("click", function() {
      _deleteGuide(parseInt(btn.dataset.fid), parseInt(btn.dataset.sidx), btn.dataset.gid);
    });
  });
  list.querySelectorAll(".gadd").forEach(function(btn) {
    btn.addEventListener("click", function() {
      _addGuide(parseInt(btn.dataset.fid), parseInt(btn.dataset.sidx), btn.dataset.axis);
    });
  });
}

// ── bind panel toggle buttons ──────────────────────────────────
function bindGuidePanel() {
  document.getElementById("btnToggleGuides")?.addEventListener("click", function() {
    _guidesVisible = !_guidesVisible;
    document.getElementById("btnToggleGuides")?.classList.toggle("active", _guidesVisible);
    canvas.renderAll();
  });
  document.getElementById("btnToggleThirds")?.addEventListener("click", function() {
    _thirdsVisible = !_thirdsVisible;
    document.getElementById("btnToggleThirds")?.classList.toggle("active", _thirdsVisible);
    canvas.renderAll();
  });
  document.getElementById("btnToggleSnap")?.addEventListener("click", function() {
    _snapEnabled = !_snapEnabled;
    document.getElementById("btnToggleSnap")?.classList.toggle("active", _snapEnabled);
  });
}

// ── object:moving ──────────────────────────────────────────────
function _onObjectMoving(e) {
  var obj = e.target;
  if (!obj) return;
  var sb = getSlotForImageObject(obj);
  if (!sb) return;
  _isDraggingPhoto = true;

  if (!_snapEnabled) { _smartGuides = []; return; }

  var state = sb.state;
  var vpt  = canvas.viewportTransform;
  var zoom = vpt[0], tx = vpt[4], ty = vpt[5];
  var cp   = obj.getCenterPoint();
  var objCX = cp.x * zoom + tx;
  var objCY = cp.y * zoom + ty;
  var snaps = [];

  (state.config.slots || []).forEach(function(sl) {
    var r  = _slotScreenRect(state, sl);
    var sW = r.R - r.L, sH = r.B - r.T;

    // snap to custom guide lines
    _getGuides(state.frameId, sl.index).forEach(function(g) {
      var gp = g.axis === "v" ? r.L + sW * g.frac : r.T + sH * g.frac;
      if (g.axis === "v" && Math.abs(objCX - gp) < SNAP_THRESH) {
        snaps.push({ axis: "v", x: gp, state: state, slot: sl, isEdge: false });
        obj.set("left", Math.round((gp - tx) / zoom)); obj.setCoords();
      }
      if (g.axis === "h" && Math.abs(objCY - gp) < SNAP_THRESH) {
        snaps.push({ axis: "h", y: gp, state: state, slot: sl, isEdge: false });
        obj.set("top", Math.round((gp - ty) / zoom)); obj.setCoords();
      }
    });

    // snap to rule-of-thirds
    if (_thirdsVisible) {
      [1/3, 2/3].forEach(function(f) {
        var vx = r.L + sW * f, hy = r.T + sH * f;
        if (Math.abs(objCX - vx) < SNAP_THRESH) {
          snaps.push({ axis: "v", x: vx, state: state, slot: sl, isEdge: false });
          obj.set("left", Math.round((vx - tx) / zoom)); obj.setCoords();
        }
        if (Math.abs(objCY - hy) < SNAP_THRESH) {
          snaps.push({ axis: "h", y: hy, state: state, slot: sl, isEdge: false });
          obj.set("top", Math.round((hy - ty) / zoom)); obj.setCoords();
        }
      });
    }

    // snap to slot edges
    if (Math.abs(objCX - r.L) < SNAP_THRESH) snaps.push({ axis: "v", x: r.L, state: state, slot: sl, isEdge: true });
    if (Math.abs(objCX - r.R) < SNAP_THRESH) snaps.push({ axis: "v", x: r.R, state: state, slot: sl, isEdge: true });
    if (Math.abs(objCY - r.T) < SNAP_THRESH) snaps.push({ axis: "h", y: r.T, state: state, slot: sl, isEdge: true });
    if (Math.abs(objCY - r.B) < SNAP_THRESH) snaps.push({ axis: "h", y: r.B, state: state, slot: sl, isEdge: true });
  });

  _smartGuides = snaps;
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
  document.getElementById("btnExport")?.addEventListener("click", () => {
    const state = ArtboardMap[activeFrameId];
    if (!state) return;
    const hasPhoto = canvas.getObjects().some(o =>
      o.data?.frameId === activeFrameId && o.data?.type === "slot-image"
    );
    if (!hasPhoto) { notify("Upload at least one photo first", "info"); return; }
    _runQCExport([state]);
  });
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
  const e = opt.e;
  e.preventDefault();
  e.stopPropagation();

  if (e.ctrlKey || e.metaKey) {
    // Ctrl / Cmd + scroll  →  zoom toward cursor
    const zoom = clamp(canvas.getZoom() * Math.pow(0.999, e.deltaY), 0.05, 10);
    canvas.zoomToPoint({ x: e.offsetX, y: e.offsetY }, zoom);
    updateZoomDisplay();
  } else {
    // Plain scroll  →  pan canvas
    // Shift + scroll  →  horizontal pan
    const vpt = canvas.viewportTransform;
    if (e.shiftKey) {
      vpt[4] -= e.deltaY;          // horizontal
    } else {
      vpt[4] -= e.deltaX || 0;     // trackpad h-scroll
      vpt[5] -= e.deltaY;          // vertical
    }
    canvas.requestRenderAll();
  }
  updateLabelPositions();
  updateScrollbars();
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
  updateScrollbars();
}
function onMouseUp() {
  isPanning = false;
  if (currentTool === "hand") canvas.defaultCursor = "grab";
}

function adjustZoom(factor) {
  const zoom = clamp(canvas.getZoom() * factor, 0.05, 10);
  canvas.zoomToPoint({ x: canvas.width/2, y: canvas.height/2 }, zoom);
  updateZoomDisplay(); updateLabelPositions(); updateScrollbars();
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
  updateZoomDisplay(); updateLabelPositions(); updateScrollbars();
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
// SCROLLBARS
// ─────────────────────────────────────────────────────────────────
function updateScrollbars() {
  const hBar   = document.getElementById("scrollH");
  const vBar   = document.getElementById("scrollV");
  const hThumb = document.getElementById("scrollThumbH");
  const vThumb = document.getElementById("scrollThumbV");
  if (!hBar || !vBar || !canvas) return;

  const viewW    = canvas.width;
  const viewH    = canvas.height;
  const zoom     = canvas.getZoom();
  const vpt      = canvas.viewportTransform;
  const contentW = canvasTotalW * zoom;
  const contentH = canvasH * zoom;
  const panX     = -vpt[4];
  const panY     = -vpt[5];

  const hRatio   = Math.min(viewW / Math.max(contentW, 1), 1);
  const vRatio   = Math.min(viewH / Math.max(contentH, 1), 1);
  const hBarW    = hBar.clientWidth;
  const vBarH    = vBar.clientHeight;
  const hThumbW  = Math.max(hRatio * hBarW, 32);
  const vThumbH  = Math.max(vRatio * vBarH, 32);
  const maxPanX  = Math.max(contentW - viewW, 0);
  const maxPanY  = Math.max(contentH - viewH, 0);
  const hPos     = maxPanX ? (clamp(panX, 0, maxPanX) / maxPanX) * (hBarW - hThumbW) : 0;
  const vPos     = maxPanY ? (clamp(panY, 0, maxPanY) / maxPanY) * (vBarH - vThumbH) : 0;

  hThumb.style.width  = hThumbW + "px";
  hThumb.style.left   = hPos    + "px";
  vThumb.style.height = vThumbH + "px";
  vThumb.style.top    = vPos    + "px";

  hBar.style.display = hRatio >= 0.999 ? "none" : "block";
  vBar.style.display = vRatio >= 0.999 ? "none" : "block";
}

function initScrollbars() {
  const hBar   = document.getElementById("scrollH");
  const vBar   = document.getElementById("scrollV");
  const hThumb = document.getElementById("scrollThumbH");
  const vThumb = document.getElementById("scrollThumbV");
  if (!hThumb || !vThumb) return;

  let dragging  = null;   // 'h' | 'v'
  let dragStart = 0;
  let panStart  = 0;

  function startDrag(axis, clientPos, currentPan) {
    dragging  = axis;
    dragStart = clientPos;
    panStart  = currentPan;
    document.body.style.userSelect = "none";
  }
  function stopDrag() {
    dragging = null;
    document.body.style.userSelect = "";
  }

  hThumb.addEventListener("mousedown", e => {
    startDrag("h", e.clientX, -canvas.viewportTransform[4]);
    e.stopPropagation(); e.preventDefault();
  });
  vThumb.addEventListener("mousedown", e => {
    startDrag("v", e.clientY, -canvas.viewportTransform[5]);
    e.stopPropagation(); e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const zoom  = canvas.getZoom();
    const vpt   = canvas.viewportTransform;
    if (dragging === "h") {
      const barW    = hBar.clientWidth;
      const thumbW  = hThumb.offsetWidth;
      const maxPan  = Math.max(canvasTotalW * zoom - canvas.width, 0);
      const delta   = e.clientX - dragStart;
      const ratio   = delta / Math.max(barW - thumbW, 1);
      vpt[4] = -clamp(panStart + ratio * maxPan, 0, maxPan);
    } else {
      const barH    = vBar.clientHeight;
      const thumbH  = vThumb.offsetHeight;
      const maxPan  = Math.max(canvasH * zoom - canvas.height, 0);
      const delta   = e.clientY - dragStart;
      const ratio   = delta / Math.max(barH - thumbH, 1);
      vpt[5] = -clamp(panStart + ratio * maxPan, 0, maxPan);
    }
    canvas.requestRenderAll();
    updateLabelPositions();
    updateScrollbars();
  });
  document.addEventListener("mouseup", stopDrag);
  document.addEventListener("mouseleave", stopDrag);
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
  const snap = {};
  Object.values(ArtboardMap).forEach(ab => {
    const objs = canvas.getObjects().filter(o => {
      const d = o.data || {};
      return d.frameId === ab.frameId && d.type !== "artboard-bg" && d.type !== "frame-overlay";
    });
    // Include slotFilters so color corrections are part of the undo snapshot
    const filters = {};
    Object.entries(ab.slotFilters || {}).forEach(([k, f]) => { filters[k] = { ...f }; });
    snap[ab.frameId] = {
      objects:     objs.map(o => o.toObject(["data", "clipPath"])),
      slotFilters: filters,
    };
  });
  return JSON.stringify(snap);
}

function restoreAll(snapStr) {
  const snap = JSON.parse(snapStr);
  const entries = Object.entries(snap);

  // Nothing to restore edge-case
  if (entries.length === 0) {
    refreshLayersPanel();
    renderSlotsPanel(activeFrameId);
    return;
  }

  // ── Pre-load ALL frames in parallel while the current canvas stays visible ──
  // Only clear + swap after every frame has finished loading so there is no
  // blank-canvas flicker between "removed old" and "added new".
  let pending = entries.length;
  const frameResults = {};   // fid (string) → { loaded: FabricObject[], slotFilters }

  entries.forEach(([fid, frameSnap]) => {
    // Support old-format snapshots (plain array) and new-format (object with .objects)
    const objList    = Array.isArray(frameSnap) ? frameSnap : (frameSnap.objects || []);
    const savedFilters = Array.isArray(frameSnap) ? null    : (frameSnap.slotFilters || null);

    fabric.util.enlivenObjects(objList, loaded => {
      frameResults[fid] = { loaded, slotFilters: savedFilters };
      pending--;
      if (pending === 0) _commitRestore(frameResults);
    });
  });
}

// Called once ALL frames have finished loading — swaps canvas content atomically.
function _commitRestore(frameResults) {
  // Remove everything except permanent background and frame overlays
  canvas.getObjects().filter(o => {
    const d = o.data || {};
    return d.type !== "artboard-bg" && d.type !== "frame-overlay";
  }).forEach(o => canvas.remove(o));

  Object.entries(frameResults).forEach(([fid, { loaded, slotFilters }]) => {
    const state = ArtboardMap[parseInt(fid)];
    if (!state) return;
    state.slotImages   = {};
    state.overlayObj   = null;
    state.placeholders = [];

    // Restore saved filter params so color panel stays in sync
    if (slotFilters) {
      Object.entries(slotFilters).forEach(([k, f]) => { state.slotFilters[k] = { ...f }; });
    }

    loaded.forEach(obj => {
      const d = obj.data || {};
      if (d.type === "frame-overlay") return;
      canvas.add(obj);
      if (d.type === "slot-image") {
        const slot = state.config.slots.find(s => s.index === d.slotIndex);
        state.slotImages[d.slotIndex] = obj;
        normalizeSlotImageObject(state, slot, obj);
        // Re-apply filter params from state so the canvas object matches
        applyFiltersToSlot(parseInt(fid), d.slotIndex);
      }
      if (d.type === "slot-placeholder") state.placeholders.push(obj);
      if (typeof d.locked === "boolean") applyLayerLock(obj);
    });
    addAutoTextToArtboard(state);
  });

  canvas.renderAll();
  refreshLayersPanel();
  renderSlotsPanel(activeFrameId);
}

// ─────────────────────────────────────────────────────────────────
// SAVE & EXPORT
// ─────────────────────────────────────────────────────────────────
async function saveSession() {
  setStatus("Saving…", "saving");
  // Build artboards map: {frameId → canvas_json_for_that_frame}
  const artboards = {};
  Object.values(ArtboardMap).forEach(ab => {
    const objs = canvas.getObjects().filter(o => {
      const d = o.data || {};
      return d.frameId === ab.frameId && d.type !== "artboard-bg" && d.type !== "slot-placeholder" && d.type !== "slot-label" && d.type !== "frame-overlay";
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
    setStatus("All changes saved ✓", "saved");
    setTimeout(() => setStatus("", ""), 3000);
  } else {
    setStatus("Save failed", "error");
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

function showExportSelector() {
  const modal = document.getElementById("exportSelectorModal");
  const list  = document.getElementById("exportSelectorList");
  if (!modal || !list) return;
  list.innerHTML = "";

  Object.values(ArtboardMap).forEach(state => {
    const photoCount = canvas.getObjects().filter(o =>
      o.data?.frameId === state.frameId && o.data?.type === "slot-image"
    ).length;
    const totalSlots = state.config.slots.length;
    const ready = photoCount > 0;

    // Build thumbnail — capture always so overlay is visible even with no photos
    let thumbDataURL = null;
    try { thumbDataURL = _captureArtboard(state); } catch (_) {}

    const row = document.createElement("label");
    row.className = "export-sel-row" + (ready ? " ready" : "");

    // thumbnail element
    const thumbEl = document.createElement("div");
    thumbEl.className = "export-sel-thumb";
    if (thumbDataURL) {
      const img = document.createElement("img");
      img.src = thumbDataURL;
      img.alt = state.config.display_name;
      thumbEl.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "export-sel-thumb-placeholder";
      ph.textContent = "🖼";
      thumbEl.appendChild(ph);
    }

    // checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = state.frameId;
    if (ready) cb.checked = true;
    else cb.disabled = true;

    // info block (name + dim + status stacked)
    const info = document.createElement("div");
    info.className = "export-sel-info";
    info.innerHTML = `
      <span class="export-sel-name">${state.config.display_name}</span>
      <span class="export-sel-dim">${state.config.canvas_width}×${state.config.canvas_height}</span>
      <span class="export-sel-status ${ready ? "ready" : "empty"}">
        ${ready ? `${photoCount} / ${totalSlots} photo${photoCount !== 1 ? "s" : ""}` : "No photos"}
      </span>`;

    row.appendChild(cb);
    row.appendChild(thumbEl);
    row.appendChild(info);
    list.appendChild(row);
  });

  modal.style.display = "flex";
}

function bindExportSelector() {
  const closeModal = () => {
    document.getElementById("exportSelectorModal").style.display = "none";
  };
  document.getElementById("exportSelClose")?.addEventListener("click",  closeModal);
  document.getElementById("exportSelCancel")?.addEventListener("click", closeModal);
  document.getElementById("exportSelAll")?.addEventListener("click", () => {
    document.querySelectorAll("#exportSelectorList input[type=checkbox]:not(:disabled)")
      .forEach(cb => { cb.checked = true; });
  });
  document.getElementById("exportSelNone")?.addEventListener("click", () => {
    document.querySelectorAll("#exportSelectorList input[type=checkbox]:not(:disabled)")
      .forEach(cb => { cb.checked = false; });
  });
  document.getElementById("exportSelConfirm")?.addEventListener("click", async () => {
    closeModal();
    const checked  = document.querySelectorAll("#exportSelectorList input[type=checkbox]:checked");
    const frameIds = [...checked].map(cb => parseInt(cb.value));
    if (!frameIds.length) { notify("No frames selected for export", "info"); return; }
    await exportSelected(frameIds);
  });
}

async function exportAll() {
  // "Export All" opens the frame selector first
  showExportSelector();
}

// ─── Quality Control — persistent settings ───────────────────────────────
// Settings live in localStorage so they survive page reloads.
// The "⚙ JPEG · 85%" button in the top bar opens the panel directly.

const QC_STORAGE_KEY = "darshan_qc_settings";

function qcLoadPrefs() {
  try { return JSON.parse(localStorage.getItem(QC_STORAGE_KEY)) || {}; } catch { return {}; }
}
function qcSavePrefs(p) {
  try { localStorage.setItem(QC_STORAGE_KEY, JSON.stringify(p)); } catch {}
}

function qcGetSettings() {
  return {
    format:   document.querySelector("input[name=qcFormat]:checked")?.value || "jpeg",
    quality:  parseInt(document.getElementById("qcQuality").value),
    sharpen:  document.getElementById("qcSharpen").checked,
    targetKb: parseInt(document.querySelector("input[name=qcTarget]:checked")?.value || "0") || null,
  };
}

function qcUpdateBadge() {
  const s   = qcLoadPrefs();
  const fmt = (s.format || "jpeg").toUpperCase();
  const q   = s.format === "png" ? "" : ` · ${s.quality || 85}%`;
  const tgt = s.targetKb ? ` · ≤${s.targetKb >= 1024 ? (s.targetKb/1024)+"MB" : s.targetKb+"KB"}` : "";
  const badge = document.getElementById("qcBadge");
  if (badge) badge.textContent = `${fmt}${q}${tgt}`;
}

function qcUpdateEstimate() {
  const fmt   = document.querySelector("input[name=qcFormat]:checked")?.value || "jpeg";
  const q     = parseInt(document.getElementById("qcQuality").value);
  const state = ArtboardMap[activeFrameId];
  const px    = state
    ? state.config.canvas_width * state.config.canvas_height
    : 3000 * 3000;

  // Heuristics based on real darshan exports (photo-heavy content ~60% complex)
  let est;
  if (fmt === "png") {
    const mb = (px * 3.0 / 1024 / 1024).toFixed(1);
    est = `~${mb} MB (lossless)`;
  } else if (fmt === "webp") {
    const kb = Math.round(px * (q / 100) * 0.18 / 1024);
    est = kb >= 1024 ? `~${(kb/1024).toFixed(1)} MB` : `~${kb} KB`;
  } else {
    const kb = Math.round(px * (q / 100) * 0.40 / 1024);
    est = kb >= 1024 ? `~${(kb/1024).toFixed(1)} MB` : `~${kb} KB`;
  }
  document.getElementById("qcEstSize").textContent = est;

  // Resolution
  if (state) {
    document.getElementById("qcNativeRes").textContent =
      `${state.config.canvas_width} × ${state.config.canvas_height} px`;
  }

  // Quality hint
  const hint = document.getElementById("qcQualityHint");
  if (hint) {
    if (q >= 90)      hint.textContent = "High quality — larger file";
    else if (q >= 80) hint.textContent = "Recommended — best quality/size balance";
    else if (q >= 65) hint.textContent = "Good quality — noticeably smaller file";
    else              hint.textContent = "Low quality — smallest file, visible compression";
  }

  // Show/hide quality + target rows
  const isPNG = fmt === "png";
  document.getElementById("qcQualityRow").style.display = isPNG ? "none" : "";
  document.getElementById("qcTargetRow").style.display  = isPNG ? "none" : "";
}

function bindQCModal() {
  const modal = document.getElementById("qcModal");
  if (!modal) return;

  // Open via gear button in top bar
  document.getElementById("btnQualitySettings")?.addEventListener("click", openQCPanel);

  // Close
  document.getElementById("qcClose")?.addEventListener("click",  closeQCPanel);
  document.getElementById("qcCancel")?.addEventListener("click", closeQCPanel);

  // Slider live update
  document.getElementById("qcQuality")?.addEventListener("input", e => {
    document.getElementById("qcQualityVal").textContent = e.target.value;
    qcUpdateEstimate();
  });

  // Format / target change
  document.querySelectorAll("input[name=qcFormat], input[name=qcTarget]")
    .forEach(r => r.addEventListener("change", qcUpdateEstimate));

  // Save settings on any change
  function persistSettings() {
    qcSavePrefs(qcGetSettings());
    qcUpdateBadge();
  }
  document.getElementById("qcQuality")?.addEventListener("change", persistSettings);
  document.getElementById("qcSharpen")?.addEventListener("change", persistSettings);
  document.querySelectorAll("input[name=qcFormat], input[name=qcTarget]")
    .forEach(r => r.addEventListener("change", persistSettings));

  // Test Export — runs export on active frame immediately
  document.getElementById("qcTestExport")?.addEventListener("click", async () => {
    qcSavePrefs(qcGetSettings());
    qcUpdateBadge();
    closeQCPanel();
    const state = ArtboardMap[activeFrameId];
    if (!state) { notify("No active frame to test", "info"); return; }
    await _runQCExport([state]);
  });

  // Export All from modal
  document.getElementById("qcConfirm")?.addEventListener("click", () => {
    qcSavePrefs(qcGetSettings());
    qcUpdateBadge();
    closeQCPanel();
    showExportSelector();
  });

  // Restore saved settings into UI
  const saved = qcLoadPrefs();
  if (saved.format) {
    const radio = document.querySelector(`input[name=qcFormat][value="${saved.format}"]`);
    if (radio) radio.checked = true;
  }
  if (saved.quality) {
    document.getElementById("qcQuality").value = saved.quality;
    document.getElementById("qcQualityVal").textContent = saved.quality;
  }
  if (saved.sharpen) document.getElementById("qcSharpen").checked = true;
  if (saved.targetKb) {
    const radio = document.querySelector(`input[name=qcTarget][value="${saved.targetKb}"]`);
    if (radio) radio.checked = true;
  }

  qcUpdateBadge();
}

function openQCPanel() {
  qcUpdateEstimate();
  // Clear last-export row until a new export runs
  document.getElementById("qcLastExportRow").style.display = "none";
  document.getElementById("qcModal").style.display = "flex";
}
function closeQCPanel() {
  document.getElementById("qcModal").style.display = "none";
}

async function exportSelected(frameIds) {
  const toExport = frameIds.map(id => ArtboardMap[id]).filter(Boolean);
  if (!toExport.length) { notify("No frames to export", "info"); return; }
  await _runQCExport(toExport);
}

async function _runQCExport(toExport) {
  const qcSettings = qcLoadPrefs();
  // Defaults if never configured
  if (!qcSettings.format)  qcSettings.format  = "jpeg";
  if (!qcSettings.quality) qcSettings.quality = 85;
  if (!qcSettings.sharpen) qcSettings.sharpen = false;

  const overlay = document.getElementById("exportOverlay");
  const msg     = document.getElementById("exportMsg");
  overlay.style.display = "flex";

  // ── Step 1: render frames to PNG data-URLs ───────────────────
  msg.textContent = `Rendering ${toExport.length} frame${toExport.length > 1 ? "s" : ""}…`;
  await new Promise(r => setTimeout(r, 60));

  const rendered = [];
  try {
    for (let i = 0; i < toExport.length; i++) {
      const state = toExport[i];
      msg.textContent = `Rendering ${i + 1} / ${toExport.length}: ${state.config.display_name}…`;
      await new Promise(r => setTimeout(r, 30));
      rendered.push({
        dataURL: _captureArtboard(state),
        state,
        name: state.config.display_name,
      });
    }
  } catch (err) {
    notify("Render failed: " + err.message, "error");
    overlay.style.display = "none";
    return;
  }

  // ── Step 2: compress via backend ─────────────────────────────
  const blobs = [];
  try {
    for (let i = 0; i < rendered.length; i++) {
      const { dataURL, state, name } = rendered[i];
      msg.textContent = `Compressing ${i + 1} / ${rendered.length}: ${name} (${(qcSettings.format||"jpeg").toUpperCase()} ${qcSettings.quality || 85}%)…`;
      await new Promise(r => setTimeout(r, 20));

      const baseName = _exportFilename(state).replace(/\.png$/i, "");
      const resp = await fetch("/api/compress-export/", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_data:     dataURL,
          format:         qcSettings.format,
          quality:        qcSettings.quality,
          sharpen:        qcSettings.sharpen,
          target_size_kb: qcSettings.targetKb || null,
          filename:       baseName,
        }),
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || "Compression failed");

      const blob = await (await fetch(result.data_uri)).blob();
      blobs.push({ blob, filename: result.filename, name, sizeKb: result.size_kb });
    }
  } catch (err) {
    notify("Compression failed: " + err.message, "error");
    overlay.style.display = "none";
    return;
  }

  // ── Update last-export info in QC panel ──────────────────────
  const totalKb  = blobs.reduce((s, b) => s + b.sizeKb, 0);
  const dispSize = totalKb >= 1024
    ? `${(totalKb/1024).toFixed(2)} MB`
    : `${Math.round(totalKb)} KB`;
  const lastEl  = document.getElementById("qcActualSize");
  const lastRow = document.getElementById("qcLastExportRow");
  if (lastEl && lastRow) {
    lastEl.textContent = blobs.length === 1
      ? dispSize
      : `${dispSize} (${blobs.length} files)`;
    lastRow.style.display = "";
  }

  // ── Step 3: download ─────────────────────────────────────────
  // Single file → direct download.
  // Multiple files → bundle into a .zip using JSZip (no user-gesture
  // timing issues, works offline, no browser permission dialogs).
  try {
    if (blobs.length === 1) {
      msg.textContent = `Downloading ${blobs[0].name}…`;
      _downloadBlob(blobs[0].blob, blobs[0].filename);
      await new Promise(r => setTimeout(r, 200));
      overlay.style.display = "none";
      notify(`✓ Exported — ${dispSize}`, "success");
    } else {
      // Build zip
      const zip = new JSZip();
      for (let i = 0; i < blobs.length; i++) {
        const { blob, filename, name } = blobs[i];
        msg.textContent = `Adding to zip ${i + 1} / ${blobs.length}: ${name}…`;
        await new Promise(r => setTimeout(r, 20));
        zip.file(filename, blob);
      }
      msg.textContent = "Generating zip archive…";
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });

      // Build a meaningful zip name: darshan_type + date
      const sess    = window.SESSION || {};
      const zipDate = (sess.darshan_date || new Date().toISOString().slice(0,10)).replace(/-/g, "");
      const zipType = sess.darshan_type || "darshan";
      const zipName = `${zipType}_${zipDate}.zip`;

      _downloadBlob(zipBlob, zipName);
      overlay.style.display = "none";
      notify(`✓ Exported ${blobs.length} frames as ${zipName} — ${dispSize} total`, "success");
    }
  } catch (err) {
    notify("Export failed: " + err.message, "error");
    overlay.style.display = "none";
  }
}

// Auto-save — triggers 2 s after the last change, just like Excel.
// Shows "Saving…" immediately so the user knows a save is queued.
const AUTOSAVE_DELAY = 2000; // ms

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  setStatus("Unsaved changes…", "pending");
  autosaveTimer = setTimeout(() => {
    saveSession();
  }, AUTOSAVE_DELAY);
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS EXPORT / IMPORT
// Full portable JSON: all frames, text, slot filters, photos (base64)
// ─────────────────────────────────────────────────────────────────

// Convert an img element to a base64 data-URI (JPEG 92% for photos)
function _imgElementToBase64(el) {
  if (!el) return null;
  try {
    const c  = document.createElement("canvas");
    c.width  = el.naturalWidth  || el.width  || 1;
    c.height = el.naturalHeight || el.height || 1;
    c.getContext("2d").drawImage(el, 0, 0);
    return c.toDataURL("image/jpeg", 0.92);
  } catch { return null; }
}

async function exportSettings() {
  const overlay = document.getElementById("exportOverlay");
  const msg     = document.getElementById("exportMsg");
  overlay.style.display = "flex";
  msg.textContent = "Preparing settings export…";
  await new Promise(r => setTimeout(r, 60));

  try {
    const frames = {};
    const allStates = Object.values(ArtboardMap);

    for (let i = 0; i < allStates.length; i++) {
      const state = allStates[i];
      msg.textContent = `Serializing frame ${i + 1}/${allStates.length}: ${state.config.display_name}…`;
      await new Promise(r => setTimeout(r, 20));

      // Collect all non-bg objects for this frame
      const objs = canvas.getObjects().filter(o => {
        const d = o.data || {};
        return d.frameId === state.frameId &&
               !["artboard-bg", "slot-placeholder", "slot-label"].includes(d.type);
      });

      // Serialize each object; embed photos as base64 so they're portable
      const serialized = objs.map(obj => {
        const plain = obj.toObject(["data"]);  // no clipPath — we rebuild it on import
        if (obj.data?.type === "slot-image" && obj._element) {
          plain.src = _imgElementToBase64(obj._element) || plain.src;
        }
        return plain;
      });

      // Deep-clone slotFilters so they survive JSON round-trip
      const slotFilters = {};
      for (const [si, f] of Object.entries(state.slotFilters || {})) {
        slotFilters[si] = { ...f };
      }

      frames[state.frameId] = {
        frame_type:   state.config.frame_type,
        display_name: state.config.display_name,
        objects:      serialized,
        slot_filters: slotFilters,
      };
    }

    // Capture current text-panel UI defaults
    const textDefaults = {
      font:         document.getElementById("txtFont")?.value         || "Arial",
      size:         document.getElementById("txtSize")?.value         || "60",
      color:        document.getElementById("txtColor")?.value        || "#FFFFFF",
      strokeColor:  document.getElementById("txtStrokeColor")?.value  || "#000000",
      strokeW:      document.getElementById("txtStrokeW")?.value      || "2",
      align:        document.getElementById("txtAlign")?.value        || "center",
      bold:         document.getElementById("txtBold")?.checked       ?? true,
      italic:       document.getElementById("txtItalic")?.checked     ?? false,
      underline:    document.getElementById("txtUnderline")?.checked  ?? false,
      shadow:       document.getElementById("txtShadow")?.checked     ?? true,
    };

    const pkg = {
      version:       "2.0",
      app:           "DailyDarshan",
      exported_at:   new Date().toISOString(),
      darshan_type:  window.SESSION.darshan_type,
      darshan_date:  window.SESSION.darshan_date,
      title:         window.SESSION.title || "",
      text_defaults: textDefaults,
      frames,
    };

    msg.textContent = "Writing JSON file…";
    await new Promise(r => setTimeout(r, 20));

    const blob = new Blob([JSON.stringify(pkg)], { type: "application/json" });
    _downloadBlob(blob, `darshan_settings_${window.SESSION.darshan_date}.json`);
    notify("✓ Settings exported — share this JSON with other users", "success");
  } catch (err) {
    notify("Settings export failed: " + err.message, "error");
    console.error(err);
  } finally {
    overlay.style.display = "none";
  }
}

// Upload a base64 data-URI as a server photo, returning { url, photo_id }.
// Used during import so the session save stores a small URL, not raw base64.
async function _uploadBase64Photo(dataUri, frameId, slotIndex, fileName) {
  // Convert data URI → Blob → File
  const res   = await fetch(dataUri);
  const blob  = await res.blob();
  const ext   = blob.type === "image/jpeg" ? "jpg" : "png";
  const fName = fileName || `imported_${frameId}_slot${slotIndex}.${ext}`;
  const file  = new File([blob], fName, { type: blob.type });

  const fd = new FormData();
  fd.append("photo",           file);
  fd.append("frame_config_id", frameId);
  fd.append("slot_index",      slotIndex);
  const r = await apiFormPost("/api/upload/", fd);
  return r.success ? { url: r.url, photo_id: r.photo_id } : null;
}

// Read a File as text using FileReader (works in all browsers including Safari)
function _readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file, "UTF-8");
  });
}

async function importSettings(file) {
  const overlay = document.getElementById("exportOverlay");
  const msg     = document.getElementById("exportMsg");
  overlay.style.display = "flex";
  msg.textContent = "Reading settings file…";
  await new Promise(r => setTimeout(r, 40));

  // ── Step 1: read and parse the file ──────────────────────────
  let pkg;
  try {
    const text = await _readFileAsText(file);
    // Quick sanity check before JSON.parse — catch HTML responses
    if (text.trimStart().startsWith("<")) {
      notify("Selected file is not a JSON settings file", "error");
      overlay.style.display = "none";
      return;
    }
    pkg = JSON.parse(text);
  } catch (e) {
    notify(`Cannot read file: ${e.message}`, "error");
    overlay.style.display = "none";
    return;
  }

  if (pkg.app !== "DailyDarshan" || !pkg.frames) {
    notify("This file is not a valid DailyDarshan settings export", "error");
    overlay.style.display = "none";
    return;
  }

  // ── Step 2: restore each frame ───────────────────────────────
  // Canvas restore is fully independent from the server save.
  // We complete restore first, then silently save in background.
  try {
    const frameEntries = Object.entries(pkg.frames);

    for (let i = 0; i < frameEntries.length; i++) {
      const [fidStr, frameData] = frameEntries[i];
      const fid   = parseInt(fidStr);
      const state = ArtboardMap[fid];
      if (!state) continue;

      msg.textContent = `Restoring ${i + 1}/${frameEntries.length}: ${frameData.display_name}…`;
      await new Promise(r => setTimeout(r, 30));

      // Clear existing non-bg, non-overlay objects for this frame
      canvas.getObjects()
        .filter(o => o.data?.frameId === fid && o.data?.type !== "artboard-bg" && o.data?.type !== "frame-overlay")
        .forEach(o => canvas.remove(o));
      state.slotImages   = {};
      state.placeholders = [];
      state.textObjs     = [];

      // Restore slot filters
      if (frameData.slot_filters) {
        for (const [si, f] of Object.entries(frameData.slot_filters)) {
          state.slotFilters[parseInt(si)] = { ...defaultFilters(), ...f };
        }
      }

      // Upload any base64 photos to the server so the session JSON stays
      // small (server URLs instead of raw base64 data URIs).
      const uploadedSrcMap = {}; // slotIndex → { url, photo_id }
      for (const obj of (frameData.objects || [])) {
        if (obj.type === "image" && obj.data?.type === "slot-image" &&
            typeof obj.src === "string" && obj.src.startsWith("data:")) {
          const si = obj.data.slotIndex;
          msg.textContent = `Uploading photo for ${frameData.display_name} slot ${si + 1}…`;
          await new Promise(r => setTimeout(r, 20));
          const uploaded = await _uploadBase64Photo(obj.src, fid, si, obj.data.fileName);
          if (uploaded) {
            uploadedSrcMap[si] = uploaded;
            obj.src          = uploaded.url;       // replace base64 with server URL
            obj.data.photoId = uploaded.photo_id;
          }
        }
      }

      // Restore canvas objects (now all srcs are server URLs)
      await new Promise(resolve => {
        fabric.util.enlivenObjects(frameData.objects || [], loaded => {
          loaded.forEach(obj => {
            const d = obj.data || {};
            // Frame overlays are never restored from saved data — always reload fresh
            if (d.type === "frame-overlay") return;
            canvas.add(obj);
            if (d.type === "slot-image") {
              const slot = state.config.slots.find(s => s.index === d.slotIndex);
              if (slot) {
                state.slotImages[d.slotIndex] = obj;
                normalizeSlotImageObject(state, slot, obj);
                applyFiltersToSlot(fid, d.slotIndex);
                // Update slot panel thumbnail
                const up = uploadedSrcMap[d.slotIndex];
                if (up) updateSlotPanelThumb(fid, d.slotIndex, up.url);
              }
            }
            if (d.type === "slot-placeholder") state.placeholders.push(obj);
            if (d.type === "text-overlay")     state.textObjs.push(obj);
            if (typeof d.locked === "boolean") applyLayerLock(obj);
          });
          addAutoTextToArtboard(state);
          // Always reload frame overlay fresh from server
          if (state.config.overlay_url) loadFrameOverlay(state, state.config.overlay_url);
          resolve();
        });
      });

      // Restore placeholders for slots that have no image
      state.config.slots.forEach(slot => {
        if (!state.slotImages[slot.index]) restorePlaceholderForSlot(state, slot.index);
      });
    }

    canvas.renderAll();
  } catch (err) {
    notify("Import failed during canvas restore: " + err.message, "error");
    console.error("Import canvas error:", err);
    overlay.style.display = "none";
    return;
  }

  // ── Step 3: restore text panel UI ────────────────────────────
  if (pkg.text_defaults) {
    try {
      const td = pkg.text_defaults;
      const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value   = v; };
      const setChk = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.checked = v; };
      setVal("txtFont",        td.font);
      setVal("txtSize",        td.size);
      setVal("txtColor",       td.color);
      setVal("txtStrokeColor", td.strokeColor);
      setVal("txtStrokeW",     td.strokeW);
      setVal("txtAlign",       td.align);
      setChk("txtBold",        td.bold);
      setChk("txtItalic",      td.italic);
      setChk("txtUnderline",   td.underline);
      setChk("txtShadow",      td.shadow);
      const prev = document.getElementById("fontPreviewBar");
      if (prev && td.font) prev.style.fontFamily = `"${td.font}", serif`;
    } catch (_) { /* non-fatal */ }
  }

  pushUndo();
  refreshLayersPanel();
  renderSlotsPanel(activeFrameId);

  // ── Step 4: save to server in background (non-blocking) ──────
  overlay.style.display = "none";
  notify(`✓ Settings imported from ${file.name} — all frames restored`, "success");

  // Save silently; don't let save errors mask the successful import
  saveSession().catch(err => {
    console.warn("Background save after import failed:", err);
    notify("Import OK but auto-save failed — press Ctrl+S to save manually", "info");
  });
}

function bindSettingsIO() {
  document.getElementById("btnSettingsExport")?.addEventListener("click", exportSettings);

  const importInput = document.getElementById("settingsImportInput");
  document.getElementById("btnSettingsImport")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (f) importSettings(f);
    e.target.value = ""; // reset so same file can be re-imported
  });
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

// ─────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUT REGISTRY
// ─────────────────────────────────────────────────────────────────
const SHORTCUT_DEFS = [
  { id:"undo",            cat:"Edit",   label:"Undo",                    def:"ctrl+z"            },
  { id:"redo",            cat:"Edit",   label:"Redo",                    def:"ctrl+y"            },
  { id:"deleteSelected",  cat:"Edit",   label:"Delete Selected",         def:"delete"            },
  { id:"rotateCCW",       cat:"Edit",   label:"Rotate Left 15°",         def:"["                 },
  { id:"rotateCW",        cat:"Edit",   label:"Rotate Right 15°",        def:"]"                 },
  { id:"nudgeLeft",       cat:"Edit",   label:"Nudge Left 1px",          def:"arrowleft"         },
  { id:"nudgeRight",      cat:"Edit",   label:"Nudge Right 1px",         def:"arrowright"        },
  { id:"nudgeUp",         cat:"Edit",   label:"Nudge Up 1px",            def:"arrowup"           },
  { id:"nudgeDown",       cat:"Edit",   label:"Nudge Down 1px",          def:"arrowdown"         },
  { id:"nudgeLeft10",     cat:"Edit",   label:"Nudge Left 10px",         def:"shift+arrowleft"   },
  { id:"nudgeRight10",    cat:"Edit",   label:"Nudge Right 10px",        def:"shift+arrowright"  },
  { id:"nudgeUp10",       cat:"Edit",   label:"Nudge Up 10px",           def:"shift+arrowup"     },
  { id:"nudgeDown10",     cat:"Edit",   label:"Nudge Down 10px",         def:"shift+arrowdown"   },
  { id:"escape",          cat:"Edit",   label:"Deselect / Close",        def:"escape"            },
  { id:"save",            cat:"File",   label:"Save",                    def:"ctrl+s"            },
  { id:"exportFrame",     cat:"File",   label:"Export Active Frame",     def:"ctrl+e"            },
  { id:"exportAll",       cat:"File",   label:"Export All (select frames)", def:"ctrl+shift+e"   },
  { id:"exportSettings",  cat:"File",   label:"Export Settings JSON",    def:"ctrl+shift+s"      },
  { id:"toolSelect",      cat:"Tools",  label:"Select Tool",             def:"v"                 },
  { id:"toolHand",        cat:"Tools",  label:"Hand (Pan) Tool",         def:"h"                 },
  { id:"toolText",        cat:"Tools",  label:"Text Tool",               def:"t"                 },
  { id:"fitAll",          cat:"View",   label:"Fit All Frames",          def:"f"                 },
  { id:"focusFrame",      cat:"View",   label:"Focus Active Frame",      def:"ctrl+0"            },
  { id:"zoomIn",          cat:"View",   label:"Zoom In",                 def:"="                 },
  { id:"zoomOut",         cat:"View",   label:"Zoom Out",                def:"-"                 },
  { id:"panHold",         cat:"Tools",  label:"Pan Canvas (hold key + drag)", def:" "            },
  // Canvas interactions — non-remappable, documented for reference
  { id:"zoomScroll",      cat:"Canvas", label:"Zoom to cursor",          def:"Ctrl + Scroll",    noRemap: true },
  { id:"panVScroll",      cat:"Canvas", label:"Pan vertically",          def:"Scroll",           noRemap: true },
  { id:"panHScroll",      cat:"Canvas", label:"Pan horizontally",        def:"Shift + Scroll",   noRemap: true },
  { id:"rotateHandle",    cat:"Canvas", label:"Rotate photo",            def:"Drag ↻ corner",    noRemap: true },
  { id:"scrollbars",      cat:"Canvas", label:"Scroll via scrollbars",   def:"Drag H / V bar",   noRemap: true },
  // Color Adjustment sliders — non-remappable keyboard controls
  { id:"sliderFine",      cat:"Color",  label:"Slider fine tune (±1)",   def:"← / → or ↑ / ↓",  noRemap: true },
  { id:"sliderCoarse",    cat:"Color",  label:"Slider coarse tune (±5)", def:"Shift + ← / →",    noRemap: true },
  { id:"sliderReset",     cat:"Color",  label:"Reset single slider",     def:"Dbl-click slider",  noRemap: true },
  { id:"showShortcuts",   cat:"Help",   label:"Keyboard Shortcuts",      def:"ctrl+/"            },
  { id:"startTour",       cat:"Help",   label:"Start Guided Tour",       def:"ctrl+shift+h"      },
];

let _shortcuts = {}; // id → active key string

function _loadShortcuts() {
  try {
    const saved = JSON.parse(localStorage.getItem("dd_shortcuts") || "{}");
    SHORTCUT_DEFS.filter(d => !d.noRemap).forEach(d => { _shortcuts[d.id] = saved[d.id] || d.def; });
  } catch {
    SHORTCUT_DEFS.filter(d => !d.noRemap).forEach(d => { _shortcuts[d.id] = d.def; });
  }
}
function _saveShortcuts() {
  localStorage.setItem("dd_shortcuts", JSON.stringify(_shortcuts));
}
function _normalizeKey(e) {
  const p = [];
  if (e.ctrlKey || e.metaKey) p.push("ctrl");
  if (e.shiftKey && !["Shift"].includes(e.key)) p.push("shift");
  if (e.altKey) p.push("alt");
  // Normalise Space to a literal " " so it round-trips cleanly
  const k = e.key === " " ? " " : e.key.toLowerCase();
  if (!["control","meta","shift","alt"].includes(k)) p.push(k);
  return p.join("+");
}
function _is(e, id) {
  return _normalizeKey(e) === _shortcuts[id];
}
// Format a stored key string for display
function _fmtKey(k) {
  return k.split("+").map(p =>
    p === "ctrl"  ? "Ctrl"  :
    p === "shift" ? "Shift" :
    p === "alt"   ? "Alt"   :
    p === " "     ? "Space" :
    p.startsWith("arrow") ? "↑↓←→"[["arrowup","arrowdown","arrowleft","arrowright"].indexOf(p)] || p :
    p.charAt(0).toUpperCase() + p.slice(1)
  ).join(" + ");
}

// ── Space-bar hold-to-pan state ──────────────────────────────────
let _panHoldActive  = false;   // space is currently held
let _panHoldPrev    = null;    // tool that was active before space was pressed

function _panHoldKey(e) {
  // The stored shortcut for panHold (default " " = Space)
  const panKey = _shortcuts["panHold"] ?? " ";
  // We compare e.key directly (not via _normalizeKey) because
  // _normalizeKey lower-cases " " to " " which is fine, but we
  // also want to support remapped single keys like "space".
  const eKey = e.key === " " ? " " : e.key.toLowerCase();
  return eKey === panKey || e.code === "Space" && panKey === " ";
}

function bindKeyboard() {
  _loadShortcuts();

  // Space hold: keydown → switch to hand; keyup → restore previous tool
  document.addEventListener("keydown", e => {
    if (isTyping()) return;
    if (!_panHoldActive && _panHoldKey(e)) {
      e.preventDefault();
      _panHoldActive = true;
      _panHoldPrev   = currentTool;
      setTool("hand");
      setActiveTool("hand");
      // Show grab cursor on canvas area immediately
      canvas.defaultCursor = "grab";
      canvas.requestRenderAll();
    }
  });
  document.addEventListener("keyup", e => {
    if (_panHoldActive && _panHoldKey(e)) {
      _panHoldActive = false;
      isPanning = false;
      const prev = _panHoldPrev || "select";
      setTool(prev);
      setActiveTool(prev);
      _panHoldPrev = null;
    }
  });
  // Also cancel if window loses focus (e.g. alt-tab)
  window.addEventListener("blur", () => {
    if (_panHoldActive) {
      _panHoldActive = false;
      isPanning = false;
      const prev = _panHoldPrev || "select";
      setTool(prev);
      setActiveTool(prev);
      _panHoldPrev = null;
    }
  });

  document.addEventListener("keydown", e => {
    if (isTyping()) return;
    if (_panHoldActive) return;  // space is active — eat nothing else

    // ── Shortcut-registry actions ─────────────────────────────
    if (_normalizeKey(e) === "g") { e.preventDefault(); _guidesVisible = !_guidesVisible; document.getElementById("btnToggleGuides")?.classList.toggle("active", _guidesVisible); canvas.renderAll(); return; }
    if (_normalizeKey(e) === "shift+r") { e.preventDefault(); _thirdsVisible = !_thirdsVisible; document.getElementById("btnToggleThirds")?.classList.toggle("active", _thirdsVisible); canvas.renderAll(); return; }
    if (_normalizeKey(e) === "shift+s") { e.preventDefault(); _snapEnabled = !_snapEnabled; document.getElementById("btnToggleSnap")?.classList.toggle("active", _snapEnabled); notify(_snapEnabled ? "Snap ON" : "Snap OFF", "info"); return; }
    if (_is(e,"undo"))           { e.preventDefault(); undo(); return; }
    if (_is(e,"redo"))           { e.preventDefault(); redo(); return; }
    // Rotate selected object 15° CCW / CW  ([ and ])
    if (_is(e,"rotateCCW") || _is(e,"rotateCW")) {
      e.preventDefault();
      const obj = canvas.getActiveObject();
      if (obj) {
        const d = obj.data || {};
        if (!["frame-overlay","slot-placeholder","slot-label","artboard-bg"].includes(d.type)) {
          const delta = _is(e,"rotateCCW") ? -15 : 15;
          obj.rotate(((obj.angle || 0) + delta + 360) % 360);
          obj.setCoords();
          canvas.renderAll();
          pushUndo(); scheduleAutosave();
        }
      }
      return;
    }
    if (_is(e,"save"))           { e.preventDefault(); saveSession(); return; }
    if (_is(e,"focusFrame"))     { e.preventDefault(); focusActiveFrame(); return; }
    if (_is(e,"exportFrame"))    { e.preventDefault(); exportFrame(activeFrameId); return; }
    if (_is(e,"exportAll"))      { e.preventDefault(); exportAll(); return; }
    if (_is(e,"exportSettings")) { e.preventDefault(); exportSettings(); return; }
    if (_is(e,"showShortcuts"))  { e.preventDefault(); showShortcutsModal(); return; }
    if (_is(e,"startTour"))      { e.preventDefault(); startTour(); return; }
    if (_is(e,"fitAll"))         { e.preventDefault(); fitAll(); return; }
    if (_is(e,"zoomIn"))         { e.preventDefault(); adjustZoom(1.2); return; }
    if (_is(e,"zoomOut"))        { e.preventDefault(); adjustZoom(1/1.2); return; }
    if (_is(e,"toolSelect"))     { setTool("select"); setActiveTool("select"); return; }
    if (_is(e,"toolHand"))       { setTool("hand");   setActiveTool("hand");   return; }
    if (_is(e,"toolText"))       { document.querySelector(".tool-btn[data-tool='text']")?.click(); return; }
    if (_is(e,"escape"))         { canvas.discardActiveObject(); canvas.renderAll(); endTour(); return; }

    // ── Delete ───────────────────────────────────────────────
    if (_is(e,"deleteSelected")) {
      const obj = canvas.getActiveObject(); if (!obj) return;
      const d = obj.data || {};
      if (["frame-overlay","slot-placeholder","slot-label","artboard-bg"].includes(d.type)) return;
      canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll();
      pushUndo(); scheduleAutosave(); return;
    }

    // ── Arrow nudge ──────────────────────────────────────────
    const obj = canvas.getActiveObject();
    if (obj) {
      let dx = 0, dy = 0;
      const big = 10, sm = 1;
      if (_is(e,"nudgeLeft"))    { dx = -sm; } else if (_is(e,"nudgeLeft10"))  { dx = -big; }
      if (_is(e,"nudgeRight"))   { dx =  sm; } else if (_is(e,"nudgeRight10")) { dx =  big; }
      if (_is(e,"nudgeUp"))      { dy = -sm; } else if (_is(e,"nudgeUp10"))    { dy = -big; }
      if (_is(e,"nudgeDown"))    { dy =  sm; } else if (_is(e,"nudgeDown10"))  { dy =  big; }
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        obj.set({ left: obj.left + dx, top: obj.top + dy });
        obj.setCoords(); canvas.renderAll(); scheduleAutosave(); return;
      }
    }

    // ── Number keys 1–9 → jump to artboard ──────────────────
    const n = parseInt(e.key);
    if (!isNaN(n) && n >= 1 && !(e.ctrlKey || e.metaKey)) {
      const ab = window.ARTBOARDS[n - 1];
      if (ab) { activateArtboard(ab.id); scrollToArtboard(ab.id); }
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// SHORTCUTS MODAL
// ─────────────────────────────────────────────────────────────────
let _scRecording = null; // { id, el } currently recording

function showShortcutsModal() {
  _loadShortcuts();
  const body = document.getElementById("scModalBody");
  if (!body) return;

  // Group by category
  const cats = [...new Set(SHORTCUT_DEFS.map(d => d.cat))];
  body.innerHTML = cats.map(cat => {
    const rows = SHORTCUT_DEFS.filter(d => d.cat === cat).map(d => {
      const keyEl = d.noRemap
        ? `<span class="sc-key sc-key-fixed" title="Fixed interaction">${d.def}</span>`
        : `<span class="sc-key" data-sc-id="${d.id}" title="Click to change">${_fmtKey(_shortcuts[d.id] || d.def)}</span>`;
      return `<div class="sc-row"><span class="sc-label">${d.label}</span>${keyEl}</div>`;
    }).join("");
    return `<div class="sc-category">${cat}</div>${rows}`;
  }).join("");

  // Bind key-edit clicks
  body.querySelectorAll(".sc-key").forEach(el => {
    el.addEventListener("click", () => {
      if (_scRecording) {
        _scRecording.el.classList.remove("recording");
        _scRecording.el.textContent = _fmtKey(_shortcuts[_scRecording.id]);
        if (_scRecording.el === el) { _scRecording = null; return; }
      }
      _scRecording = { id: el.dataset.scId, el };
      el.classList.add("recording");
      el.textContent = "Press key…";
    });
  });

  document.getElementById("scModal").style.display = "flex";
}

function _scKeyListener(e) {
  if (!_scRecording) return;
  e.preventDefault(); e.stopPropagation();
  // Allow Enter to confirm current choice (without changing it)
  if (e.key === "Enter") {
    _scRecording.el.classList.remove("recording");
    _scRecording.el.textContent = _fmtKey(_shortcuts[_scRecording.id]);
    _scRecording = null; return;
  }
  const key = _normalizeKey(e);
  if (key === "escape") {
    _scRecording.el.classList.remove("recording");
    _scRecording.el.textContent = _fmtKey(_shortcuts[_scRecording.id]);
    _scRecording = null; return;
  }
  // Ignore bare modifier keys
  if (["ctrl","shift","alt","meta"].includes(key)) return;
  _shortcuts[_scRecording.id] = key;
  _scRecording.el.classList.remove("recording");
  _scRecording.el.textContent = _fmtKey(key);
  _scRecording = null;
  _saveShortcuts();
}

function bindShortcutsModal() {
  document.addEventListener("keydown", _scKeyListener, true); // capture phase

  document.getElementById("scModalClose")?.addEventListener("click", () => {
    _scRecording = null;
    document.getElementById("scModal").style.display = "none";
  });
  document.getElementById("scDone")?.addEventListener("click", () => {
    _scRecording = null;
    document.getElementById("scModal").style.display = "none";
  });
  document.getElementById("scResetAll")?.addEventListener("click", () => {
    SHORTCUT_DEFS.filter(d => !d.noRemap).forEach(d => { _shortcuts[d.id] = d.def; });
    _saveShortcuts();
    showShortcutsModal(); // re-render
    notify("All shortcuts reset to defaults", "info");
  });
  document.getElementById("btnShortcuts")?.addEventListener("click", showShortcutsModal);
}

// ─────────────────────────────────────────────────────────────────
// GUIDED TOUR
// ─────────────────────────────────────────────────────────────────
const TOUR_STEPS = [
  { sel: null,                    title: "Welcome to Daily Darshan Editor 🙏",
    desc: "This quick tour will walk you through every feature. Use Next/Prev to navigate, or Skip to close. You can restart the tour anytime with the ? button." },
  { sel: ".editor-topbar",        title: "Top Bar",
    desc: "The top bar holds all global controls — navigation, undo/redo, zoom, save, export, and settings. Everything you need is one click away." },
  { sel: "#btnUndo",              title: "Undo & Redo",
    desc: "Undo your last action with Ctrl+Z. Redo with Ctrl+Y. Up to 40 steps of history are kept per session." },
  { sel: "#btnZoomOut",           title: "Zoom Controls",
    desc: "Zoom in/out with + / − or the buttons. Press F to fit all frames in view. Press ⊙ (or Ctrl+0) to jump back to your active frame from anywhere." },
  { sel: "#btnSave",              title: "Auto-Save & Manual Save",
    desc: "Changes are auto-saved 2 seconds after your last edit — just like Excel. The status indicator shows Saving… / Saved ✓. Press Ctrl+S for an instant manual save." },
  { sel: "#btnExport",            title: "Export PNG",
    desc: "Export the active frame as a full-resolution PNG at the frame's native pixel size (e.g. 2208×2208). The image is rendered client-side at maximum quality." },
  { sel: "#btnExportAll",         title: "Export All Frames",
    desc: "Export every frame that has at least one photo. On Chrome/Edge you pick a folder once and all PNGs save silently. On other browsers they download individually." },
  { sel: "#btnSettingsExport",    title: "Export Settings",
    desc: "Export everything — all photos (as base64), text, color adjustments, blend modes, and text panel defaults — as a single JSON file you can share with another device or user." },
  { sel: "#btnSettingsImport",    title: "Import Settings",
    desc: "Import a settings JSON exported from another device. Photos are automatically uploaded to this server, so the session is fully portable between machines." },
  { sel: ".tool-strip",           title: "Tool Strip",
    desc: "Three tools: Select (V) to move/resize objects, Hand (H) to pan the canvas, and Text (T) to add text. Hover any tool icon to see its shortcut." },
  { sel: ".artboard-switcher",    title: "Frame Tabs",
    desc: "Switch between artboard frames here. Press number keys 1–9 to jump instantly. The active frame is highlighted — all edits apply to it." },
  { sel: "#slotsPanel",           title: "Photo Slots",
    desc: "Each frame has one or more photo slots. Click a slot thumbnail or the + placeholder on the canvas to upload a photo. Related slots across L/R frames auto-sync." },
  { sel: "#colorSection",         title: "Color Adjustments",
    desc: "Select a photo then adjust brightness, contrast, saturation, hue, blur, noise, and RGB gamma. Use ✦ Auto Correct for one-click AI color fixing. Effects: B&W, Sepia, Vintage, Sharpen, and more." },
  { sel: "#blendControls",        title: "Blend & Opacity",
    desc: "Control a photo's opacity (0–100%) and blending mode (Normal, Multiply, Screen, Overlay, etc.) per slot. Great for layered artistic effects." },
  { sel: "#transformSection",     title: "Transform Panel",
    desc: "Precisely control X, Y position, W/H size, and rotation angle of the selected object. Use the ↔ ↕ buttons to flip horizontally or vertically. Arrow keys nudge by 1px; Shift+Arrow nudges by 10px." },
  { sel: ".text-presets",         title: "Add Text",
    desc: "Add the Darshan date or title as preset text with one click, or use + Add Text for custom text. Choose from English, Hindi (हिंदी), or Gujarati (ગુજરાતી) fonts. The preview bar shows the font live." },
  { sel: "#mainCanvas",           title: "Infinite Canvas",
    desc: "All frames sit on an infinite canvas. Pan by holding H and dragging, or use middle-click drag. Zoom with scroll wheel. Each frame renders at its exact native resolution on export." },
  { sel: "#artboardList",         title: "Artboards Panel",
    desc: "See all frames at a glance on the right. Click any frame to activate it. The active frame is highlighted." },
  { sel: "#layersList",           title: "Layers Panel",
    desc: "All objects in the active frame are listed here — photos, text overlays, and the frame image. Click ↻ to refresh. Use the delete key to remove the selected layer." },
  { sel: "#btnShortcuts",         title: "Keyboard Shortcuts ⌨",
    desc: "View and customise every keyboard shortcut. Click any shortcut badge to record a new key combo. Changes are saved instantly to your browser. Press Ctrl+/ to open anytime." },
  { sel: "#btnTour",              title: "Restart Tour",
    desc: "That's it! You've seen every feature. Click the ? button in the header anytime to restart this tour. Happy editing! 🙏 Jay Swaminarayan." },
];

let _tourStep = 0;

function startTour() {
  _tourStep = 0;
  document.getElementById("tourOverlay").style.display = "block";
  _renderTourStep();
}
function endTour() {
  document.getElementById("tourOverlay").style.display  = "none";
  document.getElementById("tourSpotlight").style.display = "none";
  document.getElementById("tourCard").style.display     = "none";
}

function _renderTourStep() {
  const steps    = TOUR_STEPS;
  const step     = steps[_tourStep];
  const total    = steps.length;
  const spotlight = document.getElementById("tourSpotlight");
  const card      = document.getElementById("tourCard");

  // Spotlight target element
  if (step.sel) {
    const el = document.querySelector(step.sel);
    if (el) {
      const r = el.getBoundingClientRect();
      const PAD = 6;
      spotlight.style.cssText = `display:block;top:${r.top-PAD}px;left:${r.left-PAD}px;width:${r.width+PAD*2}px;height:${r.height+PAD*2}px`;
    } else {
      spotlight.style.display = "none";
    }
  } else {
    spotlight.style.display = "none";
  }

  // Card content
  document.getElementById("tourBadge").textContent = `${_tourStep+1} / ${total}`;
  document.getElementById("tourTitle").textContent = step.title;
  document.getElementById("tourDesc").textContent  = step.desc;

  // Dots
  const dotsEl = document.getElementById("tourDots");
  dotsEl.innerHTML = steps.map((_,i) =>
    `<div class="tour-dot${i===_tourStep?" active":""}"></div>`).join("");

  // Prev/Next labels
  const prevBtn = document.getElementById("tourPrev");
  const nextBtn = document.getElementById("tourNext");
  prevBtn.style.visibility = _tourStep === 0 ? "hidden" : "visible";
  nextBtn.textContent = _tourStep === total-1 ? "Finish ✓" : "Next →";

  // Position card: prefer below the spotlight, flip if near bottom
  card.style.display = "block";
  const cardW = 300, cardH = 220;
  let cx, cy;
  if (step.sel) {
    const el = document.querySelector(step.sel);
    if (el) {
      const r   = el.getBoundingClientRect();
      cx = Math.min(r.left + r.width/2 - cardW/2, window.innerWidth - cardW - 16);
      cx = Math.max(cx, 16);
      cy = r.bottom + 14;
      if (cy + cardH > window.innerHeight - 20) cy = r.top - cardH - 14;
      if (cy < 10) cy = window.innerHeight/2 - cardH/2;
    }
  }
  if (!cx) { cx = window.innerWidth/2 - cardW/2; cy = window.innerHeight/2 - cardH/2; }
  card.style.left = `${Math.round(cx)}px`;
  card.style.top  = `${Math.round(cy)}px`;
}

function bindTour() {
  document.getElementById("btnTour")?.addEventListener("click", startTour);
  document.getElementById("tourSkip")?.addEventListener("click", endTour);
  document.getElementById("tourPrev")?.addEventListener("click", () => {
    if (_tourStep > 0) { _tourStep--; _renderTourStep(); }
  });
  document.getElementById("tourNext")?.addEventListener("click", () => {
    if (_tourStep < TOUR_STEPS.length - 1) { _tourStep++; _renderTourStep(); }
    else endTour();
  });
  // Click on overlay (outside card/spotlight) closes tour
  document.getElementById("tourOverlay")?.addEventListener("click", endTour);
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
// Safe JSON parse — if server returns HTML error page instead of JSON,
// this returns { success: false, error: "HTTP <status>" } instead of throwing.
async function _safeJson(r) {
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return { success: false, error: `HTTP ${r.status}: server returned non-JSON response` };
  }
  try { return await r.json(); }
  catch (e) { return { success: false, error: e.message }; }
}
async function apiFetch(url) {
  const r = await fetch(url, { headers: { "X-CSRFToken": csrf(), "Accept": "application/json" } });
  return _safeJson(r);
}
async function apiPost(url, data) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
    body: JSON.stringify(data),
  });
  return _safeJson(r);
}
async function apiFormPost(url, fd) {
  const r = await fetch(url, { method: "POST", headers: { "X-CSRFToken": csrf() }, body: fd });
  return _safeJson(r);
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
// GLOBAL TOOLTIP  (fixed-position singleton driven by data-tip)
// ─────────────────────────────────────────────────────────────────
function initGlobalTooltip() {
  const tip = document.getElementById("globalTooltip");
  if (!tip) return;

  let hideTimer = null;

  function showTip(el) {
    clearTimeout(hideTimer);
    const label  = el.dataset.tip    || "";
    const keyHint = el.dataset.tipKey || "";
    if (!label) return;

    tip.innerHTML = label + (keyHint ? `<kbd>${keyHint}</kbd>` : "");
    tip.classList.remove("visible");

    // Measure size off-screen before positioning
    tip.style.visibility = "hidden";
    tip.style.display    = "flex";
    const tipH  = tip.offsetHeight || 32;
    const tipWA = tip.offsetWidth  || 100;
    tip.style.display    = "";
    tip.style.visibility = "";

    // Position below (or above if near bottom edge)
    const rect = el.getBoundingClientRect();
    const gap  = 7;
    let left = rect.left + (rect.width / 2) - (tipWA / 2);
    let top  = rect.bottom + gap;

    // Clamp horizontally
    left = Math.max(6, Math.min(left, window.innerWidth - tipWA - 6));

    // If below screen bottom, place above
    if (top + tipH > window.innerHeight - 10) {
      top = rect.top - tipH - gap;
    }

    tip.style.left = left + "px";
    tip.style.top  = top  + "px";
    tip.classList.add("visible");
  }

  function hideTip() {
    hideTimer = setTimeout(() => tip.classList.remove("visible"), 80);
  }

  // Delegate to all current + future [data-tip] elements
  document.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (el) showTip(el);
  });
  document.addEventListener("mouseout", e => {
    const el = e.target.closest("[data-tip]");
    if (el) hideTip();
  });
  // Hide on scroll / resize to avoid stale positioning
  document.addEventListener("scroll", hideTip, true);
  window.addEventListener("resize", hideTip);
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
function setStatus(_msg, state) {
  // state: "pending" | "saving" | "saved" | "error" | ""
  const btn = document.getElementById("btnSave");
  if (!btn) return;
  btn.classList.remove("save-pending", "save-saving", "save-saved", "save-error");
  if (state === "saving") {
    btn.textContent = "↻";
    btn.classList.add("save-saving");
    btn.title = "Saving…";
  } else if (state === "saved") {
    btn.textContent = "✓";
    btn.classList.add("save-saved");
    btn.title = "All changes saved";
  } else if (state === "pending") {
    btn.textContent = "↻";
    btn.classList.add("save-pending");
    btn.title = "Unsaved changes";
  } else if (state === "error") {
    btn.textContent = "!";
    btn.classList.add("save-error");
    btn.title = "Save failed";
  } else {
    btn.textContent = "↻";
    btn.title = "Save (Ctrl+S)";
  }
}
function showEl(id) { const e = document.getElementById(id); if (e) e.style.display = "block"; }
function hideEl(id) { const e = document.getElementById(id); if (e) e.style.display = "none"; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
