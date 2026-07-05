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
    onceTasks.push({ id, time, callback });
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

  const transport = {
    clear,
    scheduleOnce,
    scheduleRepeat,
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
      task.callback(fireTime ?? task.time);
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
      clear.mockClear();
      scheduleOnce.mockClear();
      scheduleRepeat.mockClear();
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
    draw,
    transport,
    createToneModule() {
      return {
        now: () => immediateTime + lookahead,
        immediate: () => immediateTime,
        getDraw: () => ({ schedule: drawSchedule }),
        getTransport: () => ({
          clear,
          scheduleOnce,
          scheduleRepeat,
        }),
      };
    },
  };
}
