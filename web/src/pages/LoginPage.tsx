import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { login, loginStudentWithGoogle } from "../api/assessmentApi";
import { loadState, saveAuthToken, saveState, saveStudent } from "../utils/storage";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number | boolean>,
          ) => void;
        };
      };
    };
  }
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  function finishLogin(result: Awaited<ReturnType<typeof login>>) {
    saveAuthToken(result.token);
    if (result.student) {
      saveStudent(result.student);
    }
    navigate(redirect.startsWith("/") ? redirect : "/dashboard");
  }

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;

    function renderGoogleButton() {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          if (!response.credential) {
            setError("Google did not return an identity token.");
            return;
          }
          setGoogleLoading(true);
          setError("");
          try {
            const result = await loginStudentWithGoogle(response.credential);
            finishLogin(result);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Google sign-in failed");
          } finally {
            setGoogleLoading(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: 280,
      });
    }

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.head.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, [redirect]);

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      const result = await login({ email, password });
      if (result.user.studentId && !result.student) {
        const state = loadState();
        saveState({ ...state, authToken: result.token });
      }
      finishLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout
      title="MyLisa login"
      subtitle="Tutor and student sessions use separate accounts so lesson delivery can render the right live surface."
      kicker="MyLisa"
    >
      <div className="card">
        {error ? <div className="error-box">{error}</div> : null}
        <label className="label">Email</label>
        <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
        <div style={{ height: 12 }} />
        <label className="label">Password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="button-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={loading || !email || !password} onClick={() => void handleLogin()}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
        {googleClientId ? (
          <>
            <div style={{ height: 16 }} />
            <div ref={googleButtonRef} />
            {googleLoading ? <p className="meta">Checking Google account...</p> : null}
          </>
        ) : null}
      </div>
    </Layout>
  );
}
