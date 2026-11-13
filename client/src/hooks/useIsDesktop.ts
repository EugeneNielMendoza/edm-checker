import { useEffect, useState } from "react";

// Matches the `md:` breakpoint in tailwind.config.js (901px and up).
const QUERY = "(min-width: 901px)";

/** True on desktop-width screens; updates when the window is resized. */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = () => setIsDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isDesktop;
}
