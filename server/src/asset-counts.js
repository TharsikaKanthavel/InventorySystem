export function assetCounts(assets, branches, comparison = false) {
  const groups = new Map();
  for (const a of assets) {
    const key = JSON.stringify([a.category, a.item, ...(comparison ? [] : [a.branch])]);
    if (!groups.has(key)) groups.set(key, comparison
      ? { Category: a.category, Item: a.item, ...Object.fromEntries(branches.map(b => [b, 0])), Total: 0 }
      : { Branch: a.branch, Category: a.category, Item: a.item, 'Asset records': 0 });
    const row = groups.get(key);
    if (comparison) { row[a.branch]++; row.Total++; }
    else row['Asset records']++;
  }
  const rows = [...groups.values()].sort((a, b) =>
    (a.Branch || '').localeCompare(b.Branch || '') || a.Category.localeCompare(b.Category) || a.Item.localeCompare(b.Item));
  const total = comparison
    ? { Category: 'TOTAL', Item: '', ...Object.fromEntries(branches.map(b => [b, assets.filter(a => a.branch === b).length])), Total: assets.length }
    : { Branch: 'TOTAL', Category: '', Item: '', 'Asset records': assets.length };
  return [...rows, total];
}
