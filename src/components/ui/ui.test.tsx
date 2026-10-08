// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AvatarStack, initialOf } from "./Avatar";
import { Button } from "./Button";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { Dialog } from "./Dialog";
import { Dock } from "./Dock";
import { IconButton } from "./IconButton";
import { LiveBadge, formatAirTime } from "./LiveBadge";
import { ParticipantList } from "./ParticipantList";
import { RoomCode } from "./RoomCode";
import { SegmentedControl } from "./SegmentedControl";
import { Switch } from "./Switch";

afterEach(cleanup);

describe("Button", () => {
  it("é um button mesmo sem type e mostra o atalho", () => {
    render(
      <Button variant="primary" shortcut="Ctrl+Shift+S">
        Compartilhar tela
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Compartilhar tela/ });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.textContent).toContain("Ctrl+Shift+S");
  });
});

describe("IconButton", () => {
  it("expõe o rótulo e o estado ligado", () => {
    render(<IconButton label="Ligar câmera" icon={<svg />} active={false} />);
    const button = screen.getByRole("button", { name: "Ligar câmera" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("data-tooltip")).toBe("Ligar câmera");
  });

  it("não publica aria-pressed quando não é um interruptor", () => {
    render(<IconButton label="Tela cheia" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Tela cheia" }).hasAttribute("aria-pressed")).toBe(
      false,
    );
  });
});

describe("SegmentedControl", () => {
  function Harness() {
    const [value, setValue] = useState(1080);
    return (
      <SegmentedControl
        label="Resolução"
        value={value}
        onChange={setValue}
        options={[
          { value: 720, label: "720p" },
          { value: 1080, label: "1080p" },
          { value: 1440, label: "1440p" },
        ]}
      />
    );
  }

  it("é um radiogroup com só a opção escolhida tabulável", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Resolução" })).toBeTruthy();
    const chosen = screen.getByRole("radio", { name: "1080p" });
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(chosen.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "720p" }).getAttribute("tabindex")).toBe("-1");
  });

  it("anda com as setas e volta ao início no fim", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Resolução" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "1440p" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "720p" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "1440p" }).getAttribute("aria-checked")).toBe("true");
  });

  it("pula a opção desabilitada", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Taxa de quadros"
        value={30}
        onChange={onChange}
        options={[
          { value: 15, label: "15 fps" },
          { value: 30, label: "30 fps" },
          { value: 60, label: "60 fps", disabled: true },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Taxa de quadros" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith(15);
  });
});

describe("Switch", () => {
  it("usa role switch e alterna no clique", () => {
    const onChange = vi.fn();
    render(
      <Switch
        label="Incluir som do computador"
        hint="Manda o áudio junto com a imagem"
        checked={false}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Incluir som do computador" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("não alterna quando desabilitado", () => {
    const onChange = vi.fn();
    render(<Switch label="Som" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Som" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Dialog", () => {
  it("é modal, prende o foco e fecha no Esc", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        title="Compartilhar tela"
        summary="1080p · 60 fps"
        onClose={onClose}
        footer={
          <>
            <Button>Cancelar</Button>
            <Button variant="primary">Escolher janela</Button>
          </>
        }
      >
        <Button>Equilibrado</Button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Compartilhar tela" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // O primeiro foco cai no primeiro elemento focável do painel.
    expect(document.activeElement?.textContent).toContain("Equilibrado");

    screen.getByRole("button", { name: /Escolher janela/ }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement?.textContent).toContain("Equilibrado");

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement?.textContent).toContain("Escolher janela");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dock", () => {
  it("é uma toolbar e segura os controles no hover", () => {
    const onHoldChange = vi.fn();
    render(
      <Dock label="Controles da transmissão" variant="floating" onHoldChange={onHoldChange}>
        <Button>Parar transmissão</Button>
      </Dock>,
    );
    const dock = screen.getByRole("toolbar", { name: "Controles da transmissão" });
    fireEvent.pointerEnter(dock);
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    // relatedTarget nulo (ponteiro saindo para fora) libera a dock.
    fireEvent.pointerLeave(dock, { relatedTarget: null });
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  // O ponteiro não serve para este caso: no jsdom o relatedTarget de pointerleave chega como
  // window, não como o elemento de destino. O foco chega certo, e é o caminho que importa para
  // quem usa teclado.
  it("não libera enquanto o foco anda entre os próprios botões", () => {
    const onHoldChange = vi.fn();
    render(
      <Dock label="Controles" variant="fixed" onHoldChange={onHoldChange}>
        <Button>Parar transmissão</Button>
        <Button>Sair</Button>
      </Dock>,
    );
    const [stop, leave] = screen.getAllByRole("button");
    fireEvent.focus(stop!);
    expect(onHoldChange).toHaveBeenLastCalledWith(true);

    fireEvent.focusOut(stop!, { relatedTarget: leave });
    expect(onHoldChange).not.toHaveBeenCalledWith(false);

    // Saindo da dock de vez, ela libera.
    fireEvent.focusOut(leave!, { relatedTarget: null });
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });
});

describe("RoomCode", () => {
  it("copia e dá o retorno no próprio botão", async () => {
    const onCopy = vi.fn().mockResolvedValue(true);
    render(<RoomCode code="K7P2QX" onCopy={onCopy} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar o código da sala K7P2QX" }));
    expect(onCopy).toHaveBeenCalled();
    expect(await screen.findByText("Copiado")).toBeTruthy();
  });

  it("avisa quando a cópia falha", async () => {
    render(<RoomCode code="K7P2QX" onCopy={() => false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Não deu")).toBeTruthy();
  });
});

describe("ConnectionIndicator", () => {
  it("fica fora da tela quando a conexão está boa", () => {
    render(<ConnectionIndicator quality="good" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("aparece quando a conexão não está boa", () => {
    render(<ConnectionIndicator quality="reconnecting" />);
    expect(screen.getByRole("status").textContent).toContain("Reconectando...");
  });

  it("pode ficar visível fora da tela Assistindo", () => {
    render(<ConnectionIndicator quality="good" alwaysVisible />);
    expect(screen.getByRole("status").textContent).toContain("Conectado");
  });
});

describe("ParticipantList", () => {
  it("lista cada pessoa com o estado curto", () => {
    render(
      <ParticipantList
        people={[
          { id: "a", name: "Lorenzo", status: "Você · ao vivo", live: true },
          { id: "b", name: "Ana", status: "Assistindo" },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: "Na sala · 2" })).toBeTruthy();
    expect(screen.getByText("Você · ao vivo")).toBeTruthy();
    expect(screen.getByText("Assistindo")).toBeTruthy();
  });
});

describe("AvatarStack", () => {
  it("resume o excedente e descreve quem está na sala", () => {
    render(
      <AvatarStack
        max={3}
        people={["Ana", "Bruno", "Caio", "Dani", "Edu"].map((name) => ({ id: name, name }))}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Na sala: Ana, Bruno, Caio, Dani e Edu",
    );
    expect(screen.getByText("+2")).toBeTruthy();
  });
});

describe("helpers de apresentação", () => {
  it("tira a inicial respeitando acento e emoji", () => {
    expect(initialOf("ana")).toBe("A");
    expect(initialOf("  édu")).toBe("É");
    expect(initialOf("🙂 oi")).toBe("🙂");
    expect(initialOf("")).toBe("?");
  });

  it("formata o tempo no ar", () => {
    expect(formatAirTime(0)).toBe("0:00");
    expect(formatAirTime(-5)).toBe("0:00");
    expect(formatAirTime(768_000)).toBe("12:48");
    expect(formatAirTime(3_723_000)).toBe("1:02:03");
  });

  it("mostra o selo só com o texto quando não há tempo", () => {
    render(<LiveBadge />);
    expect(screen.getByText("Ao vivo")).toBeTruthy();
  });
});
