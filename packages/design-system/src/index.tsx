import type { PropsWithChildren } from "react";

export function Surface({ children }: PropsWithChildren) {
  return (
    <section
      style={{
        border: "1px solid #d7dde8",
        borderRadius: 8,
        padding: 24,
      }}
    >
      {children}
    </section>
  );
}
