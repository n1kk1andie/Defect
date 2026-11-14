import { AccountFrame } from "@/components/account/AccountFrame";

/** Signed in, but not one of this company's Quality people (yet). The sign-in standard's frame. */
export function NoAccess({ email, company }: { email: string; company: string }) {
  return (
    <AccountFrame title="You're signed in. Access is next." sub={`${email} isn't one of ${company}'s Pulsus Quality people yet. Ask a Quality admin to add you under Settings → People and roles.`} />
  );
}
