#!/usr/bin/env npx tsx
/**
 * GSC OAuth トークン再取得スクリプト（手動コピー方式）
 *
 * 1. ブラウザで認証URLを開く
 * 2. 認証後、リダイレクト先のURLからcodeパラメータをコピー
 * 3. ターミナルに貼り付け
 * 4. .envに新しいリフレッシュトークンを保存
 *
 * Usage:
 *   npx tsx scripts/_refresh-gsc-token.ts
 *   npx tsx scripts/_refresh-gsc-token.ts --code CODE_HERE
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
// OOBフローは廃止済み。ループバックIP方式を使用
const REDIRECT_URI = 'http://localhost:8090';
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/indexing',
].join(' ');

const ENV_PATH = path.join(import.meta.dirname, '..', '.env');

async function exchangeCode(code: string) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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

  const tokenData = await tokenRes.json() as any;

  if (!tokenData.refresh_token) {
    console.error('❌ リフレッシュトークン取得失敗:', JSON.stringify(tokenData, null, 2));
    return false;
  }

  console.log('✅ 新しいリフレッシュトークン取得');

  // .envファイルを更新
  let envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  envContent = envContent.replace(
    /^GOOGLE_REFRESH_TOKEN=.*$/m,
    `GOOGLE_REFRESH_TOKEN=${tokenData.refresh_token}`
  );
  fs.writeFileSync(ENV_PATH, envContent);
  console.log('✅ .env 更新完了');

  // 検証
  const testRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokenData.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const testData = await testRes.json() as any;

  if (testData.access_token) {
    console.log(`✅ 検証OK（expires_in: ${testData.expires_in}s）`);
    return true;
  } else {
    console.error('❌ 検証失敗:', JSON.stringify(testData));
    return false;
  }
}

async function startLocalServer(): Promise<string> {
  const http = await import('http');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:8090');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>❌ エラー: ${error}</h1>`);
        server.close();
        reject(new Error(error));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>✅ 認証成功！このタブを閉じてください。</h1>');
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>❓ コードがありません</h1>');
    });

    server.listen(8090, '127.0.0.1', () => {
      console.log('🔗 localhost:8090 でコールバック待機中...');
    });

    setTimeout(() => {
      server.close();
      reject(new Error('タイムアウト（5分）'));
    }, 300_000);
  });
}

async function main() {
  // --code 引数がある場合は直接交換
  const codeIdx = process.argv.indexOf('--code');
  if (codeIdx !== -1 && process.argv[codeIdx + 1]) {
    await exchangeCode(process.argv[codeIdx + 1]);
    return;
  }

  // 認証URL生成
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\n📋 ブラウザで認証してください。自動的にリダイレクトされます。\n');

  // ブラウザで開く
  exec(`open "${authUrl.toString()}"`);

  try {
    const code = await startLocalServer();
    console.log('✅ 認証コード受信');
    await exchangeCode(code);
  } catch (e: any) {
    console.error('\n❌ 自動受信失敗:', e.message);
    console.log('\n📋 手動モード: ブラウザのアドレスバーからURLをコピーし、');
    console.log('   以下のように実行してください:');
    console.log('   npx tsx scripts/_refresh-gsc-token.ts --code YOUR_CODE_HERE\n');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
