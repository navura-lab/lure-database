import 'dotenv/config';
import { scrapeZoomPage } from './scrapers/zoom.js';

async function main() {
  const r = await scrapeZoomPage('https://order.zoombait.com/tackle/trick-worm/');
  console.log('mainImage:', r.mainImage);
  console.log('color images:');
  r.colors.slice(0, 5).forEach(c => {
    console.log(`  ${c.name}: ${c.imageUrl ? c.imageUrl.substring(0, 80) : 'NONE'}`);
  });
}

main().catch(console.error);
