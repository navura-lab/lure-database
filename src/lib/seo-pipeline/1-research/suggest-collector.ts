/**
 * Google Suggestサジェスト収集モジュール
 *
 * エンドポイント: https://suggestqueries.google.com/complete/search
 * レート制限: 呼び出し元でコントロール（推奨 500ms間隔）
 */

/** 単一クエリのサジェストを取得 */
export async function collectSuggestions(query: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=ja`;
  try {
    const res = await fetch(url, {
      headers: {
        // Googleのレート制限回避のため UA を指定
        'User-Agent': 'Mozilla/5.0 (compatible; SEOResearch/1.0)',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    // res.json()はUTF-8デコードに問題が出る場合があるため text()→JSON.parse()
    const text = await res.text();
    const data = JSON.parse(text) as [string, string[]];
    return data[1] ?? [];
  } catch (err) {
    console.error(`[suggest-collector] クエリ「${query}」取得失敗:`, err);
    return [];
  }
}

/** 複数クエリのサジェストをまとめて収集（レート制限付き） */
export async function collectBatch(
  queries: string[],
  delayMs = 500,
): Promise<Record<string, string[]>> {
  const results: Record<string, string[]> = {};
  for (const query of queries) {
    results[query] = await collectSuggestions(query);
    // レート制限
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}
