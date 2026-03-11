import { readFileSync, writeFileSync } from 'fs';

// Merge all 95 reclassify result files into one
const allResults: any[] = [];
for (let i = 0; i < 95; i++) {
  const path = `/tmp/reclassify-result-${String(i).padStart(3, '0')}.json`;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    allResults.push(...data);
  } catch (e) {
    console.error(`Error reading ${path}:`, e);
  }
}

console.log(`Total products: ${allResults.length}`);

// Count changes
const changed = allResults.filter(r => r.changed);
const deleted = allResults.filter(r => r.new_type === 'DELETE');
const unchanged = allResults.filter(r => !r.changed);

console.log(`Changed: ${changed.length}`);
console.log(`DELETE (non-lure): ${deleted.length}`);
console.log(`Unchanged: ${unchanged.length}`);

// Type distribution after reclassification
const typeCount: Record<string, number> = {};
for (const r of allResults) {
  typeCount[r.new_type] = (typeCount[r.new_type] || 0) + 1;
}
console.log('\n=== New type distribution ===');
const sorted = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
for (const [type, count] of sorted) {
  console.log(`  ${type}: ${count}`);
}

// Show all DELETE items
if (deleted.length > 0) {
  console.log('\n=== DELETE items (non-lure products to remove) ===');
  for (const d of deleted) {
    console.log(`  [${d.manufacturer_slug}] ${d.slug}: ${d.reason}`);
  }
}

// Show change summary by type transition
console.log('\n=== Type changes breakdown ===');
const transitions: Record<string, number> = {};
for (const r of changed) {
  // We need to look up old type from batch files
  transitions[r.new_type] = (transitions[r.new_type] || 0) + 1;
}
const sortedTrans = Object.entries(transitions).sort((a, b) => b[1] - a[1]);
for (const [type, count] of sortedTrans) {
  console.log(`  → ${type}: ${count} products changed to this type`);
}

// Write merged results
writeFileSync('/tmp/reclassify-merged-all.json', JSON.stringify(allResults, null, 2));
console.log('\nMerged results written to /tmp/reclassify-merged-all.json');

// Write only changes (for Supabase update)
const changesOnly = allResults.filter(r => r.changed);
writeFileSync('/tmp/reclassify-changes-only.json', JSON.stringify(changesOnly, null, 2));
console.log(`Changes-only written to /tmp/reclassify-changes-only.json (${changesOnly.length} items)`);
