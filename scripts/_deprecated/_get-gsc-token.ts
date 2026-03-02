/**
 * Google Search Console API + Analytics API のOAuth2 refresh token を取得する
 * 既存のGCPプロジェクトの認証情報を使用
 *
 * Usage: npx tsx scripts/_get-gsc-token.ts
 */
import 'dotenv/config';
import http from 'http';
import { URL } from 'url';

// .env から読み込み（GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET）
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = 'http://localhost:8090';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

// 必要なスコープ: Search Console + Analytics (read-only)
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',   // Search Console 読み取り
  'https://www.googleapis.com/auth/webmasters',             // Search Console 書き込み（サイトマップ送信等）
  'https://www.googleapis.com/auth/indexing',               // Indexing API（インデックス登録リクエスト）
  'https://www.googleapis.com/auth/analytics.readonly',     // GA4 読み取り
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=== Google API OAuth2 セットアップ ===\n');
console.log('以下のURLをブラウザで開いて認証してください:\n');
console.log(authUrl);
console.log('\n認証後、localhost:8090 にリダイレクトされます...\n');

// ローカルサーバーでcallbackを受け取る
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:8090`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>エラー: 認証コードが取得できませんでした</h1>');
    return;
  }

  // 認証コードをrefresh tokenに交換
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>エラー</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      server.close();
      return;
    }

    console.log('\n✅ 認証成功！\n');
    console.log('=== .mcp.json に追加する設定 ===\n');
    console.log(JSON.stringify({
      "google-search-console": {
        "command": "npx",
        "args": ["-y", "-p", "google-search-console-mcp-server", "google-search-console-mcp"],
        "env": {
          "GOOGLE_CLIENT_ID": CLIENT_ID,
          "GOOGLE_CLIENT_SECRET": CLIENT_SECRET,
          "GOOGLE_REFRESH_TOKEN": tokenData.refresh_token,
        }
      }
    }, null, 2));

    console.log('\n=== 環境変数 (cron用) ===\n');
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokenData.refresh_token}`);
    console.log(`GOOGLE_ACCESS_TOKEN=${tokenData.access_token}`);
    console.log(`\nAccess token expires in: ${tokenData.expires_in}s`);
    console.log(`Scopes: ${tokenData.scope}`);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <h1>✅ 認証完了！</h1>
      <p>ターミナルに戻って設定を確認してください。</p>
      <p>このタブは閉じてOKです。</p>
    `);

    // 少し待ってからサーバーを閉じる
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 1000);

  } catch (err) {
    console.error('Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>エラーが発生しました</h1>');
    server.close();
  }
});

server.listen(8090, () => {
  console.log('Callback server listening on http://localhost:8090');
});
