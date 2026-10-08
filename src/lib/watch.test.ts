import { describe, expect, it } from "vitest";
import {
  WATCH_FAIL_MS,
  WATCH_RESEND_MS,
  addWatching,
  mosaicColumns,
  nextWatchAction,
  parseWatchVolumes,
  pruneWatching,
  removeWatching,
  setWatchVolume,
} from "./watch";

describe("watch list", () => {
  it("adds every live without dropping older ones", () => {
    expect(addWatching(["a"], "a")).toEqual(["a"]);
    expect(addWatching(["a"], "b")).toEqual(["a", "b"]);
    expect(addWatching(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(addWatching(["a", "b", "c"], "d")).toEqual(["a", "b", "c", "d"]);
  });

  it("removes and prunes ended lives", () => {
    expect(removeWatching(["a", "b"], "a")).toEqual(["b"]);
    expect(pruneWatching(["a", "b", "c"], ["b", "d"])).toEqual(["b"]);
  });

  it("decides what to do with a watch request that has no media yet", () => {
    expect(WATCH_RESEND_MS).toBe(10_000);
    expect(WATCH_FAIL_MS).toBe(20_000);
    expect(nextWatchAction(0, false, true)).toBe("idle");
    expect(nextWatchAction(25_000, true, true)).toBe("idle");
    expect(nextWatchAction(0, false, false)).toBe("wait");
    expect(nextWatchAction(9_999, false, false)).toBe("wait");
    expect(nextWatchAction(10_000, false, false)).toBe("resend");
    expect(nextWatchAction(10_000, true, false)).toBe("wait");
    expect(nextWatchAction(19_999, true, false)).toBe("wait");
    expect(nextWatchAction(20_000, true, false)).toBe("fail");
  });

  it("picks a mosaic that fits one to many lives", () => {
    expect(mosaicColumns(1)).toBe(1);
    expect(mosaicColumns(2)).toBe(2);
    expect(mosaicColumns(3)).toBe(2);
    expect(mosaicColumns(4)).toBe(2);
    expect(mosaicColumns(5)).toBe(3);
    expect(mosaicColumns(9)).toBe(3);
    expect(mosaicColumns(10)).toBe(4);
  });
});

describe("watch volumes", () => {
  it("keeps one volume per live without touching the others", () => {
    const volumes = setWatchVolume({ ana: 80, bia: 60 }, "ana", 20);
    expect(volumes).toEqual({ bia: 60, ana: 20 });
    expect(setWatchVolume(volumes, "caio", 140).caio).toBe(100);
    expect(setWatchVolume(volumes, "caio", -5).caio).toBe(0);
  });

  it("ignores broken stored volumes and forgets the oldest ones", () => {
    expect(parseWatchVolumes(null)).toEqual({});
    expect(parseWatchVolumes("{")).toEqual({});
    expect(parseWatchVolumes("[1,2]")).toEqual({});
    expect(parseWatchVolumes('{"ana":35,"bia":"alto","caio":-4}')).toEqual({ ana: 35, caio: 0 });

    let volumes: Record<string, number> = {};
    for (let index = 0; index < 60; index += 1) {
      volumes = setWatchVolume(volumes, `pessoa-${index}`, 50);
    }
    expect(Object.keys(volumes)).toHaveLength(50);
    expect(volumes["pessoa-0"]).toBeUndefined();
    expect(volumes["pessoa-59"]).toBe(50);
  });
});
