import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RollingNumber } from "@/components/RollingNumber";

vi.mock("@/contexts/TvModeContext", () => ({ useTvMode: () => ({ isTvMode: false }) }));
afterEach(cleanup);

function change(from: number, to: number, decimals = 1) {
  const view = render(<RollingNumber value={from} decimals={decimals} />);
  const oldDigits = Array.from(view.container.querySelectorAll('[aria-hidden="true"]'));
  view.rerender(<RollingNumber value={to} decimals={decimals} />);
  return { ...view, oldDigits, digits: Array.from(view.container.querySelectorAll('[aria-hidden="true"]')) };
}

function sequence(digit: Element) {
  return Array.from(digit.querySelectorAll(".rolling-number-strip > span")).map(node => Number(node.textContent));
}

describe("RollingNumber", () => {
  it("rolls −0.5 → −0.3 two steps down", () => {
    const { digits } = change(-0.5, -0.3);
    expect(sequence(digits[1])).toEqual([3, 4, 5]);
    expect(digits[1].firstElementChild?.getAttribute("style")).toContain("--roll-from: translateY(-2em)");
  });
  it("rolls −1.2 → −1.4 two steps up", () => {
    expect(sequence(change(-1.2, -1.4).digits[1])).toEqual([2, 3, 4]);
  });
  it("rolls 2.0 → 1.9 one step down", () => {
    expect(sequence(change(2, 1.9).digits[1])).toEqual([9, 0]);
  });
  it("rolls 19.9 → 20.0 through the carry", () => {
    const { digits } = change(19.9, 20);
    expect(sequence(digits[0])).toEqual([1, 2]);
    expect(sequence(digits[1])).toEqual([9, 0]);
  });
  it("keeps the units digit when adding a leading digit", () => {
    const { digits, oldDigits } = change(9.9, 10);
    expect(digits[1]).toBe(oldDigits[0]);
    expect(digits[2]).toBe(oldDigits[1]);
    expect(sequence(digits[1])).toEqual([9, 0]);
    expect(sequence(digits[0])).toEqual([]);
    expect(digits[0].querySelector(".fade-in")).not.toBeNull();
  });
  it("changes sign without rolling or remounting digits", () => {
    const { container, digits, oldDigits } = change(-0.1, 0.2);
    expect(digits[1]).toBe(oldDigits[1]);
    expect(container.querySelector(".rolling-number-strip")).toBeNull();
    expect(digits[1].textContent).toBe("2");
  });
  it("caps 2.0 → 9.0 at one step", () => {
    const { digits } = change(2, 9);
    expect(sequence(digits[0])).toEqual([2, 9]);
    expect(digits[0].firstElementChild?.getAttribute("style")).toContain("animation-duration: 700ms");
  });
  it("does not roll during cleaning", () => {
    const view = render(<div className="cleaning-transition-active"><RollingNumber value={-0.5} decimals={1} /></div>);
    view.rerender(<div className="cleaning-transition-active"><RollingNumber value={-0.3} decimals={1} /></div>);
    expect(view.container.querySelector(".rolling-number-strip")).toBeNull();
  });
  it("preserves the forced upward direction in step mode for the clock", () => {
    const view = render(<RollingNumber value="23" mode="step" direction={1} />);
    view.rerender(<RollingNumber value="00" mode="step" direction={1} />);
    expect(sequence(view.container.querySelectorAll('[aria-hidden="true"]')[0])).toEqual([2, 0]);
  });
});