import { useEffect, useState } from "react";

export type RoomAmbientTheme = "morning" | "day" | "evening" | "night";

const MINUTE = 60 * 1000;

export function getRoomAmbientTheme(date = new Date()): RoomAmbientTheme {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function useRoomAmbientTheme() {
  const [theme, setTheme] = useState<RoomAmbientTheme>(() => getRoomAmbientTheme());

  useEffect(() => {
    const update = () => setTheme(getRoomAmbientTheme());
    update();

    const timer = window.setInterval(update, MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  return theme;
}
