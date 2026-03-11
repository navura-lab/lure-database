import 'dotenv/config';

async function main() {
  const url = 'https://www.strikeking.com/en/shop/hard-baits/hc4';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  console.log('Status:', response.status);
  console.log('URL:', response.url);
  console.log('Headers:', Object.fromEntries(response.headers.entries()));

  const html = await response.text();
  console.log('\nHTML length:', html.length);
  console.log('\nFirst 2000 chars:');
  console.log(html.substring(0, 2000));

  // Search for ld+json
  const ldIndex = html.indexOf('application/ld+json');
  console.log('\n--- ld+json found at index:', ldIndex);
  if (ldIndex > 0) {
    console.log('Context:', html.substring(ldIndex - 50, ldIndex + 200));
  }

  // Search for ProductGroup
  const pgIndex = html.indexOf('ProductGroup');
  console.log('--- ProductGroup found at index:', pgIndex);
  if (pgIndex > 0) {
    console.log('Context:', html.substring(pgIndex - 50, pgIndex + 200));
  }
}

main().catch(console.error);
