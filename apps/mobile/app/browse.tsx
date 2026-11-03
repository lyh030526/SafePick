import { useLocalSearchParams } from 'expo-router';
import { CoupangBrowser } from '../CoupangBrowser';

export default function Browse() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  return <CoupangBrowser initialUrl={url} />;
}
