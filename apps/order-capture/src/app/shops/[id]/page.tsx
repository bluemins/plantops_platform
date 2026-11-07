import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access";
import { shopView } from "@/server/customer-details";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { LocationBox } from "../../customer-forms";
import { Header } from "../../header";
import { BackLink, PhoneLink } from "../../parts";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One shop: name, place, phone, delivery details and its location (save here / open in Maps). Never money. */
export default async function ShopPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/shops/${id}`);
  if (!can(user, "location_view")) redirect("/");
  const [plant, s] = await Promise.all([kit.branding(user.tenantId), orNotFound(shopView(user, id))]);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/shops">← Shop locations</BackLink>
      <div>
        <h1 className="text-2xl font-bold break-words">{s.name}</h1>
        <p className="text-sm text-slate-600"><PhoneLink phone={s.phone} plain={user.isSupport} /> · {s.place}</p>
        {s.delivery_address && <p className="text-sm text-slate-600">Deliver to: {s.delivery_address}</p>}
        {s.delivery_landmark && <p className="text-sm text-slate-600">Landmark: {s.delivery_landmark}</p>}
      </div>
      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Shop location</h2>
        <LocationBox customerId={s.id} location={s.location} canSave={s.can_save} canClear={s.can_clear} canPaste={s.can_paste} />
      </section>
      {can(user, "ledger_view") && <a href={`/customers/${s.id}`} className="inline-flex min-h-11 items-center font-semibold text-(--brand)">Customer page ›</a>}
    </div>
  );
}
