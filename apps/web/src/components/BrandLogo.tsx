import Image from "next/image";

/**
 * The CheqPay logo, correct in both themes.
 *
 * The supplied artwork is drawn for light backgrounds: an opaque near-white
 * ground, and "BEYOND FINANCE" set in near-black. Dropped straight onto the
 * app's dark surface it shows as a white card with a line of invisible text
 * under it. cheqpay-logo-dark.png is the same artwork with the ground keyed out
 * and that one line lifted to the ink colour; the gradient mark and the purple
 * wordmark are untouched.
 *
 * Both files are rendered and CSS picks one, rather than reading the theme in
 * React. The theme is applied to <html> by a pre-paint script, so a JS-driven
 * swap would flash the wrong logo on first paint on every load.
 */
export default function BrandLogo({
  className = "h-auto w-[150px]",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <>
      <Image
        src="/cheqpay-logo-dark.png"
        alt="CheqPay"
        width={1528}
        height={439}
        priority={priority}
        className={`logo-dark ${className}`}
      />
      <Image
        src="/cheqpay-logo.png"
        alt="CheqPay"
        width={1942}
        height={809}
        priority={priority}
        className={`logo-light ${className}`}
        aria-hidden
      />
    </>
  );
}
