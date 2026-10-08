import { describe, expect, it } from "vitest";
import { buildScreenShares } from "./screenShares";
import type { RoomPerson } from "./types";

const stream = (label: string) => ({ label, id: label }) as unknown as MediaStream;

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

/** Monta o mapa `par -> streamId -> stream` esperado pelo builder. */
function received(entries: Record<string, MediaStream[]>): Map<string, Map<string, MediaStream>> {
  return new Map(
    Object.entries(entries).map(([peerId, streams]) => [
      peerId,
      new Map(streams.map((item) => [item.id, item])),
    ]),
  );
}

function build(input: Partial<Parameters<typeof buildScreenShares>[0]>) {
  return buildScreenShares({
    localId: "me",
    people: [],
    remoteStreams: new Map(),
    localStream: null,
    localSharing: false,
    localCamera: null,
    ...input,
  });
}

describe("buildScreenShares", () => {
  it("lists a sharing remote with a null stream until media arrives", () => {
    expect(build({ people: [person("ana", { isSharing: true })] }).shares).toEqual([
      { participantIdentity: "ana", participantName: "ANA", stream: null },
    ]);
  });

  it("attaches the received stream to a sharing remote", () => {
    const screen = stream("ana");
    expect(
      build({
        people: [person("ana", { isSharing: true })],
        remoteStreams: received({ ana: [screen] }),
      }).shares,
    ).toEqual([{ participantIdentity: "ana", participantName: "ANA", stream: screen }]);
  });

  it("drops a residual stream from someone who stopped sharing", () => {
    expect(
      build({
        people: [person("ana", { isSharing: false })],
        remoteStreams: received({ ana: [stream("ana")] }),
      }).shares,
    ).toEqual([]);
  });

  it("drops a residual stream from someone no longer in the room", () => {
    expect(build({ remoteStreams: received({ ghost: [stream("ghost")] }) }).shares).toEqual([]);
  });

  it("keeps a disconnected sharing remote listed with a null stream", () => {
    expect(
      build({ people: [person("ana", { isSharing: true, connected: false })] }).shares,
    ).toEqual([{ participantIdentity: "ana", participantName: "ANA", stream: null }]);
  });

  it("adds the local entry only when sharing with a stream", () => {
    const local = stream("me");
    const me = person("me", { isLocal: true, isSharing: true, name: "Eu" });
    expect(build({ people: [me], localStream: local, localSharing: true }).shares).toEqual([
      { participantIdentity: "me", participantName: "Eu", stream: local },
    ]);
    expect(build({ people: [me], localStream: null, localSharing: true }).shares).toEqual([]);
    expect(build({ people: [me], localStream: local, localSharing: false }).shares).toEqual([]);
  });

  it("lists the local share first, then remotes in people order", () => {
    const local = stream("me");
    const result = build({
      people: [
        person("bia", { isSharing: true }),
        person("me", { isLocal: true, isSharing: true, name: "Eu" }),
        person("ana", { isSharing: true }),
      ],
      localStream: local,
      localSharing: true,
    });
    expect(result.shares.map((share) => share.participantIdentity)).toEqual(["me", "bia", "ana"]);
  });

  it("separates the camera from the screen of the same person", () => {
    const screen = stream("ana-screen");
    const camera = stream("ana-camera");
    const result = build({
      people: [
        person("ana", { isSharing: true, hasCamera: true, cameraStreamId: camera.id }),
      ],
      remoteStreams: received({ ana: [screen, camera] }),
    });
    expect(result.shares).toEqual([
      { participantIdentity: "ana", participantName: "ANA", stream: screen },
    ]);
    expect(result.cameras).toEqual([
      { participantIdentity: "ana", participantName: "ANA", stream: camera, isLocal: false },
    ]);
  });

  it("lists a camera without a screen share", () => {
    const camera = stream("bia-camera");
    const result = build({
      people: [person("bia", { hasCamera: true, cameraStreamId: camera.id })],
      remoteStreams: received({ bia: [camera] }),
    });
    expect(result.shares).toEqual([]);
    expect(result.cameras.map((feed) => feed.participantIdentity)).toEqual(["bia"]);
  });

  it("ignores an announced camera whose stream has not arrived", () => {
    const result = build({
      people: [person("bia", { hasCamera: true, cameraStreamId: "bia-camera" })],
    });
    expect(result.cameras).toEqual([]);
  });

  it("lists the local camera first and marks it as local", () => {
    const mine = stream("my-camera");
    const theirs = stream("ana-camera");
    const result = build({
      people: [
        person("ana", { hasCamera: true, cameraStreamId: theirs.id }),
        person("me", { isLocal: true, name: "Eu" }),
      ],
      remoteStreams: received({ ana: [theirs] }),
      localCamera: mine,
    });
    expect(result.cameras.map((feed) => [feed.participantIdentity, feed.isLocal])).toEqual([
      ["me", true],
      ["ana", false],
    ]);
  });
});
