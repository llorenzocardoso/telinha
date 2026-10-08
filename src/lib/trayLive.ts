import { API_URL } from "./api";

export function inviteLink(code: string, baseUrl: string = API_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}/j/${code}`;
}
