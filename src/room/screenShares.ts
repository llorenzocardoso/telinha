import type { RoomPerson, ScreenShareInfo } from "./types";

interface ScreenSharesInput {
  localId: string;
  people: Iterable<RoomPerson>;
  remoteStreams: ReadonlyMap<string, MediaStream>;
  localStream: MediaStream | null;
  localSharing: boolean;
}

export function buildScreenShares(input: ScreenSharesInput): ScreenShareInfo[] {
  let local: ScreenShareInfo | null = null;
  const remotes: ScreenShareInfo[] = [];
  for (const person of input.people) {
    if (person.identity === input.localId) {
      if (input.localStream && input.localSharing) {
        local = {
          participantIdentity: person.identity,
          participantName: person.name,
          stream: input.localStream,
        };
      }
    } else if (person.isSharing) {
      remotes.push({
        participantIdentity: person.identity,
        participantName: person.name,
        stream: input.remoteStreams.get(person.identity) ?? null,
      });
    }
  }
  return local ? [local, ...remotes] : remotes;
}
