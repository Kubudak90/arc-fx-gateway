import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ArcoraLogo, ArcoraSymbol } from "./Logo";

afterEach(() => cleanup());

describe("ArcoraLogo", () => {
  it("renders the two-tone Arcorapay wordmark", () => {
    const { container } = render(<ArcoraLogo />);
    expect(container.textContent).toContain("Arcorapay");
  });

  it("symbol has no settlement dot (new mark = 3 paths)", () => {
    const { container } = render(<ArcoraSymbol />);
    expect(container.querySelectorAll("path").length).toBe(3);
  });
});
