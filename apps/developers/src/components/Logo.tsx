import Link from "next/link";

export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" width={32} height={32} className="rounded-[9px]" />
      <span className="whitespace-nowrap text-[17px] font-bold tracking-tight">
        Cheq<span className="text-gold">Pay</span> <span className="hidden font-semibold text-muted min-[400px]:inline">Developers</span>
      </span>
    </Link>
  );
}
