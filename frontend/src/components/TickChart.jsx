import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

export default function TickChart({ ticks }) {
  if (!ticks || ticks.length === 0) return null;

  const data = ticks.slice(-20).map((tick, idx) => {
    const price = Number(tick.quote);

    return {
      index: idx + 1,
      price: Number.isFinite(price) ? price : 0,
      digit: Math.floor(price * 10) % 10
    };
  });

  const prices = data.map(d => d.price).filter(Number.isFinite);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const range = maxPrice - minPrice;

  // Give the chart some breathing room when prices barely move
  const padding = range === 0
    ? Math.max(Math.abs(minPrice) * 0.0001, 0.01)
    : range * 0.15;

  return (
    <div className="bg-black/30 rounded-xl p-4 mt-4">
      <p className="text-xs text-gray-400 mb-2">
        LAST 20 TICKS
      </p>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <XAxis
            dataKey="index"
            stroke="#666"
            tick={{ fontSize: 11 }}
          />

          <YAxis
            stroke="#666"
            domain={[
              minPrice - padding,
              maxPrice + padding
            ]}
            tick={{ fontSize: 11 }}
            tickFormatter={(value) => Number(value).toFixed(2)}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px'
            }}
            formatter={(value) => [
              Number(value).toFixed(5),
              'Price'
            ]}
          />

          <Line
            type="monotone"
            dataKey="price"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-1 mt-2 flex-wrap">
        {data.map((d, idx) => (
          <div
            key={idx}
            className={`w-8 h-8 flex items-center justify-center rounded text-xs font-bold ${
              d.digit % 2 === 0
                ? 'bg-green-500/30 text-green-300'
                : 'bg-purple-500/30 text-purple-300'
            }`}
          >
            {d.digit}
          </div>
        ))}
      </div>
    </div>
  );
}
