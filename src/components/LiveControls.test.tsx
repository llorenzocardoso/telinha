// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LiveControls } from "./LiveControls";

afterEach(cleanup);

function renderControls(volumes: { id: string; name?: string }[], isSharing = false, onSwitchShare = vi.fn()) {
  return render(
    <LiveControls
      volumes={volumes.map((item) => ({ ...item, volume: 80, onChange: vi.fn() }))}
      choices={[]}
      fullscreen={false}
      connected
      isSharing={isSharing}
      cameraOn={false}
      cameraReady
      cameraLabel="Ligar câmera"
      sideBySide={volumes.length > 1}
      onWatchOnly={vi.fn()}
      onWatchAll={vi.fn()}
      onToggleFullscreen={vi.fn()}
      onToggleShare={vi.fn()}
      onSwitchShare={onSwitchShare}
      onToggleCamera={vi.fn()}
      onStopWatching={vi.fn()}
      onLeaveRoom={vi.fn()}
      onLockChange={vi.fn()}
    />,
  );
}

describe("LiveControls", () => {
  it("só oferece trocar o que compartilha enquanto se transmite", () => {
    const onSwitchShare = vi.fn();
    renderControls([], false, onSwitchShare);
    expect(screen.queryByRole("button", { name: "Trocar o que compartilha" })).toBeNull();
    cleanup();
    renderControls([], true, onSwitchShare);
    fireEvent.click(screen.getByRole("button", { name: "Trocar o que compartilha" }));
    expect(onSwitchShare).toHaveBeenCalledOnce();
  });

  it("com duas lives, os volumes ficam compactos e com o nome de cada uma", () => {
    const { container } = renderControls([
      { id: "a", name: "Ana" },
      { id: "b", name: "Bia" },
    ]);
    expect(container.querySelector(".watch-volumes.is-multi")).not.toBeNull();
    expect([...container.querySelectorAll(".watch-volume-caption")].map((n) => n.textContent)).toEqual([
      "Ana",
      "Bia",
    ]);
  });

  it("com uma live só, o volume não ganha legenda nem o modo compacto", () => {
    const { container } = renderControls([{ id: "a" }]);
    expect(container.querySelector(".watch-volumes.is-multi")).toBeNull();
    expect(container.querySelector(".watch-volume-caption")).toBeNull();
  });

  it("o botão de transmitir também não tem destaque próprio", () => {
    renderControls([{ id: "a" }]);
    const share = screen.getByRole("button", { name: "Transmitir também" });
    expect(share.className).not.toContain("is-tonal");
    expect(share.className).not.toContain("is-active");
  });
});
