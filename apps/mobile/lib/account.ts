import { supabase } from './supabase';

export type Level = 'high' | 'moderate' | 'low' | 'undetermined';
// What one analysis or saved listing keeps: enough to list it and see why, never the collected page text.
export type ListingSummary = {
  product_url: string; page_title: string | null; product_name: string | null; seller_name: string | null;
  price: string | null; level: Level; label: string; score: number | null; summary: string | null;
};
export type HistoryItem = ListingSummary & { id: string; created_at: string; result: Record<string, unknown> };
export type SavedItem = ListingSummary & { id: string; created_at: string; note: string | null };

type AnalysisPayload = {
  product: { product_name: string; seller_name: string; price: string };
  source: { page_title: string; final_url: string };
  risk_analysis?: { assessment?: { level: Level; label: string; score?: number | null; summary: string } } | null;
  seller_verification?: { seller?: { business_name?: string } } | null;
  sale_text?: string;
};

const known = (value: string | undefined | null) => (value && value !== '확인 불가' ? value.slice(0, 300) : null);

export function summarize(productUrl: string, payload: AnalysisPayload): ListingSummary | null {
  const assessment = payload.risk_analysis?.assessment;
  if (!assessment) return null;
  return {
    product_url: productUrl, page_title: known(payload.source.page_title), product_name: known(payload.product.product_name),
    seller_name: known(payload.seller_verification?.seller?.business_name) ?? known(payload.product.seller_name),
    price: known(payload.product.price)?.slice(0, 60) ?? null, level: assessment.level, label: assessment.label,
    score: assessment.score ?? null, summary: assessment.summary.slice(0, 1000),
  };
}

function client() {
  if (!supabase) throw new Error('로그인 설정이 아직 없어요.');
  return supabase;
}

export async function saveAnalysis(productUrl: string, payload: AnalysisPayload) {
  const summary = summarize(productUrl, payload);
  if (!summary) return;
  // The collected text may hold what the shopper pasted, so the stored result leaves it out.
  const { sale_text: _text, ...result } = payload;
  const { error } = await client().from('analyses').insert({ ...summary, result });
  if (error) throw error;
}

export async function listAnalyses(): Promise<HistoryItem[]> {
  const { data, error } = await client().from('analyses').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data as HistoryItem[];
}

export async function deleteAnalysis(id: string) {
  const { error } = await client().from('analyses').delete().eq('id', id);
  if (error) throw error;
}

export async function saveListing(summary: ListingSummary, note = '') {
  // Saving the same page again refreshes it with the latest result instead of adding a second row.
  const { summary: _summary, ...fields } = summary;
  const { error } = await client().from('saved_listings').upsert({ ...fields, note: note || null }, { onConflict: 'user_id,product_url' });
  if (error) throw error;
}

export async function listSaved(): Promise<SavedItem[]> {
  const { data, error } = await client().from('saved_listings').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as SavedItem[];
}

export async function removeSaved(id: string) {
  const { error } = await client().from('saved_listings').delete().eq('id', id);
  if (error) throw error;
}

export async function getNickname(): Promise<string> {
  const { data } = await client().from('profiles').select('nickname').maybeSingle();
  return data?.nickname ?? '';
}

export async function setNickname(nickname: string) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) throw new Error('다시 로그인해 주세요.');
  const { error } = await client().from('profiles').upsert({ id: user.id, nickname: nickname.trim().slice(0, 40) });
  if (error) throw error;
}

export type HistoryRecord = {
  id: string; title: string; market: string; seller: string; price: string; level: Level; label: string;
  score: number | null; analyzed_at: string; product_url: string;
};
export type HistoryReply = {
  status: 'answered' | 'no_records' | 'unavailable'; answer: string;
  citations: { id: string; text: string; record_id?: string | null }[]; records: HistoryRecord[];
};

// A question about the signed-in shopper's own analyses: the server reads them with this user's token and answers
// from them only, naming the records it used.
export async function askHistory(apiBaseUrl: string, question: string): Promise<HistoryReply> {
  const { data: { session } } = await client().auth.getSession();
  if (!session) throw new Error('다시 로그인해 주세요.');
  const response = await fetch(`${apiBaseUrl}/history-questions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ question }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '질문을 보내지 못했어요.');
  return payload as HistoryReply;
}

// Deleting the sign-in itself needs the server's secret key, so the API does it after checking this user's token.
export async function deleteAccount(apiBaseUrl: string) {
  const { data: { session } } = await client().auth.getSession();
  if (!session) throw new Error('다시 로그인해 주세요.');
  const response = await fetch(`${apiBaseUrl}/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error('계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
  await client().auth.signOut();
}
