export interface ScreenShareInfo {
  participantIdentity: string;
  participantName: string;
  stream: MediaStream | null;
}

export interface RoomPerson {
  identity: string;
  name: string;
  isSharing: boolean;
  isLocal: boolean;
  connected: boolean;
}
