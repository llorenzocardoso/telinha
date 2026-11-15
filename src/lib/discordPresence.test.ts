// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DISCORD_STATUS_KEY,
  buildDiscordPresence,
  readDiscordStatusMode,
  useDiscordStatusMode,
  writeDiscordStatusMode,
} from "./discordPresence";

const BASE = "https://telinha-server.onrender.com";

beforeEach(() => {
  localStorage.clear();
});

describe("discord status mode", () => {
  it("defaults to the invite button", () => {
    expect(readDiscordStatusMode()).toBe("link");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(DISCORD_STATUS_KEY, "everything");
    expect(readDiscordStatusMode()).toBe("link");
  });

  it("persists and notifies subscribers", () => {
    const { result } = renderHook(() => useDiscordStatusMode());
    expect(result.current).toBe("link");
    act(() => writeDiscordStatusMode("off"));
    expect(result.current).toBe("off");
    expect(localStorage.getItem(DISCORD_STATUS_KEY)).toBe("off");
  });
});

describe("buildDiscordPresence", () => {
  it("shows a watch button with the invite link while live", () => {
    expect(
      buildDiscordPresence({ mode: "link", code: "ABC123", live: true, since: 1_700_000_000_500, baseUrl: BASE }),
    ).toEqual({
      details: "Ao vivo no Telinha",
      buttonLabel: "Assistir no Telinha",
      buttonUrl: `${BASE}/j/ABC123`,
      startedAt: 1_700_000_000,
    });
  });

  it("offers to join the room when not live", () => {
    const presence = buildDiscordPresence({ mode: "link", code: "ABC123", live: false, since: null, baseUrl: `${BASE}/` });
    expect(presence).toEqual({
      details: "Numa sala do Telinha",
      buttonLabel: "Entrar na sala",
      buttonUrl: `${BASE}/j/ABC123`,
    });
  });

  it("never leaks the code in plain mode", () => {
    const presence = buildDiscordPresence({ mode: "plain", code: "ABC123", live: true, since: null, baseUrl: BASE });
    expect(presence).toEqual({ details: "Ao vivo no Telinha" });
    expect(JSON.stringify(presence)).not.toContain("ABC123");
  });

  it("clears the status when off", () => {
    expect(buildDiscordPresence({ mode: "off", code: "ABC123", live: true, since: null, baseUrl: BASE })).toBeNull();
  });

  it("drops the button for a non-https server", () => {
    const presence = buildDiscordPresence({
      mode: "link",
      code: "ABC123",
      live: true,
      since: null,
      baseUrl: "http://localhost:3001",
    });
    expect(presence).toEqual({ details: "Ao vivo no Telinha" });
  });
});
