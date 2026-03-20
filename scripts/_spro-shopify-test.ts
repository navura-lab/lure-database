// Shopify商品で実際に画像が大きい(5KB以上)ものの調査
async function main() {
  let page = 1;
  let hasMore = true;
  let bigImageProducts = 0;
  let smallImageProducts = 0;
  
  while (hasMore) {
    const resp = await fetch(`https://www.spro.com/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) break;
    const json = await resp.json() as any;
    if (json.products.length === 0) break;
    
    // サンプルとして各商品のfirst imageをHEADチェック
    for (const p of json.products) {
      if (!p.images || p.images.length === 0) continue;
      try {
        const imgResp = await fetch(p.images[0].src, { method: 'HEAD' });
        const size = parseInt(imgResp.headers.get('content-length') || '0', 10);
        if (size >= 5000) {
          bigImageProducts++;
        } else {
          smallImageProducts++;
          if (smallImageProducts <= 5) {
            console.log(`Small: ${p.handle} → ${size} bytes (${p.images[0].src.substring(0, 80)}...)`);
          }
        }
      } catch {}
    }
    page++;
    if (json.products.length < 250) hasMore = false;
  }
  
  console.log(`\nShopify画像サイズ統計:`);
  console.log(`  >=5KB: ${bigImageProducts}`);
  console.log(`  <5KB: ${smallImageProducts}`);
}
main();
