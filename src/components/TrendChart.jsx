import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export default function TrendChart({ data, color, dataKey }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.19} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#edf0f5" vertical={false} />
        <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: '#8b94a5', fontSize: 12 }} dy={12} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b94a5', fontSize: 11 }} />
        <Tooltip contentStyle={{ border: '1px solid #e8ebf1', borderRadius: 10, boxShadow: '0 8px 24px #172b4d12', fontSize: 12 }} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} fill="url(#trendFill)" activeDot={{ r: 5, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
