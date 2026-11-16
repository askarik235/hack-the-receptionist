// The game's clock: the time in Dubai, where the company is, as "22:40". Shared by the taskbar
// and the phone's status bar.
import { useEffect, useState } from "react";

const dubaiTime = () =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date());

export function useDubaiTime() {
  const [time, setTime] = useState(dubaiTime);
  useEffect(() => {
    const timer = setInterval(() => setTime(dubaiTime()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return time;
}
