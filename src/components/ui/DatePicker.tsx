import { useState, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  addMonths,
  subMonths,
  addYears,
  subYears,
  isSameDay,
  isWithinInterval,
  parseISO,
  startOfDay,
  endOfDay,
} from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "./Button";

interface DatePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
}

type ViewMode = "day" | "month" | "year";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const QUICK_RANGES = [
  { label: "Hari Ini", getValue: () => ({ start: format(new Date(), "yyyy-MM-dd"), end: format(new Date(), "yyyy-MM-dd") }) },
  { label: "Minggu Ini", getValue: () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek);
    return { start: format(start, "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
  }},
  { label: "Bulan Ini", getValue: () => ({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  }) },
  { label: "Bulan Lalu", getValue: () => {
    const lastMonth = subMonths(new Date(), 1);
    return {
      start: format(startOfMonth(lastMonth), "yyyy-MM-dd"),
      end: format(endOfMonth(lastMonth), "yyyy-MM-dd"),
    };
  }},
  { label: "Tahun Ini", getValue: () => ({
    start: format(startOfYear(new Date()), "yyyy-MM-dd"),
    end: format(endOfYear(new Date()), "yyyy-MM-dd"),
  }) },
];

export default function DatePicker({ startDate, endDate, onChange }: DatePickerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const start = startDate ? parseISO(startDate) : new Date();
    return startOfMonth(start);
  });
  const [selecting, setSelecting] = useState<"start" | "end">("start");
  const [isOpen, setIsOpen] = useState(false);

  const start = useMemo(
    () => (startDate ? startOfDay(parseISO(startDate)) : startOfDay(new Date())),
    [startDate]
  );
  const end = useMemo(
    () => (endDate ? endOfDay(parseISO(endDate)) : endOfDay(new Date())),
    [endDate]
  );

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const startDay = monthStart.getDay();
    const totalDays = monthEnd.getDate();

    const result: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) result.push(null);
    for (let i = 1; i <= totalDays; i++) result.push(i);
    return result;
  }, [currentMonth]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 21 }, (_, i) => currentYear - 10 + i);
  }, []);

  const handleDayClick = (day: number) => {
    const clicked = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    const clickedStr = format(clicked, "yyyy-MM-dd");

    if (selecting === "start") {
      onChange(clickedStr, clickedStr);
      setSelecting("end");
    } else {
      const startDateObj = parseISO(startDate || clickedStr);
      if (clicked < startDateObj) {
        onChange(clickedStr, startDate || clickedStr);
      } else {
        onChange(startDate || clickedStr, clickedStr);
      }
      setSelecting("start");
    }
  };

  const handleMonthClick = (monthIndex: number) => {
    const newDate = new Date(currentMonth.getFullYear(), monthIndex, 1);
    const s = format(startOfMonth(newDate), "yyyy-MM-dd");
    const e = format(endOfMonth(newDate), "yyyy-MM-dd");
    onChange(s, e);
    setViewMode("day");
  };

  const handleYearClick = (year: number) => {
    const newDate = new Date(year, currentMonth.getMonth(), 1);
    setCurrentMonth(startOfMonth(newDate));
    setViewMode("month");
  };

  const isInRange = (day: number): boolean => {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    return isWithinInterval(date, { start, end });
  };

  const isStart = (day: number): boolean => {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    return isSameDay(date, start);
  };

  const isEnd = (day: number): boolean => {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    return isSameDay(date, end);
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-3 w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white transition-all duration-200",
          "hover:border-white/20 hover:bg-white/[0.08]",
          "focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
          isOpen && "border-emerald-500/40 ring-2 ring-emerald-500/40"
        )}
      >
        <Calendar className="w-4 h-4 text-emerald-400" />
        <span className="flex-1 text-left">
          {format(parseISO(startDate || format(new Date(), "yyyy-MM-dd")), "dd MMM yyyy", { locale: idLocale })}
          {" — "}
          {format(parseISO(endDate || format(new Date(), "yyyy-MM-dd")), "dd MMM yyyy", { locale: idLocale })}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", isOpen && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {/* Quick Ranges */}
          <div className="flex flex-wrap gap-2 p-3 border-b border-white/5">
            {QUICK_RANGES.map((range) => (
              <button
                key={range.label}
                onClick={() => {
                  const { start: s, end: e } = range.getValue();
                  onChange(s, e);
                }}
                className="px-3 py-1 text-xs rounded-lg bg-white/5 text-slate-300 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors cursor-pointer"
              >
                {range.label}
              </button>
            ))}
          </div>

          {/* Calendar Header */}
          <div className="flex items-center justify-between p-3">
            {viewMode === "day" && (
              <>
                <button
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("month")}
                  className="px-3 py-1 text-sm font-semibold text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                >
                  {format(currentMonth, "MMMM yyyy", { locale: idLocale })}
                </button>
                <button
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}

            {viewMode === "month" && (
              <>
                <div />
                <button
                  onClick={() => setViewMode("year")}
                  className="px-3 py-1 text-sm font-semibold text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                >
                  {currentMonth.getFullYear()}
                </button>
                <div />
              </>
            )}

            {viewMode === "year" && (
              <>
                <button
                  onClick={() =>
                    setCurrentMonth(
                      new Date(currentMonth.getFullYear() - 12, 0, 1)
                    )
                  }
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold text-white">
                  {currentMonth.getFullYear() - 10} — {currentMonth.getFullYear() + 10}
                </span>
                <button
                  onClick={() =>
                    setCurrentMonth(
                      new Date(currentMonth.getFullYear() + 12, 0, 1)
                    )
                  }
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Day View */}
          {viewMode === "day" && (
            <div className="px-3 pb-3">
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-2">
                {DAYS.map((day) => (
                  <div
                    key={day}
                    className="text-center text-xs font-medium text-slate-500 py-1"
                  >
                    {day}
                  </div>
                ))}
              </div>
              {/* Days grid */}
              <div className="grid grid-cols-7 gap-0.5">
                {days.map((day, i) => {
                  if (day === null)
                    return <div key={`empty-${i}`} className="aspect-square" />;
                  const range = isInRange(day);
                  const startDay = isStart(day);
                  const endDay = isEnd(day);
                  return (
                    <button
                      key={day}
                      onClick={() => handleDayClick(day)}
                      className={cn(
                        "aspect-square flex items-center justify-center text-sm rounded-lg transition-all cursor-pointer",
                        "hover:bg-emerald-500/20",
                        range && !startDay && !endDay && "bg-emerald-500/10 text-emerald-300",
                        startDay && "bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/30",
                        endDay && !startDay && "bg-emerald-600 text-white font-semibold",
                        !range && !startDay && !endDay && "text-slate-300"
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Month View */}
          {viewMode === "month" && (
            <div className="grid grid-cols-3 gap-2 p-4">
              {MONTHS.map((month, i) => (
                <button
                  key={month}
                  onClick={() => handleMonthClick(i)}
                  className={cn(
                    "py-3 rounded-xl text-sm transition-all cursor-pointer",
                    currentMonth.getMonth() === i
                      ? "bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/30"
                      : "text-slate-300 hover:bg-white/10"
                  )}
                >
                  {month}
                </button>
              ))}
            </div>
          )}

          {/* Year View */}
          {viewMode === "year" && (
            <div className="grid grid-cols-4 gap-2 p-4">
              {years.map((year) => (
                <button
                  key={year}
                  onClick={() => handleYearClick(year)}
                  className={cn(
                    "py-3 rounded-xl text-sm transition-all cursor-pointer",
                    currentMonth.getFullYear() === year
                      ? "bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/30"
                      : "text-slate-300 hover:bg-white/10"
                  )}
                >
                  {year}
                </button>
              ))}
            </div>
          )}

          {/* Selected Range Summary */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-white/[0.02]">
            <div className="text-xs text-slate-400">
              <span className="text-emerald-400 font-medium">Mulai:</span>{" "}
              {format(start, "dd MMM yyyy", { locale: idLocale })}
              {" — "}
              <span className="text-emerald-400 font-medium">Akhir:</span>{" "}
              {format(end, "dd MMM yyyy", { locale: idLocale })}
            </div>
            <Button
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              Pilih
            </Button>
          </div>
        </div>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
