// SPROの全商品画像状況をShopify APIから調査
async function main() {
  let page = 1;
  let hasMore = true;
  let total = 0;
  let withImages = 0;
  let noImages = 0;
  const handleToImages: Record<string, number> = {};
  
  while (hasMore) {
    const resp = await fetch(`https://www.spro.com/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) { console.error('Error:', resp.status); break; }
    const json = await resp.json() as any;
    const products = json.products || [];
    if (products.length === 0) { hasMore = false; break; }
    
    for (const p of products) {
      total++;
      const imgCount = p.images?.length || 0;
      if (imgCount > 0) {
        withImages++;
        handleToImages[p.handle] = imgCount;
      } else {
        noImages++;
      }
    }
    page++;
    if (products.length < 250) hasMore = false;
  }
  
  console.log(`=== SPRO Shopify API 全商品統計 ===`);
  console.log(`Total: ${total}`);
  console.log(`With images: ${withImages}`);
  console.log(`No images: ${noImages}`);
  console.log(`\n画像ありの商品例 (最初の20):`);
  const entries = Object.entries(handleToImages);
  for (const [handle, count] of entries.slice(0, 20)) {
    console.log(`  ${handle}: ${count} images`);
  }
}
main();
