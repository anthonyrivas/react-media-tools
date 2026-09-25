import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OverlayLayer } from "./OverlayLayer";

describe("OverlayLayer", () => {
  it("moves the pip with arrow keys when focused", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    } as DOMRect);

    const { rerender } = render(
      <OverlayLayer
        canvasWidth={1280}
        canvasHeight={720}
        aspect={16 / 9}
        overlay={{ x: 0.5, y: 0.5, width: 0.22 }}
        visible
        onChange={onChange}
      />,
    );
    rerender(
      <OverlayLayer
        canvasWidth={1280}
        canvasHeight={720}
        aspect={16 / 9}
        overlay={{ x: 0.5, y: 0.5, width: 0.22 }}
        visible
        onChange={onChange}
      />,
    );

    const pip = screen.getByRole("group", { name: /Camera overlay/ });
    pip.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number) }));
    const next = onChange.mock.calls[0]?.[0] as { x: number };
    expect(next.x).toBeLessThan(0.5);
  });
});
