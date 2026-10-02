import "./globals.css";

export const metadata = {
  title: "Bandpay",
  description:
    "Schedule an HBAR or HTS payment. Hedera fires it. It clears only inside the price band.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
