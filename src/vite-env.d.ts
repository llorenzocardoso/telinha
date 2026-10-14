/// <reference types="vite/client" />

interface MediaStreamTrack {
  contentHint?: string;
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_NATIVE_SHARE?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
