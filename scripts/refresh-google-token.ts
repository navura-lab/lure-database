#!/usr/bin/env npx tsx
/**
 * Google OAuth refresh token を再取得するスクリプト
 *
 * 現在のスコープ: webmasters.readonly + indexing
 * 必要なスコープ: webmasters (read-write) + indexing
 *
 * Usage:
 *   npx tsx scripts/refresh-google-token.ts
 *
 * 1. ブラウザで表示されるURLにアクセス
 * 2. Googleアカウントで認証
 * 3. リダイレクト先URLの code= パラメータをコピー
 * 4. プロンプトに貼り付け
 * 5. 新しいrefresh_tokenが表示される → .envに貼り付け
 */

import 'dotenv/config';
import readline from 'readline';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',     // GSC read-write（サイトマップ送信に必要）
  'https://www.googleapis.com/auth/indexing',        // Indexing API
].join(' ');

const REDIRECT_URI = 'http://localhost:3000/callback';

function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('ERROR: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が .env にありません');
    process.exit(1);
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log('');
  console.log('=== Google OAuth Token 再取得 ===');
  console.log('');
  console.log('以下のURLをブラウザで開いてください:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log('認証後、リダイレクト先URLから code= の値をコピーしてください。');
  console.log('（URLが http://localhost:3000/callback?code=XXXXX&scope=... の形式）');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Authorization code を入力: ', async (code) => {
    rl.close();

    if (!code.trim()) {
      console.error('ERROR: コードが空です');
      process.exit(1);
    }

    // URL全体が貼られた場合、codeパラメータを抽出
    let authCode = code.trim();
    if (authCode.includes('code=')) {
      const url = new URL(authCode);
      authCode = url.searchParams.get('code') || authCode;
    }

    console.log('');
    console.log('Token を取得中...');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: authCode,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await res.json() as any;

    if (data.error) {
      console.error('ERROR:', data.error, data.error_description);
      process.exit(1);
    }

    console.log('');
    console.log('=== 取得成功 ===');
    console.log('');
    console.log('新しい GOOGLE_REFRESH_TOKEN:');
    console.log(data.refresh_token);
    console.log('');
    console.log('scope:', data.scope);
    console.log('');
    console.log('.env の GOOGLE_REFRESH_TOKEN を上記の値に更新してください。');
  });
}

main();
