export interface ScreenShareInfo {
  participantIdentity: string;
  participantName: string;
  stream: MediaStream | null;
}

export interface CameraFeedInfo {
  participantIdentity: string;
  participantName: string;
  stream: MediaStream;
  isLocal: boolean;
}

export interface RoomPerson {
  identity: string;
  name: string;
  isSharing: boolean;
  hasCamera: boolean;
  cameraStreamId?: string;
  isLocal: boolean;
  connected: boolean;
}
