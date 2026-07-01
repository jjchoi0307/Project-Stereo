/**
 * /home is a legacy alias — the public landing now lives at the root (/), so the
 * marketing site is the bare domain. Redirect any /home hit to the canonical /.
 */
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/");
}
