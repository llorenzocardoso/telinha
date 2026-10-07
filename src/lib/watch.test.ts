import { describe, expect, it } from "vitest";
import {
  addWatching,
  mosaicColumns,
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

  it("keeps one volume per live without touching the others", () => {
    const volumes = setWatchVolume({ ana: 80, bia: 60 }, "ana", 20);
    expect(volumes).toEqual({ bia: 60, ana: 20 });
    expect(setWatchVolume(volumes, "caio", 140).caio).toBe(100);
  });

  it("ignores broken stored volumes and forgets the oldest ones", () => {
    expect(parseWatchVolumes(null)).toEqual({});
    expect(parseWatchVolumes("{")).toEqual({});
    expect(parseWatchVolumes('{"ana":35,"bia":"alto","caio":-4}')).toEqual({ ana: 35, caio: 0 });

    let volumes: Record<string, number> = {};
    for (let index = 0; index < 60; index += 1) {
      volumes = setWatchVolume(volumes, `pessoa-${index}`, 50);
    }
    expect(Object.keys(volumes)).toHaveLength(50);
    expect(volumes["pessoa-0"]).toBeUndefined();
    expect(volumes["pessoa-59"]).toBe(50);
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
