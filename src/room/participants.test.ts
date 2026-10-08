import { describe, expect, it } from "vitest";
import { describeParticipants } from "./participants";
import type { RoomPerson } from "./types";

function person(identity: string, overrides: Partial<RoomPerson> = {}): RoomPerson {
  return {
    identity,
    name: identity.toUpperCase(),
    isSharing: false,
    hasCamera: false,
    isLocal: false,
    connected: true,
    ...overrides,
  };
}

function describe_(people: RoomPerson[], watching: string[] = [], watchers: string[] = []) {
  return describeParticipants({ people, localId: "me", watching, watchers });
}

describe("describeParticipants", () => {
  it("coloca a pessoa local primeiro, mesmo vindo no meio da sala", () => {
    const rows = describe_([
      person("ana"),
      person("me", { isLocal: true, name: "Eu" }),
      person("bia"),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["me", "ana", "bia"]);
  });

  it("marca a pessoa local como Você, e ao vivo quando transmite", () => {
    expect(describe_([person("me", { isLocal: true })])[0]?.status).toBe("Você");
    expect(describe_([person("me", { isLocal: true, isSharing: true })])[0]).toMatchObject({
      status: "Você · ao vivo",
      live: true,
      // Ninguém assiste a si mesmo.
      watchable: false,
    });
  });

  it("prefere Reconectando... a qualquer outro estado", () => {
    const [row] = describe_([person("ana", { isSharing: true, connected: false })]);
    expect(row?.status).toBe("Reconectando...");
    // Desconectada, não há o que assistir ainda.
    expect(row?.watchable).toBe(false);
    // O ponto vermelho continua: ela estava no ar.
    expect(row?.live).toBe(true);
  });

  it("diz Ao vivo para quem transmite e Assistindo para quem me assiste", () => {
    const rows = describe_(
      [person("ana", { isSharing: true }), person("bia")],
      [],
      ["bia"],
    );
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["ana", "Ao vivo"],
      ["bia", "Assistindo"],
    ]);
  });

  it("menciona a câmera de quem está só na sala", () => {
    expect(describe_([person("bia", { hasCamera: true })])[0]?.status).toBe("Na sala · câmera");
    // Quem já está ao vivo não precisa do detalhe da câmera.
    expect(describe_([person("bia", { hasCamera: true, isSharing: true })])[0]?.status).toBe(
      "Ao vivo",
    );
  });

  it("marca quem dá para assistir e quem eu já assisto", () => {
    const rows = describe_(
      [person("ana", { isSharing: true }), person("bia", { isSharing: true })],
      ["ana"],
    );
    expect(rows.map((row) => [row.id, row.watchable, row.watching])).toEqual([
      ["ana", true, true],
      ["bia", true, false],
    ]);
  });

  it("devolve lista vazia sem ninguém na sala", () => {
    expect(describe_([])).toEqual([]);
  });
});
