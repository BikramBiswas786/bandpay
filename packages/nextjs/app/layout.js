import "./globals.css";

export const metadata = {
  title: "Bandpay",
  description:
    "Schedule an HBAR or HTS payment. Hedera fires it. It clears only inside the price band.",
  openGraph: {
    title: "Bandpay",
    description: "Schedule one payment. Hedera fires it. It clears only inside the price band.",
    url: "https://bandpay-two.vercel.app",
    siteName: "Bandpay",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
