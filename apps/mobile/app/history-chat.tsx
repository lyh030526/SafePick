import { Redirect } from 'expo-router';
import { HistoryChat } from '../AskAnalysis';
import { ACCOUNTS_ENABLED, useSession } from '../lib/session';

// Questions about the signed-in shopper's saved analyses; the history and my-page screens open it.
export default function HistoryChatScreen() {
  const { session, loading } = useSession();
  if (!ACCOUNTS_ENABLED || (!loading && !session)) return <Redirect href="/sign-in" />;
  return <HistoryChat />;
}
