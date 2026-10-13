import { createCustomer, CustomerInput } from "@/server/customers";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/**
 * Add a customer (owner and Order desk). A number that is already in the list answers 409 with that customer, so
 * the screen can show it instead of making a second one.
 */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { created, customer } = await createCustomer(user, await readJson(req, CustomerInput));
  if (created) return json(customer, { status: 201 });
  const off = customer.active ? "" : " (switched off)";
  return json({ error: `This number is already ${customer.name}, ${customer.place}${off}`, customer }, { status: 409 });
});
