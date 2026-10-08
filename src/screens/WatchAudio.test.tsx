// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WatchAudio } from "./RoomScreen";

/**
 * Uma MediaStream de mentira que dispara addtrack/removetrack, como a de verdade faz quando
 * a renegociação traz a faixa de áudio depois da de vídeo.
 */
class FakeStream extends EventTarget {
  private tracks: MediaStreamTrack[] = [];

  constructor(tracks: MediaStreamTrack[] = []) {
    super();
    this.tracks = tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  addAudioTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
    this.dispatchEvent(new Event("addtrack"));
  }

  dropAudio() {
    this.tracks = this.tracks.filter((track) => track.kind !== "audio");
    this.dispatchEvent(new Event("removetrack"));
  }
}

const videoTrack = { kind: "video" } as MediaStreamTrack;
const audioTrack = { kind: "audio" } as MediaStreamTrack;

function asStream(stream: FakeStream): MediaStream {
  return stream as unknown as MediaStream;
}

const audioElements = () => document.querySelectorAll("audio");

afterEach(() => {
  cleanup();
  for (const element of audioElements()) element.remove();
});

// O construtor de MediaStream do jsdom não existe; o componente usa um para isolar o áudio.
vi.stubGlobal(
  "MediaStream",
  class {
    constructor(public tracks: MediaStreamTrack[] = []) {}
  },
);

describe("WatchAudio", () => {
  it("liga o som quando a faixa de áudio chega depois do vídeo", () => {
    // Era o defeito: o ontrack do vídeo vem primeiro, com o MESMO objeto MediaStream, e o
    // efeito dependia só da identidade da stream, então o áudio nunca criava o elemento.
    const stream = new FakeStream([videoTrack]);
    render(<WatchAudio stream={asStream(stream)} volume={80} />);
    expect(audioElements()).toHaveLength(0);

    stream.addAudioTrack(audioTrack);
    expect(audioElements()).toHaveLength(1);
    expect(audioElements()[0]!.volume).toBeCloseTo(0.8);
  });

  it("liga o som na hora quando a faixa já veio junto", () => {
    const stream = new FakeStream([videoTrack, audioTrack]);
    render(<WatchAudio stream={asStream(stream)} volume={100} />);
    expect(audioElements()).toHaveLength(1);
  });

  it("solta o elemento quando a faixa de áudio sai", () => {
    const stream = new FakeStream([videoTrack, audioTrack]);
    render(<WatchAudio stream={asStream(stream)} volume={50} />);
    expect(audioElements()).toHaveLength(1);

    stream.dropAudio();
    expect(audioElements()).toHaveLength(0);
  });

  it("aplica o volume de cada transmissão separadamente", () => {
    const ana = new FakeStream([audioTrack]);
    const bia = new FakeStream([audioTrack]);
    render(
      <>
        <WatchAudio stream={asStream(ana)} volume={20} />
        <WatchAudio stream={asStream(bia)} volume={90} />
      </>,
    );
    const volumes = [...audioElements()].map((element) => element.volume);
    expect(volumes).toHaveLength(2);
    expect(volumes.map((value) => Math.round(value * 100))).toEqual([20, 90]);
  });

  it("limpa o elemento ao desmontar", () => {
    const stream = new FakeStream([audioTrack]);
    const view = render(<WatchAudio stream={asStream(stream)} volume={70} />);
    expect(audioElements()).toHaveLength(1);
    view.unmount();
    expect(audioElements()).toHaveLength(0);
  });
});
