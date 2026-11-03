// A share from another app (the Coupang app's 공유 → SafePick) opens SafePick at safepick://dataUrl=…, which is no
// screen. It is sent home instead, where the shared link is picked up (see SharedLink in _layout.tsx).
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return path.includes('dataUrl=') ? '/' : path;
  } catch {
    return '/';
  }
}
