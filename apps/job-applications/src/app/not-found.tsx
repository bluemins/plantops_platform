/** One answer for every unknown, suspended or switched-off plant, and for an unknown or switched-off position. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-bold">This page is not available</h1>
      <p className="mt-2 text-slate-600">Please check the address, or ask the plant for its job page link.</p>
    </div>
  );
}
