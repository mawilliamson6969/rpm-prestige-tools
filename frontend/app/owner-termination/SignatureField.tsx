"use client";

import { useCallback, useRef } from "react";
import SignatureCanvas from "react-signature-canvas";

const NAVY = "#1B2856";
const GREY = "#6A737B";

type Props = {
  onChange: (dataUrl: string | null) => void;
  error?: string;
};

export function SignatureField({ onChange, error }: Props) {
  const ref = useRef<SignatureCanvas>(null);

  const clear = useCallback(() => {
    ref.current?.clear();
    onChange(null);
  }, [onChange]);

  const endStroke = useCallback(() => {
    const inst = ref.current;
    if (!inst || inst.isEmpty()) {
      onChange(null);
      return;
    }
    try {
      const trimmed = inst.getTrimmedCanvas().toDataURL("image/png");
      onChange(trimmed);
    } catch {
      onChange(inst.toDataURL("image/png"));
    }
  }, [onChange]);

  return (
    <div>
      <div
        style={{
          border: `2px solid ${error ? "#B32317" : GREY}`,
          borderRadius: 8,
          overflow: "hidden",
          background: "#fff",
          maxWidth: "100%",
        }}
      >
        <SignatureCanvas
          ref={ref}
          penColor={NAVY}
          canvasProps={{
            className: "sig-canvas",
            style: { width: "100%", height: 180, touchAction: "none" },
          }}
          onEnd={endStroke}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 10 }}>
        <button
          type="button"
          onClick={clear}
          style={{
            background: "#fff",
            border: `1px solid ${GREY}`,
            color: NAVY,
            borderRadius: 8,
            padding: "0.4rem 1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        {error && (
          <span style={{ color: "#B32317", fontSize: "0.9rem" }} role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
