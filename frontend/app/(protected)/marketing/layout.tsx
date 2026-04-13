import WikiTopBar from "../../../components/WikiTopBar";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      <WikiTopBar />
      {children}
    </div>
  );
}
