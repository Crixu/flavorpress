import Image from "next/image";

export function AuthLogo() {
  return (
    <div style={logoStyle} aria-label="FlavorPress">
      <Image
        src="/icon.png"
        alt=""
        width={52}
        height={52}
        priority
        style={{
          borderRadius: 12,
          boxShadow: "0 10px 24px color-mix(in oklch, var(--ink-primary) 14%, transparent)",
        }}
      />
      <span style={wordmarkStyle}>FlavorPress</span>
    </div>
  );
}

const logoStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 18,
};

const wordmarkStyle: React.CSSProperties = {
  color: "var(--ink-primary)",
  fontSize: 16,
  fontWeight: 600,
};
