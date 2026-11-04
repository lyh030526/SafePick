import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, levels, radius, shadow, type } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'brand';

// Decorative: hidden from screen readers so a button is read by its label alone.
export function Icon({ name, size = 20, color = colors.textSub }: { name: IconName; size?: number; color?: string }) {
  return <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Ionicons name={name} size={size} color={color} />
  </View>;
}

export function CheckCircle({ checked }: { checked: boolean }) {
  return <View style={[styles.check, checked && styles.checked]}>
    {checked ? <Icon name="checkmark" size={15} color="#FFFFFF" /> : null}
  </View>;
}

export function Card({ children, style, tight = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; tight?: boolean }) {
  return <View style={[styles.card, tight && styles.cardTight, style]}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return <View style={styles.sectionRow}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>
    {action}
  </View>;
}

export function Button({ label, onPress, tone = 'primary', icon, disabled = false, busy = false, accessibilityLabel }: {
  label: string; onPress: () => void; tone?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName;
  disabled?: boolean; busy?: boolean; accessibilityLabel?: string;
}) {
  const color = buttonText[tone].color;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: disabled || busy }}
    disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, buttonStyles[tone], pressed && styles.pressed, (disabled || busy) && styles.disabled]}>
    {busy ? <ActivityIndicator color={color} /> : icon ? <Icon name={icon} size={19} color={color} /> : null}
    <Text style={[styles.buttonText, buttonText[tone]]}>{label}</Text>
  </Pressable>;
}

const toneColors: Record<Tone, { soft: string; text: string; dot: string }> = {
  good: { soft: colors.brandSoft, text: colors.brandText, dot: colors.brand },
  brand: { soft: colors.brandSoft, text: colors.brandText, dot: colors.brand },
  warn: { soft: colors.orangeSoft, text: colors.orangeText, dot: colors.orange },
  bad: { soft: colors.redSoft, text: colors.redText, dot: colors.red },
  neutral: { soft: colors.slateSoft, text: colors.textSub, dot: colors.textFaint },
};

export function Pill({ label, tone = 'neutral', dot = false }: { label: string; tone?: Tone; dot?: boolean }) {
  const toneColor = toneColors[tone];
  return <View style={[styles.pill, { backgroundColor: toneColor.soft }]}>
    {dot ? <View style={[styles.dot, { backgroundColor: toneColor.dot }]} /> : null}
    <Text style={[styles.pillText, { color: toneColor.text }]}>{label}</Text>
  </View>;
}

export function LevelDot({ level }: { level: keyof typeof levels }) {
  return <View style={[styles.levelDot, { backgroundColor: levels[level].soft }]}>
    <Icon name={levels[level].icon} size={18} color={levels[level].color} />
  </View>;
}

// A tappable row: icon, title and subtitle, and a value or chevron on the right.
export function ListRow({ icon, iconColor = colors.brand, title, subtitle, right, onPress, danger = false, accessibilityLabel }: {
  icon?: IconName; iconColor?: string; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void;
  danger?: boolean; accessibilityLabel?: string;
}) {
  const body = <>
    {icon ? <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
      <Icon name={icon} size={19} color={danger ? colors.red : iconColor} />
    </View> : null}
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]}>{title}</Text>
      {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
    </View>
    {right}
    {onPress ? <Icon name="chevron-forward" size={18} color={colors.textFaint} /> : null}
  </>;
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>{body}</Pressable>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

// A row that opens to show its details: the verdict on each check stays visible while the evidence is folded away.
export function Disclosure({ title, icon, status, tone = 'neutral', open: controlled, onToggle, defaultOpen = false, children,
  accessibilityLabel }: {
  title: string; icon?: IconName; status?: string; tone?: Tone; open?: boolean; onToggle?: (open: boolean) => void;
  defaultOpen?: boolean; children: ReactNode; accessibilityLabel?: string;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const toggle = () => { setOwn(!open); onToggle?.(!open); };
  return <View accessibilityLabel={accessibilityLabel} style={styles.disclosure}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle}
      style={({ pressed }) => [styles.disclosureHead, pressed && styles.rowPressed]}>
      {icon ? <View style={styles.rowIcon}><Icon name={icon} size={19} color={colors.brand} /></View> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {status ? <View style={styles.disclosureStatus}><Pill label={status} tone={tone} dot /></View> : null}
      </View>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
    </Pressable>
    {open ? <View style={styles.disclosureBody}>{children}</View> : null}
  </View>;
}

// Screen header: a round back button and the title; tab screens pass no back.
export function TopBar({ title, back, onBack, right }: { title?: string; back?: string; onBack?: () => void; right?: ReactNode }) {
  const router = useRouter();
  const leave = onBack ?? (() => { if (router.canGoBack()) router.back(); else router.replace((back ?? '/') as never); });
  return <View style={styles.topBar}>
    {back !== undefined || onBack ? <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={leave}
      hitSlop={8} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
      <Icon name="chevron-back" size={22} color={colors.text} />
    </Pressable> : null}
    {title ? <Text accessibilityRole="header" numberOfLines={1} style={styles.topTitle}>{title}</Text> : null}
    <View style={styles.topRight}>{right}</View>
  </View>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return <View style={[styles.logo, { width: size, height: size, borderRadius: size * 0.32 }]}>
    <Icon name="shield-checkmark" size={size * 0.6} color="#FFFFFF" />
  </View>;
}

export const text = StyleSheet.create({
  display: { ...type.display, color: colors.text },
  title: { ...type.title, color: colors.text },
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.textSub },
  strong: { ...type.body, color: colors.text, fontWeight: '600' },
  small: { ...type.small, color: colors.textMuted },
  error: { ...type.small, color: colors.redText, fontSize: 14 },
  link: { ...type.body, color: colors.brandText, fontWeight: '600' },
});

const styles = StyleSheet.create({
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.brand, borderColor: colors.brand },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, gap: 10, ...shadow },
  cardTight: { paddingVertical: 4, paddingHorizontal: 0, gap: 0 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 },
  sectionTitle: { ...type.heading, color: colors.text },
  button: { minHeight: 52, borderRadius: radius.button, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8 },
  buttonText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },
  levelDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  rowPressed: { backgroundColor: colors.fill },
  rowIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  rowIconDanger: { backgroundColor: colors.redSoft },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.body, color: colors.text, fontWeight: '600' },
  rowTitleDanger: { color: colors.redText },
  rowSubtitle: { ...type.small, color: colors.textMuted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 64 },
  disclosure: { backgroundColor: colors.card, borderRadius: radius.card, overflow: 'hidden', ...shadow },
  disclosureHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  disclosureStatus: { marginTop: 4 },
  disclosureBody: { paddingHorizontal: 18, paddingBottom: 18, paddingTop: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 6 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { ...type.heading, color: colors.text, flex: 1 },
  topRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});

const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.brandSoft },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.redSoft },
});
const buttonText = StyleSheet.create({
  primary: { color: '#FFFFFF' }, secondary: { color: colors.brandText }, ghost: { color: colors.textSub }, danger: { color: colors.redText },
});
