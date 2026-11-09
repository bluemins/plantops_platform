// The Drop screens' states, drawn from sample answers of the Sales customer API.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App as KApp } from "konsta/react";
import type { Home, Points, Polls } from "../src/api";
import { HomeView } from "../src/screens/Home";
import { PointsView } from "../src/screens/Points";
import { PollsView } from "../src/screens/Polls";
import { Status } from "../src/screens/Status";
import { kindOf } from "../src/art";
import { onBrand } from "../src/theme";

afterEach(cleanup);
const draw = (ui: React.ReactNode) => render(<KApp theme="material">{ui}</KApp>);

const HOME: Home = {
  shop: { name: "Shree Stores" },
  orders: [{ status: "received", date: "2026-11-08", time: null, lines: [{ product: "Bluemins 1L Water Bottle", size: "1L", unit: "box", qty: 20, free: 1 }] }],
  dues: [{ brand: "Bluemins", paise: 1245000 }],
  boxes: { Bluemins: { this_month: { total: 120, sizes: [{ size: "1L", boxes: 80 }, { size: "500ml", boxes: 40 }] }, last_month: { total: 95 }, this_year: { total: 1050, last_year_same_days: 870 } } },
  support: { phone: "9437000111", hours: "Mon–Sat 9–7" },
  points: { balance: 640, next: { label: "Bluemins 1L Water Bottle", missing: 160 } },
};

describe("Home", () => {
  it("the order (with free boxes), due, boxes, points and Call / WhatsApp", () => {
    draw(<HomeView home={HOME} goPoints={() => {}} hour={9} />);
    expect(screen.getByText("Shree Stores")).toBeTruthy();
    expect(screen.getByText("Order received · 8 Nov")).toBeTruthy();
    expect(screen.getByText("+ 1 free")).toBeTruthy();
    expect(screen.getByText("₹12,450")).toBeTruthy();
    expect(screen.getByText("1L · 80")).toBeTruthy();
    expect(screen.getByText("500ml · 40")).toBeTruthy();
    expect(screen.getByText(/870 last year/)).toBeTruthy();
    expect(screen.getByText("Good morning,")).toBeTruthy();
    expect(screen.getByText("640")).toBeTruthy();
    expect(screen.getByText("160 more for a free Bluemins 1L Water Bottle")).toBeTruthy();
    expect(screen.getByText(/Call/).closest("a")?.getAttribute("href")).toBe("tel:9437000111");
  });
  it("nothing on the way, nothing due, no boxes or points", () => {
    draw(<HomeView home={{ ...HOME, orders: [], dues: [{ brand: "Bluemins", paise: 0 }], boxes: null, points: null, support: null }} goPoints={() => {}} />);
    expect(screen.getByText("No order on the way. Call or WhatsApp to order.")).toBeTruthy();
    expect(screen.getByText("Nothing due")).toBeTruthy();
    expect(screen.queryByText("Boxes you bought")).toBeNull();
    expect(screen.queryByText("Points")).toBeNull();
  });
});

const POINTS: Points = {
  on: true,
  balance: 900,
  ends_on: "2028-01-31",
  redeem_open: true,
  opens_on: null,
  rewards: [
    { id: "a", label: "Bluemins 1L Water Bottle", size: "1L", points: 800, can_use: true, why_not: null },
    { id: "b", label: "Bluemins 500ml Water Bottle", size: "500ml", points: 1250, can_use: false, why_not: "Not enough points yet." },
  ],
  open_request: null,
  record: [{ month: "2026-11", purchases: 890, polls: 10, boxes: [] }],
};

describe("Points", () => {
  it("balance, end date, Use only where allowed (with the reason), the record", () => {
    const onUse = vi.fn();
    draw(<PointsView p={POINTS} onUse={onUse} confirm={null} busy={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("900")).toBeTruthy();
    expect(screen.getByText("Points end on 31 Jan 2028")).toBeTruthy();
    expect(screen.getByText("Not enough points yet.")).toBeTruthy();
    const uses = screen.getAllByText("Use").map((x) => x.closest("button")!);
    expect(uses[0]!.disabled).toBe(false);
    expect(uses[1]!.disabled).toBe(true);
    fireEvent.click(uses[0]!);
    expect(onUse).toHaveBeenCalledWith(POINTS.rewards[0]);
    expect(screen.getByText("Paying bills on time")).toBeTruthy();
    expect(screen.getByText("+890")).toBeTruthy();
    expect(screen.getByText("+10")).toBeTruthy();
    // the gauge aims at the next box still to reach: 1,250 − 900
    expect(screen.getByText("350 more for a free Bluemins 500ml Water Bottle")).toBeTruthy();
  });
  it("the confirm dialog; points off", () => {
    draw(<PointsView p={POINTS} onUse={() => {}} confirm={POINTS.rewards[0]!} busy={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Use 800 points for 1 free Bluemins 1L Water Bottle? We add it to your next order.")).toBeTruthy();
    cleanup();
    draw(<PointsView p={{ ...POINTS, on: false }} onUse={() => {}} confirm={null} busy={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/Points haven't started yet/)).toBeTruthy();
  });
});

const POLLS: Polls = {
  points_each: 10,
  this_week: { counted: false },
  polls: [{ id: "p1", question: "Which size sells most in your shop?", choices: ["250ml", "500ml", "1L"], other_allowed: true, closes_at: "2026-11-15T18:30:00.000Z" }],
  answered: { count: 2, points: 10 },
};

describe("Polls", () => {
  it("Send only after a choice; Other needs text", async () => {
    const send = vi.fn(async () => {});
    draw(<PollsView data={POLLS} send={send} />);
    expect(screen.getByText("This week: +10 points for answering")).toBeTruthy();
    const sendBtn = screen.getByText("Send").closest("button")!;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(screen.getByText("Other"));
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Type your answer"), { target: { value: "20L jar" } });
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(screen.getByText("500ml"));
    fireEvent.click(sendBtn);
    expect(send).toHaveBeenCalledWith("p1", 1, "20L jar");
    expect(screen.getByText("Answered: 2 · +10 points")).toBeTruthy();
  });
  it("no polls; this week's points already received", () => {
    draw(<PollsView data={{ ...POLLS, polls: [], this_week: { counted: true } }} send={async () => {}} />);
    expect(screen.getByText(/No new polls/)).toBeTruthy();
    expect(screen.getByText(/This week's poll points received/)).toBeTruthy();
  });
});

describe("Status", () => {
  it("no internet with Try again", () => {
    const retry = vi.fn();
    draw(<Status s={{ state: "offline" }} retry={retry} />);
    expect(screen.getByText("No internet")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(retry).toHaveBeenCalled();
  });
});

describe("Art and colour", () => {
  it("each product gets its picture", () => {
    expect(kindOf("20L", "jar")).toBe("jar");
    expect(kindOf("20 L")).toBe("jar");
    expect(kindOf("500ml", "box")).toBe("small");
    expect(kindOf("1L", "box")).toBe("bottle");
  });
  it("white text on dark brand colours, dark text on light ones", () => {
    expect(onBrand("#1d4ed8")).toBe("#ffffff");
    expect(onBrand("#0e7490")).toBe("#ffffff");
    expect(onBrand("#fde047")).toBe("#0f1b33");
    expect(onBrand("#a5f3fc")).toBe("#0f1b33");
  });
});
