import { Card } from "@plantops/ui";
import { num, type CanMakeGroup, type ProductResult } from "@/lib/recipe";

/**
 * "Can make from this stock" (home page and day page). Products that share a material are one "OR" group: each line
 * is the most of that product if all of the shared material went to it, so the numbers are never added up.
 */
export function CanMakeCard({ groups, title }: { groups: CanMakeGroup[]; title: string }) {
  if (!groups.length) return null;
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {groups.map((g) =>
        g.shared.length ? (
          <div key={g.products[0]!.item_id} className="space-y-1 rounded-xl border-2 border-violet-200 bg-violet-50 p-3">
            <p className="text-sm font-semibold text-violet-800">
              {g.shared.map((s) => s.material).join(", ")} {g.shared.length === 1 ? "is" : "are"} shared: make one OR the other
            </p>
            {g.products.map((p, i) => (
              <div key={p.item_id}>
                {i > 0 && <p className="py-1 text-center text-xs font-bold tracking-widest text-violet-700">OR</p>}
                <ProductLine p={p} upTo />
              </div>
            ))}
            {g.shared.map((s) => (
              <p key={s.material} className="border-t border-dashed border-violet-200 pt-2 text-sm text-slate-700">
                {s.total_bottles !== null ? (
                  <>
                    {s.material} is enough for <b>{num(s.total_bottles)} bottles</b> in total ({s.per_product.map((x) => x.name).join(" + ")} together)
                  </>
                ) : (
                  <>
                    {s.material} alone is enough for {s.per_product.map((x) => `${num(x.bottles)} ${x.name}`).join(" or ")} bottles
                  </>
                )}
              </p>
            ))}
          </div>
        ) : (
          <ProductLine key={g.products[0]!.item_id} p={g.products[0]!} />
        ),
      )}
    </Card>
  );
}

function ProductLine({ p, upTo }: { p: ProductResult; upTo?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <span className="font-semibold">{p.name}</span>
      {p.status === "ok" && (
        <>
          <span className={`whitespace-nowrap text-lg font-bold ${p.bottles === 0 ? "text-red-700" : ""}`}>
            {upTo && "up to "}
            {p.boxes !== null ? `${num(p.boxes)} ${p.unit}` : `${num(p.bottles)} bottles`}
          </span>
          <span className="w-full text-sm text-slate-500">
            {p.boxes !== null && p.per_box !== null && p.per_box > 1 ? `${num(p.bottles)} bottles · ` : ""}
            runs out first: {p.limiting.join(", ")}
            {p.made.map((m) => (
              <span key={m.material} className="block">
                {m.material}: {num(m.ready)} ready + {num(m.made)} from {m.from.join(", ")}
              </span>
            ))}
            {p.boxes === null ? " · box size not available right now" : ""}
          </span>
        </>
      )}
      {p.status === "problem" && (
        <span className="w-full text-sm text-amber-800">
          Can't work out:{" "}
          {p.problems.map((x) => (x.kind === "not_counted" ? `${x.material} not counted` : `${x.material}'s contents don't match the recipe`)).join("; ")}
        </span>
      )}
      {p.status === "no_recipe" && <span className="text-sm text-slate-400">recipe not set</span>}
    </div>
  );
}
