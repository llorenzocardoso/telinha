import { describe, expect, it } from "vitest";
import { ShareAudience } from "./shareAudience";

describe("ShareAudience", () => {
  it("adds a viewer once and only updates the name on repeat", () => {
    const audience = new ShareAudience();
    expect(audience.add("v1", "Bia")).toBe("added");
    expect(audience.add("v1", "Beatriz")).toBe("updated");
    expect(audience.size).toBe(1);
    expect(audience.ids()).toEqual(["v1"]);
    expect(audience.names()).toEqual(["Beatriz"]);
  });

  it("removes viewers and reports whether they were present", () => {
    const audience = new ShareAudience();
    audience.add("v1", "Bia");
    audience.add("v2", "Caio");
    expect(audience.remove("v1")).toBe(true);
    expect(audience.remove("v1")).toBe(false);
    expect(audience.has("v1")).toBe(false);
    expect(audience.has("v2")).toBe(true);
    expect(audience.ids()).toEqual(["v2"]);
    expect(audience.names()).toEqual(["Caio"]);
    expect(audience.size).toBe(1);
  });

  it("clears every viewer", () => {
    const audience = new ShareAudience();
    audience.add("v1", "Bia");
    audience.add("v2", "Caio");
    audience.clear();
    expect(audience.size).toBe(0);
    expect(audience.ids()).toEqual([]);
    expect(audience.has("v2")).toBe(false);
  });
});
