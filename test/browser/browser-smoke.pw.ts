// ABOUTME: Production-preview smoke tests for real browser APIs that jsdom cannot cover.
// ABOUTME: Uses mocked camera/recorder surfaces so the command needs no real device permission.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// `realRecorder` keeps the browser's own MediaRecorder for a real export.
async function installBrowserMocks(
  page: Page,
  { realRecorder = false }: { realRecorder?: boolean } = {},
): Promise<void> {
  await page.addInitScript(({ realRecorder }) => {
    function makeStream(): MediaStream {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      ctx?.fillRect(0, 0, 16, 16);
      const videoTrack = canvas.captureStream(1).getVideoTracks()[0];

      const AudioCtor =
        window.AudioContext ??
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      const audioContext = new AudioCtor();
      const destination = audioContext.createMediaStreamDestination();
      const oscillator = audioContext.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      const audioTrack = destination.stream.getAudioTracks()[0];

      return new MediaStream(
        [videoTrack, audioTrack].filter((track): track is MediaStreamTrack =>
          Boolean(track),
        ),
      );
    }

    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: async () => ({
          state: "prompt",
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => true,
        }),
      },
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => makeStream(),
        enumerateDevices: async () => [
          {
            deviceId: "smoke-camera",
            groupId: "smoke",
            kind: "videoinput",
            label: "Smoke Camera",
            toJSON: () => ({}),
          },
          {
            deviceId: "smoke-mic",
            groupId: "smoke",
            kind: "audioinput",
            label: "Smoke Mic",
            toJSON: () => ({}),
          },
        ],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });

    class SmokeMediaRecorder extends EventTarget {
      static isTypeSupported() {
        return true;
      }

      state: RecordingState = "inactive";
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;

      constructor(
        public stream: MediaStream,
        options: MediaRecorderOptions = {},
      ) {
        super();
        this.mimeType = options.mimeType ?? "video/webm";
      }

      start() {
        this.state = "recording";
        window.setTimeout(() => {
          const error = new Error("smoke encoder failed");
          this.state = "inactive";
          this.onerror?.({ error } as ErrorEvent);
          this.onstop?.(new Event("stop"));
        }, 0);
      }

      requestData() {
        const data = new Blob(["smoke"], { type: this.mimeType });
        this.ondataavailable?.({ data } as BlobEvent);
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.onstop?.(new Event("stop"));
      }
    }

    if (!realRecorder) {
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: SmokeMediaRecorder,
      });
    }
  }, { realRecorder });
}

async function waitForApp(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Hyperactive\s+Amateur/i }),
  ).toBeVisible();
  await expect(page.getByText("Loading project")).toHaveCount(0);
}

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are not available");
    }
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Timed out waiting for service-worker control")),
        7_000,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  });
}

// Seeds a saved project with clips on the first clipCount tracks (track 0
// tagged kick), then reloads so the app hydrates it. `faceClip` makes track 0
// a real 1.5 s WebM, recorded here with the browser's MediaRecorder: flat
// grey for its first 0.3 s, then a face, trimmed to 300–1400 ms, so its
// action frame (0.42 s) shows the face while the poster rehydrate makes at
// 0.1 s is blank; at 180 BPM on steps 1/5/9/13.
async function seedOneClipProject(
  page: Page,
  clipCount = 1,
  { faceClip = false }: { faceClip?: boolean } = {},
): Promise<void> {
  await page.evaluate(async ({ clipCount, faceClip }) => {
    const silentWavBlob = (seconds = 0.2) => {
      const sampleRate = 8_000;
      const sampleCount = Math.round(sampleRate * seconds);
      const buffer = new ArrayBuffer(44 + sampleCount * 2);
      const view = new DataView(buffer);
      const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) {
          view.setUint8(offset + i, value.charCodeAt(i));
        }
      };
      writeString(0, "RIFF");
      view.setUint32(4, 36 + sampleCount * 2, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, sampleCount * 2, true);
      return new Blob([buffer], { type: "audio/wav" });
    };

    const recordFaceClip = async (): Promise<Blob> => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const ellipse = (cx: number, cy: number, rx: number, ry: number, grey: number) => {
        ctx.fillStyle = `rgb(${grey}, ${grey}, ${grey})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      const paint = (showFace: boolean) => {
        ctx.fillStyle = "rgb(128, 128, 128)";
        ctx.fillRect(0, 0, 320, 240);
        if (!showFace) return;
        ellipse(160, 120, 44, 56, 30);
        // A face is shaded, brightest at its centre.
        const shading = ctx.createRadialGradient(160, 127, 0, 160, 127, 44);
        shading.addColorStop(0, "rgb(235, 235, 235)");
        shading.addColorStop(1, "rgb(200, 200, 200)");
        ctx.fillStyle = shading;
        ctx.beginPath();
        ctx.ellipse(160, 127, 34, 44, 0, 0, Math.PI * 2);
        ctx.fill();
        ellipse(148, 114, 4, 4, 40);
        ellipse(172, 114, 4, 4, 40);
      };
      paint(false);
      const recorder = new MediaRecorder(canvas.captureStream(30), {
        mimeType: "video/webm; codecs=vp8",
        videoBitsPerSecond: 4_000_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      await new Promise<void>((resolve) => {
        recorder.onstart = () => resolve();
        recorder.start();
      });
      const startedAt = performance.now();
      const timer = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        paint(elapsed >= 300);
        if (elapsed >= 1_550 && recorder.state === "recording") recorder.stop();
      }, 33);
      await stopped;
      window.clearInterval(timer);
      return new Blob(chunks, { type: "video/webm" });
    };

    const audioBlob = silentWavBlob(faceClip ? 1.5 : 0.2);
    const clipBlob = faceClip
      ? await recordFaceClip()
      : new Blob(["smoke video"], { type: "video/webm" });
    const steps = Array.from({ length: 16 }, (_, index) =>
      faceClip ? index % 4 === 0 : index === 0,
    );
    const project = {
      schemaVersion: 1,
      bpm: faceClip ? 180 : 90,
      swing: 0,
      cutSubdivision: "8n",
      sameTierHoldMs: 400,
      subgenre: "boom-bap",
      vibe: "tight",
      stepCount: 16,
      tagReasoning: {},
      updatedAt: Date.now(),
      tracks: Array.from({ length: 8 }, (_, id) => ({
        id,
        clipBlob: id < clipCount ? clipBlob : null,
        audioBlob: id < clipCount ? audioBlob : null,
        posterBlob: null,
        trimStartMs: faceClip && id === 0 ? 300 : 0,
        trimEndMs: faceClip && id === 0 ? 1_400 : id < clipCount ? 200 : 0,
        durationMs: faceClip && id === 0 ? 1_500 : id < clipCount ? 200 : 0,
        tag: id === 0 ? "kick" : null,
        steps: id === 0 ? steps : Array.from({ length: 16 }, () => false),
        volume: 1,
        muted: false,
        showVideo: true,
      })),
    };

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keyval");
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(project, "hyperactive-amateur-project");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      };
    });
  }, { clipCount, faceClip });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("trigger pads")).toBeVisible();
}

async function expectSeededProjectMigrated(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => {
    return new Promise<{
      hasLegacy: boolean;
      hasMeta: boolean;
      blobKeyCount: number;
      metaSchemaVersion: unknown;
    }>((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keyval", "readonly");
        const store = tx.objectStore("keyval");
        const keysRequest = store.getAllKeys();
        const metaRequest = store.get("ha:meta");
        tx.oncomplete = () => {
          const allKeys = keysRequest.result;
          const meta = metaRequest.result as { schemaVersion?: unknown } | undefined;
          db.close();
          resolve({
            hasLegacy: allKeys.includes("hyperactive-amateur-project"),
            hasMeta: allKeys.includes("ha:meta"),
            blobKeyCount: allKeys.filter(
              (key): key is string => typeof key === "string" && key.startsWith("ha:blob:"),
            ).length,
            metaSchemaVersion: meta?.schemaVersion,
          });
        };
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"));
      };
    });
  });

  expect(storage).toMatchObject({
    hasLegacy: false,
    hasMeta: true,
    blobKeyCount: 2,
    metaSchemaVersion: 2,
  });
  await expect(page.getByRole("button", { name: "track 1 step 1", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "tag kick for track 1" })).toHaveAttribute(
    "data-selected",
    "true",
  );
}

async function hidePage(context: BrowserContext, page: Page): Promise<void> {
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setPageVisibilityState", { visibilityState: "hidden" });
  } catch {
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
}

test("boots production app and reloads offline from the service worker", async ({
  page,
  context,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  await waitForApp(page);
  await expect(page.getByRole("button", { name: "Enable camera & mic" })).toBeVisible();
});

test("shows no transport before the first clip and suspends camera on hide", async ({
  page,
  context,
}) => {
  await installBrowserMocks(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  await page.getByRole("button", { name: "Enable camera & mic" }).click();
  await expect(page.getByText("Recording for Track 1")).toBeVisible();

  await page.getByRole("button", { name: "Record clip for track 1" }).click();
  await expect(page.getByRole("status", { name: "recording countdown" })).toBeVisible();
  await page.keyboard.press("Space");
  // Before the first clip there is no transport; the recording gate on
  // Space is covered by the useSpacebarPlayToggle unit tests.
  await expect(page.getByRole("button", { name: /playback/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { name: "recording countdown" })).toHaveCount(0);

  await hidePage(context, page);
  await expect(page.getByText(/Camera disconnected/i)).toBeVisible();
});

test("blocks keyboard playback during a recording countdown once Play exists", async ({ page }) => {
  await installBrowserMocks(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await seedOneClipProject(page);

  await page.getByRole("button", { name: "record clip for track 2", exact: true }).click();
  await expect(page.getByRole("status", { name: "recording countdown" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop playback" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { name: "recording countdown" })).toHaveCount(0);
});

test("surfaces export MediaRecorder failures without camera permission", async ({ page }) => {
  await installBrowserMocks(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await seedOneClipProject(page);
  await expectSeededProjectMigrated(page);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await expectSeededProjectMigrated(page);
  await page.context().setOffline(false);

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Export song" })).toBeVisible();
  await page.getByRole("button", { name: "Render" }).click();

  await expect(page.getByText("smoke encoder failed")).toBeVisible();
});

test("fills the controls row on a phone and stacks Play above it on desktop", async ({ page }) => {
  await installBrowserMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await seedOneClipProject(page, 4);

  const box = async (name: string | RegExp) => {
    const b = await page.getByRole("button", { name }).first().boundingBox();
    if (!b) throw new Error(`no box for ${String(name)}`);
    return b;
  };
  const feel = page.getByRole("button", { name: /^Feel:/ });
  const exportBox = await box("Export");
  const suggestBox = await box("Suggest a beat");
  // Edge to edge inside the 12 px gutters, one line, BPM on the phone.
  expect(Math.round(exportBox.x)).toBe(12);
  expect(Math.round(suggestBox.x + suggestBox.width)).toBe(390 - 12);
  expect(Math.round((await feel.boundingBox())!.y)).toBe(Math.round(exportBox.y));
  expect(Math.round(suggestBox.y)).toBe(Math.round(exportBox.y));
  // innerText: the cut · swing · hold tail is in the DOM but hidden below lg.
  await expect(feel).toHaveText(/^Feel\s*90 BPM$/, { useInnerText: true });
  // An empty pad names the kit voice it plays.
  await expect(page.getByRole("button", { name: "pad 5, thump" })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  const play = await box("Start playback");
  const exportDesktop = await box("Export");
  const suggestDesktop = await box("Suggest a beat");
  // Play sits above the controls, right edges aligned.
  expect(Math.round(exportDesktop.y - (play.y + play.height))).toBe(12);
  expect(Math.round(play.x + play.width)).toBe(Math.round(suggestDesktop.x + suggestDesktop.width));
});

test("deletes a clip to free its track for a drum, and changes an empty track's sound", async ({ page }) => {
  await installBrowserMocks(page);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await seedOneClipProject(page, 4);

  // Delete track 1's clip: tap the thumbnail, then Delete.
  await page.getByRole("button", { name: "clip actions for track 1" }).click();
  await page.getByRole("button", { name: "delete clip on track 1" }).click();
  await expect(page.getByRole("button", { name: "pad 1, kick" })).toBeVisible();
  // Three clips left: Suggest waits for four again; the station stays closed.
  await expect(page.getByRole("button", { name: "Suggest a beat" })).toHaveCount(0);
  await expect(page.getByText(/Recording for Track/)).toHaveCount(0);

  // Track 5 plays thump; one tap moves it to snare, and its pad follows.
  await page.getByRole("button", { name: "Change sound for track 5, now thump" }).click();
  await expect(page.getByRole("button", { name: "Change sound for track 5, now snare" })).toBeVisible();
  await expect(page.getByRole("button", { name: "pad 5, snare" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a real offline export opens on the cover and cuts on the downbeat", async ({ page }) => {
  test.setTimeout(60_000);
  await installBrowserMocks(page, { realRecorder: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await seedOneClipProject(page, 1, { faceClip: true });
  await waitForServiceWorkerControl(page);
  // Offline to the end: the export needs nothing from the network.
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await expect(page.getByLabel("trigger pads")).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("img", { name: "Cover preview" })).toBeVisible();
  await page.getByRole("button", { name: "Render" }).click();
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 30_000 });

  const events = await page.evaluate(() =>
    (window as unknown as { __haLogs: () => { event: string }[] }).__haLogs().map((e) => e.event),
  );
  expect(events).not.toContain("cover.failed");
  expect(events).not.toContain("cover.late");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save" }).click();
  const download = await downloading;
  await download.saveAs("test-results/cover-export.webm");

  const exported = await page.evaluate(async (url) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    document.body.appendChild(video);
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("the export did not decode"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const sample = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));

    // Frame 0 is drawable only after a seek (at loadeddata it reads black).
    video.currentTime = 0;
    await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
    ctx.drawImage(video, 0, 0, 480, 480);
    const paper = sample(8, 8);
    // Tile 0 (origin 16, 16): its ground, the hair band above the face, and
    // the face centre, each well inside one plate and clear of the name.
    const tile = { ground: sample(36, 36), hair: sample(124, 72), face: sample(124, 124) };

    const isPaper = ([r, g, b]: number[]) =>
      Math.abs(r - 0xf8) <= 12 && Math.abs(g - 0xf6) <= 12 && Math.abs(b - 0xf3) <= 12;
    const firstCut = await new Promise<number>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("the export never cut")), 8_000);
      const onFrame = (_now: number, frame: { mediaTime: number }) => {
        ctx.drawImage(video, 0, 0, 480, 480);
        if (!isPaper(sample(8, 8))) {
          window.clearTimeout(timeout);
          resolve(frame.mediaTime);
          return;
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      void video.play();
    });
    return { paper, tile, firstCut };
  }, download.url());

  const near = (actual: number[], hex: string, tolerance: number) =>
    [1, 3, 5].every(
      (at, channel) => Math.abs(actual[channel] - parseInt(hex.slice(at, at + 2), 16)) <= tolerance,
    );
  // Frame 0 is the card: paper in the margin, and tile 0 printed in slot 0's
  // cyan field, black ink and pink face. Only the action frame has a face:
  // the poster rehydrate makes at 0.1 s is blank and would print all field.
  expect(near(exported.paper, "#f8f6f3", 12)).toBe(true);
  expect(near(exported.tile.ground, "#22d3ee", 24)).toBe(true);
  expect(near(exported.tile.hair, "#09090b", 24)).toBe(true);
  expect(near(exported.tile.face, "#f9a8d4", 24)).toBe(true);
  // One silent beat at 180 BPM (0.33 s) plus the audio lookahead.
  expect(exported.firstCut).toBeGreaterThanOrEqual(0.25);
  expect(exported.firstCut).toBeLessThanOrEqual(0.9);
});
