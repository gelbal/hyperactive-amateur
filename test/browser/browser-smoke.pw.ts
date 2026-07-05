// ABOUTME: Production-preview smoke tests for real browser APIs that jsdom cannot cover.
// ABOUTME: Uses mocked camera/recorder surfaces so the command needs no real device permission.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function installBrowserMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
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

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: SmokeMediaRecorder,
    });
  });
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

async function seedOneClipProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const silentWavBlob = () => {
      const sampleRate = 8_000;
      const sampleCount = 1_600;
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

    const audioBlob = silentWavBlob();
    const clipBlob = new Blob(["smoke video"], { type: "video/webm" });
    const steps = Array.from({ length: 16 }, (_, index) => index === 0);
    const project = {
      schemaVersion: 1,
      bpm: 90,
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
        clipBlob: id === 0 ? clipBlob : null,
        audioBlob: id === 0 ? audioBlob : null,
        posterBlob: null,
        trimStartMs: id === 0 ? 0 : 0,
        trimEndMs: id === 0 ? 200 : 0,
        durationMs: id === 0 ? 200 : 0,
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
  });

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

test("blocks keyboard playback while recording and suspends camera on hide", async ({
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
  await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { name: "recording countdown" })).toHaveCount(0);

  await hidePage(context, page);
  await expect(page.getByText(/Camera disconnected/i)).toBeVisible();
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
