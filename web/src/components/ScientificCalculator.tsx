import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

type AngleMode = "DEG" | "RAD";

function clampExpr(expr: string) {
  return expr.slice(0, 120);
}

export default function ScientificCalculator({ open, onClose }: Props) {
  const [expr, setExpr] = useState<string>("");
  const [ans, setAns] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<AngleMode>("DEG");
  const [mem, setMem] = useState<number>(0);

  useEffect(() => {
    if (open) setErr(null);
  }, [open]);

  // Convert UI expression → JS expression
  const jsExpr = useMemo(() => {
    let s = expr;

    // Symbols
    s = s.replace(/×/g, "*").replace(/÷/g, "/");

    // Constants
    s = s.replace(/\bAns\b/g, String(ans));
    s = s.replace(/π/g, "Math.PI");
    s = s.replace(/\be\b/g, "Math.E");

    // Power
    s = s.replace(/\^/g, "**");

    // Basic functions
    s = s.replace(/\bsqrt\s*\(/g, "Math.sqrt(");
    s = s.replace(/\babs\s*\(/g, "Math.abs(");
    s = s.replace(/\bln\s*\(/g, "Math.log(");
    s = s.replace(/\blog\s*\(/g, "Math.log10(");

    // Trig (handle DEG mode)
    const toRad = "(Math.PI/180)*";

    s = s.replace(
      /\bsin\s*\(/g,
      mode === "DEG" ? `Math.sin(${toRad}` : "Math.sin("
    );
    s = s.replace(
      /\bcos\s*\(/g,
      mode === "DEG" ? `Math.cos(${toRad}` : "Math.cos("
    );
    s = s.replace(
      /\btan\s*\(/g,
      mode === "DEG" ? `Math.tan(${toRad}` : "Math.tan("
    );

    return s;
  }, [expr, ans, mode]);

  function safeEval(input: string): number {
    const normalized = input.replace(/\s+/g, "");

    const allowedPattern =
      /^[0-9+\-*/().,%]*$|^.*Math\.[A-Za-z0-9_().,*+\-/]+.*$/;

    if (!allowedPattern.test(normalized)) {
      throw new Error("Invalid expression");
    }

    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${input});`);
    const v = fn();

    if (typeof v !== "number" || Number.isNaN(v) || !Number.isFinite(v)) {
      throw new Error("Math error");
    }

    return v;
  }

  function press(tok: string) {
    setErr(null);

    if (tok === "C") {
      setExpr("");
      return;
    }

    if (tok === "⌫") {
      setExpr((p) => p.slice(0, -1));
      return;
    }

    if (tok === "Ans") {
      setExpr((p) => clampExpr(p + "Ans"));
      return;
    }

    if (tok === "=") {
      try {
        const v = safeEval(jsExpr);
        setAns(v);
        setExpr(String(v));
      } catch (e: any) {
        setErr(e?.message || "Error");
      }
      return;
    }

    if (tok === "M+") {
      try {
        const v = safeEval(jsExpr);
        setMem((m) => m + v);
      } catch {
        setErr("Error");
      }
      return;
    }

    if (tok === "MR") {
      setExpr((p) => clampExpr(p + String(mem)));
      return;
    }

    if (tok === "MC") {
      setMem(0);
      return;
    }

    setExpr((p) => clampExpr(p + tok));
  }

  // Keyboard support
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();

      if (e.key === "Enter") {
        e.preventDefault();
        press("=");
        return;
      }

      if (e.key === "Backspace") {
        press("⌫");
        return;
      }

      if (e.key === "Delete") {
        press("C");
        return;
      }

      const k = e.key;

      if (/^[0-9]$/.test(k)) press(k);
      else if (k === ".") press(".");
      else if (k === "+") press("+");
      else if (k === "-") press("-");
      else if (k === "*") press("×");
      else if (k === "/") press("÷");
      else if (k === "(" || k === ")") press(k);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, jsExpr, mem, ans, mode]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 340,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 50,
      }}
    >
      <div className="card cardGlow" style={{ padding: 14 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900 }}>Scientific Calculator</div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btnGhost"
              onClick={() =>
                setMode((m) => (m === "DEG" ? "RAD" : "DEG"))
              }
            >
              {mode}
            </button>

            <button className="btn btnGhost btnDanger" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Display */}
        <div style={{ marginTop: 10 }}>
          <div className="small">
            Ans: <b>{ans}</b> • Mem: <b>{mem}</b>
          </div>

          <div style={{ fontSize: 18, fontWeight: 900 }}>
            {expr || "0"}
          </div>

          {err && <div className="error-box">{err}</div>}
        </div>

        {/* Keys */}
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 8,
          }}
        >
          <Key label="sin" onClick={() => press("sin(")} />
          <Key label="cos" onClick={() => press("cos(")} />
          <Key label="tan" onClick={() => press("tan(")} />
          <Key label="ln" onClick={() => press("ln(")} />
          <Key label="log" onClick={() => press("log(")} />

          <Key label="√" onClick={() => press("sqrt(")} />
          <Key label="x²" onClick={() => press("^2")} />
          <Key label="xʸ" onClick={() => press("^")} />
          <Key label="(" onClick={() => press("(")} />
          <Key label=")" onClick={() => press(")")} />

          <Key label="7" onClick={() => press("7")} />
          <Key label="8" onClick={() => press("8")} />
          <Key label="9" onClick={() => press("9")} />
          <Key label="÷" onClick={() => press("÷")} />
          <Key label="C" danger onClick={() => press("C")} />

          <Key label="4" onClick={() => press("4")} />
          <Key label="5" onClick={() => press("5")} />
          <Key label="6" onClick={() => press("6")} />
          <Key label="×" onClick={() => press("×")} />
          <Key label="⌫" danger onClick={() => press("⌫")} />

          <Key label="1" onClick={() => press("1")} />
          <Key label="2" onClick={() => press("2")} />
          <Key label="3" onClick={() => press("3")} />
          <Key label="-" onClick={() => press("-")} />
          <Key label="Ans" onClick={() => press("Ans")} />

          <Key label="0" onClick={() => press("0")} />
          <Key label="." onClick={() => press(".")} />
          <Key label="π" onClick={() => press("π")} />
          <Key label="+" onClick={() => press("+")} />
          <Key label="=" primary onClick={() => press("=")} />

          <Key label="M+" onClick={() => press("M+")} />
          <Key label="MR" onClick={() => press("MR")} />
          <Key label="MC" onClick={() => press("MC")} />
          <Key label="%" onClick={() => press("%")} />
          <Key label="abs" onClick={() => press("abs(")} />
        </div>
      </div>
    </div>
  );
}

function Key({
  label,
  onClick,
  primary,
  danger,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const cls =
    "btn " +
    (primary ? "" : "btnGhost ") +
    (danger ? "btnDanger " : "");

  return (
    <button
      className={cls}
      onClick={onClick}
      style={{ padding: "10px", borderRadius: 12, fontWeight: 900 }}
      type="button"
    >
      {label}
    </button>
  );
}
