import { describe, expect, it } from "vitest";
import { buildScreenShares } from "./screenShares";
import type { RoomPerson } from "./types";

const stream = (label: string) => ({ label }) as unknown as MediaStream;

function person(identity: string, overrides: Partial<RoomPerson> = {}): RoomPerson {
  return {
    identity,
    name: identity.toUpperCase(),
    isSharing: false,
    isLocal: false,
    connected: true,
    ...overrides,
  };
}

function build(input: Partial<Parameters<typeof buildScreenShares>[0]>) {
  return buildScreenShares({
    localId: "me",
    people: [],
    remoteStreams: new Map(),
    localStream: null,
    localSharing: false,
    ...input,
  });
}

describe("buildScreenShares", () => {
  it("lists a sharing remote with a null stream until media arrives", () => {
    expect(build({ people: [person("ana", { isSharing: true })] })).toEqual([
      { participantIdentity: "ana", participantName: "ANA", stream: null },
    ]);
  });

  it("attaches the received stream to a sharing remote", () => {
    const received = stream("ana");
    expect(
      build({
        people: [person("ana", { isSharing: true })],
        remoteStreams: new Map([["ana", received]]),
      }),
    ).toEqual([{ participantIdentity: "ana", participantName: "ANA", stream: received }]);
  });

  it("drops a residual stream from someone who stopped sharing", () => {
    expect(
      build({
        people: [person("ana", { isSharing: false })],
        remoteStreams: new Map([["ana", stream("ana")]]),
      }),
    ).toEqual([]);
  });

  it("drops a residual stream from someone no longer in the room", () => {
    expect(build({ remoteStreams: new Map([["ghost", stream("ghost")]]) })).toEqual([]);
  });

  it("keeps a disconnected sharing remote listed with a null stream", () => {
    expect(
      build({ people: [person("ana", { isSharing: true, connected: false })] }),
    ).toEqual([{ participantIdentity: "ana", participantName: "ANA", stream: null }]);
  });

  it("adds the local entry only when sharing with a stream", () => {
    const local = stream("me");
    const me = person("me", { isLocal: true, isSharing: true, name: "Eu" });
    expect(build({ people: [me], localStream: local, localSharing: true })).toEqual([
      { participantIdentity: "me", participantName: "Eu", stream: local },
    ]);
    expect(build({ people: [me], localStream: null, localSharing: true })).toEqual([]);
    expect(build({ people: [me], localStream: local, localSharing: false })).toEqual([]);
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
    expect(result.map((share) => share.participantIdentity)).toEqual(["me", "bia", "ana"]);
  });
});
