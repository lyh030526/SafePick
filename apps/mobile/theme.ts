// SafePick's own palette: a deep teal brand that also stands for "low concern", warm amber and red for the levels that
// need care, on a faintly green-grey canvas with white cards.
export const colors = {
  canvas: '#F4F7F6',
  card: '#FFFFFF',
  fill: '#EFF3F2',
  line: '#E3E9E7',
  text: '#13201D',
  textSub: '#475652',
  textMuted: '#82908C',
  textFaint: '#B3BEBA',
  brand: '#0D8A72',
  brandDeep: '#0A6B59',
  brandSoft: '#E3F4EF',
  brandText: '#08735F',
  ink: '#10302A',
  red: '#E5484D',
  redSoft: '#FDEDED',
  redText: '#C2373C',
  orange: '#F29D0B',
  orangeSoft: '#FFF4DE',
  orangeText: '#A35F00',
  green: '#0D8A72',
  greenSoft: '#E3F4EF',
  slate: '#6B7A76',
  slateSoft: '#EEF2F1',
};

export const radius = { card: 20, field: 14, button: 14, pill: 999 };
export const space = { page: 20, card: 18, gap: 12 };

// Soft lift for cards on the canvas; Android uses elevation.
export const shadow = {
  shadowColor: '#0B2A24', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1,
} as const;

export const type = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: -0.2 },
  small: { fontSize: 13, lineHeight: 19 },
} as const;

// The four concern levels, shared by the verdict, history rows and saved listings.
export const levels = {
  low: { color: colors.brand, soft: colors.brandSoft, text: colors.brandText, icon: 'shield-checkmark' },
  moderate: { color: colors.orange, soft: colors.orangeSoft, text: colors.orangeText, icon: 'alert-circle' },
  high: { color: colors.red, soft: colors.redSoft, text: colors.redText, icon: 'warning' },
  undetermined: { color: colors.slate, soft: colors.slateSoft, text: colors.textSub, icon: 'help-circle' },
} as const;

const fontStack = 'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

// react-native-web gives every Text its own font class, so the web font has to be forced once globally.
export function installWebFont() {
  if (typeof document === 'undefined' || document.getElementById('safepick-font')) return;
  const link = document.createElement('link');
  link.id = 'safepick-font';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';
  const style = document.createElement('style');
  // Icon glyphs carry their icon font inline and are left alone.
  style.textContent = `body, body *:not([style*="ionicons"]) { font-family: ${fontStack} !important; } body { background: ${colors.canvas}; }`;
  document.head.append(link, style);
}
