import { useMemo } from "react";
import { motion } from "framer-motion";

interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  strokeWidth?: number;
}

const COLORS = [
  "#10b981", "#34d399", "#6ee7b7", "#059669",
  "#3b82f6", "#60a5fa", "#93c5fd",
  "#f59e0b", "#fbbf24",
  "#ef4444", "#f87171",
];

export default function DonutChart({
  data,
  size = 160,
  strokeWidth = 20,
}: DonutChartProps) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    let cumulative = 0;
    return data.map((d, i) => {
      const percentage = total > 0 ? (d.value / total) * 100 : 0;
      const dashArray = (percentage / 100) * circumference;
      const dashOffset = -((cumulative / 100) * circumference);
      cumulative += percentage;
      return {
        ...d,
        percentage,
        dashArray,
        dashOffset,
        color: d.color || COLORS[i % COLORS.length],
      };
    });
  }, [data, total, circumference]);

  if (data.length === 0 || total === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500 text-sm rounded-full bg-white/5"
        style={{ width: size, height: size }}
      >
        Kosong
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={strokeWidth}
          />
          {/* Segments */}
          {segments.map((seg, i) => (
            <motion.circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.dashArray} ${circumference - seg.dashArray}`}
              strokeDashoffset={seg.dashOffset}
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            />
          ))}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-white">
            {data.length}
          </span>
          <span className="text-[10px] text-slate-400">Kategori</span>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-2 flex-1 min-w-0">
        {segments.slice(0, 8).map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-slate-300 truncate">{seg.label}</span>
            <span className="text-slate-500 ml-auto flex-shrink-0">
              {seg.percentage.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
