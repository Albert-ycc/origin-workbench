import type { Room } from "@multica/core/types";

export const TEA_ROOM_COVER_THEMES = [
  "tea-room-cover-01",
  "tea-room-cover-02",
  "tea-room-cover-03",
  "tea-room-cover-04",
  "tea-room-cover-05",
  "tea-room-cover-06",
  "tea-room-cover-07",
  "tea-room-cover-08",
  "tea-room-cover-09",
  "tea-room-cover-10",
] as const;

export type TeaRoomCoverTheme = (typeof TEA_ROOM_COVER_THEMES)[number];

const coverUrls: Record<TeaRoomCoverTheme, string> = {
  "tea-room-cover-01": new URL("./assets/tea-room-cover-01.png", import.meta.url).href,
  "tea-room-cover-02": new URL("./assets/tea-room-cover-02.png", import.meta.url).href,
  "tea-room-cover-03": new URL("./assets/tea-room-cover-03.png", import.meta.url).href,
  "tea-room-cover-04": new URL("./assets/tea-room-cover-04.png", import.meta.url).href,
  "tea-room-cover-05": new URL("./assets/tea-room-cover-05.png", import.meta.url).href,
  "tea-room-cover-06": new URL("./assets/tea-room-cover-06.png", import.meta.url).href,
  "tea-room-cover-07": new URL("./assets/tea-room-cover-07.png", import.meta.url).href,
  "tea-room-cover-08": new URL("./assets/tea-room-cover-08.png", import.meta.url).href,
  "tea-room-cover-09": new URL("./assets/tea-room-cover-09.png", import.meta.url).href,
  "tea-room-cover-10": new URL("./assets/tea-room-cover-10.png", import.meta.url).href,
};

function isTeaRoomCoverTheme(value: string | null | undefined): value is TeaRoomCoverTheme {
  return TEA_ROOM_COVER_THEMES.includes(value as TeaRoomCoverTheme);
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function pickRandomTeaRoomCoverTheme(): TeaRoomCoverTheme {
  const index = Math.floor(Math.random() * TEA_ROOM_COVER_THEMES.length);
  return TEA_ROOM_COVER_THEMES[index] ?? TEA_ROOM_COVER_THEMES[0];
}

export function resolveTeaRoomCoverTheme(room: Pick<Room, "id" | "theme">): TeaRoomCoverTheme {
  if (isTeaRoomCoverTheme(room.theme)) return room.theme;
  const index = hashString(room.id) % TEA_ROOM_COVER_THEMES.length;
  return TEA_ROOM_COVER_THEMES[index] ?? TEA_ROOM_COVER_THEMES[0];
}

export function getTeaRoomCover(room: Pick<Room, "id" | "theme">) {
  const theme = resolveTeaRoomCoverTheme(room);
  return {
    theme,
    src: coverUrls[theme],
  };
}
