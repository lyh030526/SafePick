import { Tabs } from 'expo-router';
import { ACCOUNTS_ENABLED } from '../../lib/session';
import { colors } from '../../theme';
import { Icon, type IconName } from '../../ui';

const tabs: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: '홈', icon: 'home-outline', active: 'home' },
  { name: 'history', title: '기록', icon: 'time-outline', active: 'time' },
  { name: 'my', title: '마이', icon: 'person-outline', active: 'person' },
];

// Home analyses a listing; 기록 and 마이 need a session and ask for one in place when there is none.
export default function TabLayout() {
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.brand,
    tabBarInactiveTintColor: colors.textMuted,
    // With accounts off only Home is left, so there is no tab bar to show.
    tabBarStyle: ACCOUNTS_ENABLED ? { backgroundColor: colors.card, borderTopColor: colors.line } : { display: 'none' },
    tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
    sceneStyle: { backgroundColor: colors.canvas },
  }}>
    {tabs.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{
      title: tab.title,
      href: ACCOUNTS_ENABLED || tab.name === 'index' ? undefined : null,
      tabBarIcon: ({ color, focused }) => <Icon name={focused ? tab.active : tab.icon} size={23} color={String(color)} />,
    }} />)}
  </Tabs>;
}
