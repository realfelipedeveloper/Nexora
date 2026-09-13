"use client";

import {
  CircleAlert,
  Eye,
  EyeOff,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { initialFieldTypes } from "@nexora/schemas";
import { AuthenticationApiError, type CmsSession, login, logout, restoreSession } from "./auth-api";

type AuthState =
  | { status: "checking" }
  | { message?: string; status: "anonymous" }
  | { session: CmsSession; status: "authenticated" }
  | { status: "unavailable" };

function loginFailureMessage(error: unknown) {
  if (error instanceof AuthenticationApiError && error.status === 429) {
    return "Too many sign-in attempts. Wait a moment and try again.";
  }

  if (error instanceof AuthenticationApiError && error.status === 401) {
    return "Email or password is incorrect.";
  }

  return "Sign-in is unavailable right now. Try again.";
}

export function CmsAuth() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);

  function checkSession() {
    const controller = new AbortController();
    setAuth({ status: "checking" });
    void restoreSession(controller.signal)
      .then((session) => setAuth({ session, status: "authenticated" }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (error instanceof AuthenticationApiError && error.status === 401) {
          setAuth({ status: "anonymous" });
          return;
        }

        setAuth({ status: "unavailable" });
      });
    return controller;
  }

  useEffect(() => {
    const controller = checkSession();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (auth.status === "anonymous" && auth.message) {
      alertRef.current?.focus();
    }
  }, [auth]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setAuth({ status: "anonymous" });

    try {
      const session = await login(email, password);
      setPassword("");
      setAuth({ session, status: "authenticated" });
    } catch (error) {
      setPassword("");
      setAuth({ message: loginFailureMessage(error), status: "anonymous" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout(session: CmsSession) {
    setLogoutError(false);
    setSubmitting(true);

    try {
      await logout(session.csrfToken);
      setEmail("");
      setAuth({ status: "anonymous" });
    } catch {
      setLogoutError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (auth.status === "checking") {
    return (
      <main className="auth-status" aria-live="polite" aria-busy="true">
        <LoaderCircle aria-hidden="true" className="spin" size={24} />
        <p>Checking session</p>
      </main>
    );
  }

  if (auth.status === "unavailable") {
    return (
      <main className="auth-status" aria-labelledby="unavailable-title">
        <CircleAlert aria-hidden="true" size={28} />
        <h1 id="unavailable-title">Nexora</h1>
        <p>Authentication service is unavailable.</p>
        <button className="button button-primary" type="button" onClick={checkSession}>
          Try again
        </button>
      </main>
    );
  }

  if (auth.status === "anonymous") {
    return (
      <main className="login-shell">
        <header className="login-brand" aria-label="Nexora CMS">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <div>
            <h1>Nexora</h1>
            <p>Content operations</p>
          </div>
        </header>

        <section className="login-panel" aria-labelledby="sign-in-title">
          <div className="login-heading">
            <LockKeyhole aria-hidden="true" size={20} />
            <div>
              <h2 id="sign-in-title">Sign in</h2>
              <p>Administrator access</p>
            </div>
          </div>

          <form onSubmit={handleLogin} aria-busy={submitting}>
            <label htmlFor="email">Email</label>
            <input
              autoComplete="username"
              id="email"
              maxLength={254}
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />

            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                autoComplete="current-password"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="icon-button"
                onClick={() => setShowPassword((visible) => !visible)}
                title={showPassword ? "Hide password" : "Show password"}
                type="button"
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>

            {auth.message ? (
              <p className="form-alert" ref={alertRef} role="alert" tabIndex={-1}>
                <CircleAlert aria-hidden="true" size={17} />
                {auth.message}
              </p>
            ) : null}

            <button className="button button-primary sign-in-button" disabled={submitting}>
              {submitting ? <LoaderCircle aria-hidden="true" className="spin" /> : null}
              {submitting ? "Signing in" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="cms-shell">
      <aside className="sidebar">
        <header className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <div>
            <strong>Nexora</strong>
            <span>CMS</span>
          </div>
        </header>
        <nav aria-label="CMS navigation">
          <span className="nav-current" aria-current="page">
            <LayoutDashboard aria-hidden="true" size={18} />
            Overview
          </span>
        </nav>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Content workspace</p>
            <h1>Overview</h1>
          </div>
          <div className="account-menu">
            <div className="account-copy">
              <strong>{auth.session.user.displayName}</strong>
              <span>{auth.session.user.email}</span>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button account-logout"
              disabled={submitting}
              onClick={() => void handleLogout(auth.session)}
              title="Sign out"
              type="button"
            >
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>

        {logoutError ? (
          <p className="workspace-alert" role="alert">
            <CircleAlert aria-hidden="true" size={17} />
            Sign-out failed. Your session remains active.
          </p>
        ) : null}

        <section className="content-section" aria-labelledby="content-model-title">
          <div className="section-heading">
            <div className="section-icon" aria-hidden="true">
              <FileText size={20} />
            </div>
            <div>
              <h2 id="content-model-title">Content model foundation</h2>
              <p>Available field types</p>
            </div>
          </div>
          <section className="field-grid" aria-label="Initial field types">
            {initialFieldTypes.map((field) => (
              <article key={field} className="field-tile">
                {field}
              </article>
            ))}
          </section>
        </section>
      </section>
    </main>
  );
}
