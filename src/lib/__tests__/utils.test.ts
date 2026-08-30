import { describe, it, expect } from "vitest";
import { formatCurrency, generateId } from "../utils";

// Intl.NumberFormat("id-ID") uses non-breaking space (U+00A0) as currency separator
const NBSP = "\u00a0";

describe("formatCurrency", () => {
  it("formats zero as Rp 0", () => {
    expect(formatCurrency(0)).toBe(`Rp${NBSP}0`);
  });

  it("formats positive amounts in IDR", () => {
    expect(formatCurrency(50000)).toBe(`Rp${NBSP}50.000`);
    expect(formatCurrency(1500000)).toBe(`Rp${NBSP}1.500.000`);
  });

  it("formats negative amounts with leading minus", () => {
    // id-ID places minus before the currency symbol
    expect(formatCurrency(-100000)).toBe(`-Rp${NBSP}100.000`);
  });

  it("formats large numbers", () => {
    expect(formatCurrency(100000000)).toBe(`Rp${NBSP}100.000.000`);
  });

  it("rounds to whole numbers (no decimal places)", () => {
    const result = formatCurrency(12345.67);
    // id-ID uses . as thousands separator, no decimal point
    expect(result).toBe(`Rp${NBSP}12.346`);
  });
});

describe("generateId", () => {
  it("returns a string", () => {
    expect(typeof generateId()).toBe("string");
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("contains a dash separator", () => {
    const id = generateId();
    expect(id).toContain("-");
  });
});
