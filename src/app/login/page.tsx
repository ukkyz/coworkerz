import type { Metadata } from "next";
import SignInForm from "@/components/SignInForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Aether Executive Suite",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Only relative paths are honoured, so a crafted link cannot bounce the user off-site.
  const destination = typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-4">
      <SignInForm destination={destination} initialError={typeof error === "string" ? error : null} />
    </main>
  );
}
