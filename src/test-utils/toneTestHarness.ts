// ABOUTME: Shared Tone.js test harness with controllable audio time and schedulers.
// ABOUTME: Lets tests capture Transport callbacks and advance Draw work deterministically.
import { vi } from "vitest";

type DrawCallback = () => void;
type TransportCallback = (time: number) => void;

type DrawTask = {
  id: number;
  order: number;
  time: number;
  callback: DrawCallback;
};

type OnceTask = {
  id: number;
  time: number;
  absoluteTime: number;
  callback: TransportCallback;
};

type RepeatTask = {
  id: number;
  interval: number | string;
  startTime?: number | string;
  callback: TransportCallback;
};

function findByIdOrIndex<T extends { id: number }>(tasks: T[], idOrIndex: number): T {
  return tasks.find((task) => task.id === idOrIndex) ?? tasks[idOrIndex];
}

export function createToneHarness() {
  let immediateTime = 0;
  let lookahead = 0.1;
  let transportPosition: number | string = 0;
  let transportSeconds = 0;
  let transportSwing = 0;
  let nextId = 1;
  let nextOrder = 1;
  const drawTasks: DrawTask[] = [];
  const onceTasks: OnceTask[] = [];
  const repeatTasks: RepeatTask[] = [];

  const drawSchedule = vi.fn((callback: DrawCallback, time: number) => {
    const id = nextId++;
    drawTasks.push({ id, order: nextOrder++, time, callback });
    return id;
  });

  const runDueDrawTasks = (targetTime: number) => {
    while (true) {
      const due = drawTasks
        .map((task, index) => ({ task, index }))
        .filter(({ task }) => task.time <= targetTime)
        .sort((a, b) => a.task.time - b.task.time || a.task.order - b.task.order)[0];
      if (!due) return;

      drawTasks.splice(due.index, 1);
      due.task.callback();
    }
  };

  const scheduleOnce = vi.fn((callback: TransportCallback, time: number) => {
    const id = nextId++;
    const absoluteTime = immediateTime + (time - transportSeconds);
    onceTasks.push({ id, time, absoluteTime, callback });
    return id;
  });

  const scheduleRepeat = vi.fn(
    (callback: TransportCallback, interval: number | string, startTime?: number | string) => {
      const id = nextId++;
      repeatTasks.push({ id, interval, startTime, callback });
      return id;
    },
  );

  const clear = vi.fn((eventId: number) => {
    const removeId = (task: { id: number }) => task.id !== eventId;
    const drawCount = drawTasks.length;
    const onceCount = onceTasks.length;
    const repeatCount = repeatTasks.length;
    drawTasks.splice(0, drawTasks.length, ...drawTasks.filter(removeId));
    onceTasks.splice(0, onceTasks.length, ...onceTasks.filter(removeId));
    repeatTasks.splice(0, repeatTasks.length, ...repeatTasks.filter(removeId));
    return (
      drawTasks.length !== drawCount ||
      onceTasks.length !== onceCount ||
      repeatTasks.length !== repeatCount
    );
  });

  const start = vi.fn(async () => undefined);
  // A stopped transport's position does not advance, so only a running one
  // reads a lookahead ahead of the audible clock.
  let transportRunning = false;
  const secondsLead = () => (transportRunning ? lookahead : 0);
  const transportStart = vi.fn(() => {
    transportRunning = true;
  });
  const transportStop = vi.fn(() => {
    transportRunning = false;
  });

  const transport = {
    clear,
    scheduleOnce,
    scheduleRepeat,
    start: transportStart,
    stop: transportStop,
    get position() {
      return transportPosition;
    },
    set position(value: number | string) {
      transportPosition = value;
    },
    // As in Tone, `seconds` reads a running transport on the lookahead clock
    // (Tone.now()); transportSeconds is its position at the audible clock.
    get seconds() {
      return transportSeconds + secondsLead();
    },
    set seconds(value: number) {
      transportSeconds = value - secondsLead();
    },
    // Transport seconds at an audio-clock time, so
    // scheduleOnce(cb, getSecondsAtTime(t)) fires at t.
    getSecondsAtTime: (time: number) => transportSeconds + (time - immediateTime),
    get swing() {
      return transportSwing;
    },
    set swing(value: number) {
      transportSwing = value;
    },
    get onceCallbacks() {
      return onceTasks.map((task) => task.callback);
    },
    get repeatCallbacks() {
      return repeatTasks.map((task) => task.callback);
    },
    fireOnce(idOrIndex: number, fireTime?: number) {
      const task = findByIdOrIndex(onceTasks, idOrIndex);
      if (!task) {
        throw new Error(`No captured Transport.scheduleOnce task for ${idOrIndex}`);
      }
      onceTasks.splice(onceTasks.indexOf(task), 1);
      task.callback(fireTime ?? task.absoluteTime);
    },
    fireRepeat(idOrIndex: number, fireTime: number) {
      const task = findByIdOrIndex(repeatTasks, idOrIndex);
      if (!task) {
        throw new Error(`No captured Transport.scheduleRepeat task for ${idOrIndex}`);
      }
      task.callback(fireTime);
    },
    reset() {
      onceTasks.length = 0;
      repeatTasks.length = 0;
      transportPosition = 0;
      transportSwing = 0;
      transportSeconds = 0;
      transportRunning = false;
      clear.mockClear();
      scheduleOnce.mockClear();
      scheduleRepeat.mockClear();
      transportStart.mockClear();
      transportStop.mockClear();
    },
  };

  const draw = {
    schedule: drawSchedule,
    advanceTo(time: number) {
      immediateTime = time;
      runDueDrawTasks(time);
    },
    pendingTimes() {
      return drawTasks.map((task) => task.time).sort((a, b) => a - b);
    },
    reset() {
      drawTasks.length = 0;
      drawSchedule.mockClear();
    },
  };

  return {
    setNow(time: number) {
      immediateTime = time;
    },
    setImmediate(time: number) {
      immediateTime = time;
    },
    setLookahead(seconds: number) {
      lookahead = seconds;
    },
    start,
    draw,
    transport,
    createToneModule() {
      return {
        start,
        now: () => immediateTime + lookahead,
        immediate: () => immediateTime,
        getDraw: () => ({ schedule: drawSchedule }),
        getTransport: () => ({
          clear,
          scheduleOnce,
          scheduleRepeat,
          start: transportStart,
          stop: transportStop,
          get position() {
            return transportPosition;
          },
          set position(value: number | string) {
            transportPosition = value;
          },
          get seconds() {
            return transportSeconds + secondsLead();
          },
          set seconds(value: number) {
            transportSeconds = value - secondsLead();
          },
          getSecondsAtTime: (time: number) => transportSeconds + (time - immediateTime),
          get swing() {
            return transportSwing;
          },
          set swing(value: number) {
            transportSwing = value;
          },
        }),
      };
    },
  };
}
