// Trade-In Engine — purana phone do, naya lo
import { catalog, formatPrice } from './catalog.js';

export function estimateTradeIn(modelQuery, condition = 'average') {
  const q = (modelQuery || '').toLowerCase();
  const cond = ['good', 'average', 'poor'].includes(condition) ? condition : 'average';

  const table = catalog().tradeInTable;
  const row =
    table.find((r) => r.match.some((m) => m !== 'default' && q.includes(m))) ||
    table.find((r) => r.match.includes('default'));

  const value = row[cond];
  const condLabel = { good: 'Achi condition ✨', average: 'Theek thaak condition 👍', poor: 'Thori purani/thukli hui 🔧' }[cond];

  return {
    value,
    text: `🔄 *Trade-In Estimate:*\n\n📱 Model: ${modelQuery.toUpperCase()}\n🔍 ${condLabel}\n💰 Andazan value: *${formatPrice(value)}*\n\nFinal value store par phone dekh kar confirm hogi. Is value ko kisi bhi naye OPPO par minus kar dein! 🎉`,
  };
}
