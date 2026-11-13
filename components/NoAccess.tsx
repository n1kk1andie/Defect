import { ShieldMark, Tagline } from "@/components/Brand";

/** Signed in, but not one of this company's Quality people (yet). */
export function NoAccess({ email, company }: { email: string; company: string }) {
  return (
    <main id="main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 460, textAlign: "center", padding: 32 }}>
        <ShieldMark className="" title="Pulsus Quality" />
        <h1 className="headline" style={{ fontSize: 30 }}>You're signed in.<span className="accent">Access is next.</span></h1>
        <p className="lede" style={{ margin: "10px auto" }}>{email} isn't one of {company}'s Pulsus Quality people yet. Ask a Quality admin to add you under Settings → People and roles.</p>
        <Tagline />
      </div>
    </main>
  );
}
