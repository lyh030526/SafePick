// Flat fintech-style palette: grey canvas, white cards, one strong blue accent.
export const colors = {
  canvas: '#F2F4F6',
  card: '#FFFFFF',
  fill: '#F2F4F6',
  line: '#E5E8EB',
  text: '#191F28',
  textSub: '#4E5968',
  textMuted: '#8B95A1',
  textFaint: '#B0B8C1',
  blue: '#3182F6',
  blueSoft: '#E8F3FF',
  blueText: '#1B64DA',
  red: '#F04452',
  redSoft: '#FFEEEE',
  orange: '#FE9800',
  orangeSoft: '#FFF4E5',
  orangeText: '#C26B00',
  green: '#03B26C',
  greenSoft: '#E5F8EF',
};

export const radius = { card: 20, field: 14, button: 16, pill: 999 };

const fontStack = 'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

// react-native-web gives every Text its own font class, so the web font has to be forced once globally.
export function installWebFont() {
  if (typeof document === 'undefined' || document.getElementById('safepick-font')) return;
  const link = document.createElement('link');
  link.id = 'safepick-font';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';
  const style = document.createElement('style');
  style.textContent = `body, body * { font-family: ${fontStack} !important; } body { background: ${colors.canvas}; }`;
  document.head.append(link, style);
}
