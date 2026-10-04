import Link from "next/link";

export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" width={34} height={34} className="rounded-[10px]" />
      <span className="text-lg font-extrabold tracking-tight">
        Cheq<span className="text-gold">Pay</span> <span className="font-semibold text-muted">Creators</span>
      </span>
    </Link>
  );
}
