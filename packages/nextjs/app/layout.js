export const metadata = {
  title: "Bandpay",
  description: "Schedule an HBAR or HTS payment. It clears only inside the price band.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Georgia, serif", background: "#f4f0e6", color: "#1c1915" }}>
        {children}
      </body>
    </html>
  );
}
