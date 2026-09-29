// ABOUTME: Canvas drawing styles and prebuilt name-surface helpers for Mood credits.
// ABOUTME: Keeps all five credit treatments allocation-free on the per-frame paint path.
import type {
  ActiveCreditEntry,
  ActiveCreditWindow,
  CreditPhase,
  MoodCreditPaletteValues,
  MoodCreditResources,
} from "./moodCredits";
import type { TileRect } from "./moodTilers";

const MASTHEAD_PAPER = "#fafafa";
const MASTHEAD_INK = "#09090b";

export const APP_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const SCRAWL_JITTER = [
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 0, y: 1 },
] as const;
const TRACK_IN_SLIVER_WIDTHS = [2, 3, 4] as const;
const TRACK_IN_HOLD_FLASH_SECONDS = 0.12;
const SNIPE_EXIT_FLASH_SECONDS = 2 / 30;

export const MIN_CREDIT_FONT_PX = 14;

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function easeInCubic(t: number): number {
  return t ** 3;
}

interface CreditStyleInput {
  ctx: CanvasRenderingContext2D;
  resources: MoodCreditResources;
  active: ActiveCreditWindow;
  entry: ActiveCreditEntry;
  phase: CreditPhase;
  audioTime: number;
  palette: MoodCreditPaletteValues;
}

interface CreditStyle {
  name: string;
  draw: (input: CreditStyleInput) => void;
}

export function fontSizeFor(rect: TileRect, name: string, heightRatio: number): number {
  const heightSize = rect.h * heightRatio;
  const widthSize = (rect.w * 0.84) / Math.max(1, name.length * 0.62);
  return Math.max(MIN_CREDIT_FONT_PX, Math.floor(Math.min(heightSize, widthSize)));
}

export function trackInFontSizeFor(
  rect: TileRect,
  name: string,
  heightRatio: number,
): number {
  const heightSize = rect.h * heightRatio;
  const widthSize = (rect.w * 0.84) / Math.max(1, name.length * 0.86);
  return Math.max(1, Math.floor(Math.min(heightSize, widthSize)));
}

function setCenteredText(
  ctx: CanvasRenderingContext2D,
  font: string,
): void {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

function drawCutout({ ctx, entry, phase, palette }: CreditStyleInput): void {
  const { rect, displayUpper: name } = entry;
  const fontSize = fontSizeFor(rect, name, 0.19);
  const barHeight = fontSize * 1.55;
  const barY = rect.y + rect.h * 0.68 - barHeight / 2;
  let offset = 0;
  if (phase.kind === "enter") {
    offset = (rect.w * 2) / 3 * (1 - easeOutCubic(phase.progress));
  } else if (phase.kind === "exit") {
    offset = (rect.w * 2) / 3 * easeInCubic(phase.progress);
  }

  ctx.fillStyle = palette.accent;
  ctx.fillRect(rect.x - offset, barY, rect.w, barHeight);
  setCenteredText(ctx, `900 ${fontSize}px ${APP_FONT_STACK}`);
  ctx.fillStyle = palette.ink;
  ctx.fillText(
    name,
    rect.x + rect.w / 2 - offset,
    rect.y + rect.h * 0.68,
    rect.w * 0.88,
  );
}

function drawScrawl({ ctx, active, entry, phase, audioTime, palette }: CreditStyleInput): void {
  const { rect, displayName: name } = entry;
  const { beatSeconds, windowStart } = active;
  const visibleCharacters =
    phase.kind === "enter"
      ? Math.min(name.length, Math.ceil(phase.progress * name.length))
      : phase.kind === "exit"
        ? Math.max(0, Math.ceil((1 - phase.progress) * name.length))
        : name.length;
  if (visibleCharacters === 0) return;
  const halfBeatIndex = Math.max(
    0,
    Math.floor((audioTime - windowStart) / (beatSeconds / 2)),
  );
  const jitter = SCRAWL_JITTER[halfBeatIndex % SCRAWL_JITTER.length];
  const fontSize = fontSizeFor(rect, name, 0.22);

  const visibleName = name.slice(0, visibleCharacters);
  const centerX = rect.x + rect.w / 2 + jitter.x;
  const centerY = rect.y + rect.h * 0.66 + jitter.y;
  setCenteredText(ctx, `700 ${fontSize}px ${APP_FONT_STACK}`);
  ctx.fillStyle = palette.ink;
  ctx.fillText(visibleName, centerX - 2, centerY - 2, rect.w * 0.88);
  ctx.fillText(visibleName, centerX + 2, centerY - 2, rect.w * 0.88);
  ctx.fillText(visibleName, centerX - 2, centerY + 2, rect.w * 0.88);
  ctx.fillText(visibleName, centerX + 2, centerY + 2, rect.w * 0.88);
  ctx.fillStyle = palette.paper;
  ctx.fillText(visibleName, centerX, centerY, rect.w * 0.88);
}

function drawTrackInSlivers(
  ctx: CanvasRenderingContext2D,
  resources: MoodCreditResources,
  entry: ActiveCreditEntry,
  visibleProgress: number,
): void {
  const revealWidth = Math.ceil(entry.nameBoundsW * visibleProgress);
  let offset = 0;
  let sliverIndex = 0;
  while (offset < revealWidth) {
    const width = Math.min(
      TRACK_IN_SLIVER_WIDTHS[sliverIndex % TRACK_IN_SLIVER_WIDTHS.length],
      revealWidth - offset,
    );
    const x = entry.nameBoundsX + offset;
    ctx.drawImage(
      resources.nameCanvas,
      x,
      entry.rect.y,
      width,
      entry.rect.h,
      x,
      entry.rect.y,
      width,
      entry.rect.h,
    );
    offset += width + 1;
    sliverIndex += 1;
  }
}

function drawTrackIn({ ctx, resources, active, entry, phase, palette }: CreditStyleInput): void {
  if (!resources.nameCtx) return;
  const { rect } = entry;
  const washAlpha = phase.kind === "exit" ? 0.4 * (1 - phase.progress) : 0.4;
  ctx.globalAlpha = washAlpha;
  ctx.fillStyle = palette.ink;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;

  if (phase.kind === "enter") {
    drawTrackInSlivers(ctx, resources, entry, phase.progress);
    return;
  }

  if (phase.kind === "exit") {
    drawTrackInSlivers(ctx, resources, entry, 1 - phase.progress);
    return;
  }

  const holdElapsedSeconds = phase.progress * (active.windowSeconds / 2);
  if (holdElapsedSeconds <= TRACK_IN_HOLD_FLASH_SECONDS + 1e-9) {
    ctx.fillStyle = palette.paper;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.drawImage(
    resources.nameCanvas,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
  );
}

function drawSnipe({ ctx, active, entry, phase, palette }: CreditStyleInput): void {
  const { rect, displayUpper } = entry;
  const { windowSeconds } = active;
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;

  if (phase.kind === "exit") {
    if (phase.progress * (windowSeconds / 4) <= SNIPE_EXIT_FLASH_SECONDS) {
      ctx.fillStyle = palette.flash;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    return;
  }

  if (phase.kind === "enter" && phase.progress < 0.5) {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const scale = phase.progress < 0.25 ? 1.12 : 1;
    const fontSize = fontSizeFor(rect, displayUpper, 0.23) * scale;
    setCenteredText(ctx, `900 ${fontSize}px ${APP_FONT_STACK}`);
    ctx.fillStyle = palette.ink;
    ctx.fillText(displayUpper, centerX, centerY, rect.w * 0.88);
    return;
  }

  const fontSize = fontSizeFor(rect, displayUpper, 0.2);
  setCenteredText(ctx, `900 ${fontSize}px ${APP_FONT_STACK}`);
  ctx.fillStyle = palette.ink;
  ctx.fillText(displayUpper, centerX - 2, centerY - 2, rect.w * 0.88);
  ctx.fillText(displayUpper, centerX + 2, centerY - 2, rect.w * 0.88);
  ctx.fillText(displayUpper, centerX - 2, centerY + 2, rect.w * 0.88);
  ctx.fillText(displayUpper, centerX + 2, centerY + 2, rect.w * 0.88);
  ctx.fillStyle = palette.paper;
  ctx.fillText(displayUpper, centerX, centerY, rect.w * 0.88);
}

// Masthead is deliberately palette-independent: the site's nameplate is
// black-on-white in every art direction, so it pins the literal inks.
function drawMasthead({ ctx, entry, phase }: CreditStyleInput): void {
  const { rect, displayUpper: name, mastheadFont } = entry;
  const fontSize = fontSizeFor(rect, name, 0.17);
  const bandH = fontSize * 1.9;
  let offsetY = 0;
  if (phase.kind === "enter") {
    offsetY = -(bandH * 2) / 3 * (1 - easeOutCubic(phase.progress));
  } else if (phase.kind === "exit") {
    offsetY = -(bandH * 2) / 3 * easeInCubic(phase.progress);
  }
  const bandY = rect.y + offsetY;

  ctx.save();
  ctx.fillStyle = MASTHEAD_PAPER;
  ctx.fillRect(rect.x, bandY, rect.w, bandH);
  ctx.fillStyle = MASTHEAD_INK;
  ctx.fillRect(rect.x, bandY + bandH - 7, rect.w, 2);
  ctx.fillRect(rect.x, bandY + bandH - 3, rect.w, 2);
  setCenteredText(ctx, mastheadFont);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${-0.025 * fontSize}px`;
  ctx.fillText(name, rect.x + rect.w / 2, bandY + bandH / 2 - 2, rect.w * 0.88);
  ctx.restore();
}

export const CREDIT_STYLES: readonly CreditStyle[] = [
  { name: "Cutout", draw: drawCutout },
  { name: "Scrawl", draw: drawScrawl },
  { name: "Track-In", draw: drawTrackIn },
  { name: "Snipe", draw: drawSnipe },
  { name: "Masthead", draw: drawMasthead },
] as const;

export function renderTrackInName(
  resources: MoodCreditResources,
  active: ActiveCreditWindow,
  entry: ActiveCreditEntry,
): void {
  const ctx = resources.nameCtx;
  if (!ctx) return;
  const { rect, displayUpper: name } = entry;
  const fontSize = trackInFontSizeFor(rect, name, 0.16);
  const characterWidth = fontSize * 0.58;
  const tracking = fontSize * 0.28;
  const totalWidth =
    characterWidth * name.length + tracking * Math.max(0, name.length - 1);
  let x = rect.x + (rect.w - totalWidth) / 2 + characterWidth / 2;
  entry.nameBoundsX = Math.max(rect.x, x - characterWidth / 2 - 2);
  entry.nameBoundsW = Math.min(rect.w, totalWidth + 4);
  ctx.font = `800 ${fontSize}px ${APP_FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const centerY = rect.y + rect.h * 0.64;
  for (const character of name) {
    ctx.fillStyle = active.palette.ink;
    ctx.fillText(character, x - 2, centerY - 2, characterWidth);
    ctx.fillText(character, x + 2, centerY - 2, characterWidth);
    ctx.fillText(character, x - 2, centerY + 2, characterWidth);
    ctx.fillText(character, x + 2, centerY + 2, characterWidth);
    ctx.fillStyle = active.palette.paper;
    ctx.fillText(character, x, centerY, characterWidth);
    x += characterWidth + tracking;
  }
}
