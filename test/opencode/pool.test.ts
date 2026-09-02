import { describe, expect, test } from "bun:test";
import { lease, leasedServers, stopAll } from "../../src/opencode/pool.ts";
import type { OpenCodeServer, StartServerOptions } from "../../src/opencode/server.ts";

/** A server that records its own life without ever spawning a process. */
function fakeServer(url: string): OpenCodeServer & { stops: number } {
  const server = {
    url,
    stops: 0,
    stderr: () => "",
    stop() {
      server.stops += 1;
      return Promise.resolve();
    },
  };
  return server;
}

const OPTS: StartServerOptions = {
  bin: "opencode",
  hostname: "127.0.0.1",
  port: 0,
  cwd: "/w",
};

describe("server pool", () => {
  test("runs launched together share one server and stop it once", async () => {
    let starts = 0;
    const server = fakeServer("http://127.0.0.1:4096");
    const startFn = async () => {
      starts += 1;
      // Not instant, so the second lease arrives while the first is in flight —
      // the race a multi-agent launch actually creates.
      await Bun.sleep(5);
      return server;
    };

    const [a, b] = await Promise.all([lease(OPTS, { startFn }), lease(OPTS, { startFn })]);

    expect(starts).toBe(1);
    expect(a.url).toBe(b.url);
    expect(leasedServers()).toBe(1);

    await a.release();
    expect(server.stops).toBe(0);
    await b.release();
    expect(server.stops).toBe(1);
    expect(leasedServers()).toBe(0);
  });

  test("releasing twice does not stop the server twice", async () => {
    const server = fakeServer("http://127.0.0.1:4097");
    const one = await lease(OPTS, { startFn: () => Promise.resolve(server) });
    const two = await lease(OPTS, { startFn: () => Promise.resolve(server) });

    await one.release();
    await one.release();
    expect(server.stops).toBe(0);

    await two.release();
    expect(server.stops).toBe(1);
  });

  test("a different directory gets its own server", async () => {
    let starts = 0;
    const startFn = async (opts: StartServerOptions) => {
      starts += 1;
      return fakeServer(`http://127.0.0.1:0/${opts.cwd}`);
    };

    const here = await lease(OPTS, { startFn });
    const there = await lease({ ...OPTS, cwd: "/elsewhere" }, { startFn });

    expect(starts).toBe(2);
    expect(here.url).not.toBe(there.url);
    await here.release();
    await there.release();
  });

  test("a failed start is not cached, so the next launch may try again", async () => {
    let attempts = 0;
    const startFn = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("opencode is not on PATH");
      return fakeServer("http://127.0.0.1:4098");
    };

    await expect(lease(OPTS, { startFn })).rejects.toThrow("not on PATH");
    expect(leasedServers()).toBe(0);

    const second = await lease(OPTS, { startFn });
    expect(attempts).toBe(2);
    expect(second.url).toBe("http://127.0.0.1:4098");
    await second.release();
  });

  test("stopAll closes what is still held", async () => {
    const server = fakeServer("http://127.0.0.1:4099");
    await lease(OPTS, { startFn: () => Promise.resolve(server) });
    await stopAll();
    expect(server.stops).toBe(1);
    expect(leasedServers()).toBe(0);
  });
});
