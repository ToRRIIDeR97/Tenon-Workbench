import { describe, expect, test } from "bun:test"
import { designDocument } from "./design-fence"
import { DESIGN_INSPECT, designInspectScript, pickedDesignElement } from "./design-inspect"

describe("AC-14 the inspect picker in a design frame", () => {
  test("a finished design gets the picker only when asked", () => {
    expect(designDocument("<p>Hi</p>", { inspect: true })).toContain(DESIGN_INSPECT)
    expect(designDocument("<p>Hi</p>")).not.toContain(DESIGN_INSPECT)
  })

  test("the picker names an element by a short CSS path", () => {
    const path = new Function(`${designInspectScript.replace(/<\/?script>/g, "")}; return tenonCssPath`)() as (
      element: unknown,
    ) => string
    type Node = { tagName: string; id: string; classList: string[]; parentElement?: Node; children: Node[] }
    const node = (tagName: string, props: { id?: string; classes?: string[] } = {}, children: Node[] = []): Node => {
      const self: Node = { tagName, id: props.id ?? "", classList: props.classes ?? [], children }
      for (const child of children) child.parentElement = self
      return self
    }
    const cta = node("BUTTON", { classes: ["cta"] })
    const h1 = node("H1")
    const link = node("A")
    node("BODY", {}, [
      node("MAIN", {}, [node("SECTION", { classes: ["hero", "big"] }, [h1, node("BUTTON"), cta])]),
      node("DIV", { id: "footer" }, [link]),
    ])
    expect(path(cta)).toBe("main > section.hero > button.cta:nth-of-type(2)")
    expect(path(h1)).toBe("main > section.hero > h1")
    expect(path(link)).toBe("#footer > a")
  })

  test("a pick message is reduced to plain, bounded data", () => {
    expect(
      pickedDesignElement({
        type: `${DESIGN_INSPECT}:pick`,
        selector: "button.cta",
        tag: "BUTTON",
        text: "  Get   started  ",
        rect: { x: 10, y: 20, width: 100, height: 30 },
        scroll: { x: 0, y: 40 },
      }),
    ).toEqual({
      selector: "button.cta",
      tag: "button",
      text: "Get started",
      rect: { x: 10, y: 60, width: 100, height: 30 },
    })
  })

  test("anything else from the frame is ignored, and long values are cut", () => {
    expect(pickedDesignElement({ type: "other" })).toBeUndefined()
    expect(pickedDesignElement({ type: `${DESIGN_INSPECT}:pick`, selector: 5 })).toBeUndefined()
    const long = pickedDesignElement({
      type: `${DESIGN_INSPECT}:pick`,
      selector: "a".repeat(500),
      tag: "p",
      text: "b".repeat(500),
      rect: { x: Number.NaN, y: 0, width: 1, height: 1 },
      scroll: { x: 0, y: 0 },
    })
    expect(long?.selector.length).toBe(200)
    expect(long?.text.length).toBe(120)
    expect(long?.rect.x).toBe(0)
  })
})
