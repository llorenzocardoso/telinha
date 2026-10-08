import type { CameraFeedInfo, RoomPerson, ScreenShareInfo } from "./types";

interface ScreenSharesInput {
  localId: string;
  people: Iterable<RoomPerson>;
  /** Por par, as streams recebidas indexadas pelo id da stream (tela e câmera convivem). */
  remoteStreams: ReadonlyMap<string, ReadonlyMap<string, MediaStream>>;
  localStream: MediaStream | null;
  localSharing: boolean;
  localCamera: MediaStream | null;
}

export interface RoomMedia {
  shares: ScreenShareInfo[];
  cameras: CameraFeedInfo[];
}

export function buildScreenShares(input: ScreenSharesInput): RoomMedia {
  let localShare: ScreenShareInfo | null = null;
  let localCamera: CameraFeedInfo | null = null;
  const shares: ScreenShareInfo[] = [];
  const cameras: CameraFeedInfo[] = [];

  for (const person of input.people) {
    if (person.identity === input.localId) {
      if (input.localStream && input.localSharing) {
        localShare = {
          participantIdentity: person.identity,
          participantName: person.name,
          stream: input.localStream,
        };
      }
      if (input.localCamera) {
        localCamera = {
          participantIdentity: person.identity,
          participantName: person.name,
          stream: input.localCamera,
          isLocal: true,
        };
      }
      continue;
    }

    const streams = input.remoteStreams.get(person.identity);
    if (person.isSharing) {
      shares.push({
        participantIdentity: person.identity,
        participantName: person.name,
        stream: findScreen(streams, person.cameraStreamId),
      });
    }
    if (person.hasCamera && person.cameraStreamId) {
      const stream = streams?.get(person.cameraStreamId);
      if (stream) {
        cameras.push({
          participantIdentity: person.identity,
          participantName: person.name,
          stream,
          isLocal: false,
        });
      }
    }
  }

  return {
    shares: localShare ? [localShare, ...shares] : shares,
    cameras: localCamera ? [localCamera, ...cameras] : cameras,
  };
}

function findScreen(
  streams: ReadonlyMap<string, MediaStream> | undefined,
  cameraStreamId: string | undefined,
): MediaStream | null {
  if (!streams) return null;
  for (const [id, stream] of streams) {
    if (id !== cameraStreamId) return stream;
  }
  return null;
}
