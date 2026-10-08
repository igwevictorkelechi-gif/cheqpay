// Money formatting for the Developers pages (amounts arrive in minor units).
export const naira = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
export const dollars = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
export const money = (minor: number, currency: string) => (currency === 'USD' ? dollars(minor) : naira(minor));
