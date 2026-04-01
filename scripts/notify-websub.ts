/**
 * PubSubHubbub (WebSub) 通知スクリプト
 *
 * Google の PubSubHubbub ハブに RSS フィード更新を通知する。
 * パイプライン実行後やデプロイ後に自動実行する想定。
 *
 * 使い方:
 *   npx tsx scripts/notify-websub.ts
 *   npx tsx scripts/notify-websub.ts --dry-run
 */

const HUB_URL = 'https://pubsubhubbub.appspot.com/';
const FEED_URL = 'https://www.castlog.xyz/rss.xml';

async function notifyWebSub(dryRun = false) {
  console.log(`[WebSub] ハブに通知: ${HUB_URL}`);
  console.log(`[WebSub] フィードURL: ${FEED_URL}`);

  if (dryRun) {
    console.log('[WebSub] dry-run モード — 実際の送信はスキップ');
    return;
  }

  const body = new URLSearchParams({
    'hub.mode': 'publish',
    'hub.url': FEED_URL,
  });

  const res = await fetch(HUB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (res.ok || res.status === 204) {
    console.log(`[WebSub] 通知成功 (HTTP ${res.status})`);
  } else {
    const text = await res.text();
    console.error(`[WebSub] 通知失敗 (HTTP ${res.status}): ${text}`);
    process.exit(1);
  }
}

const dryRun = process.argv.includes('--dry-run');
notifyWebSub(dryRun);
