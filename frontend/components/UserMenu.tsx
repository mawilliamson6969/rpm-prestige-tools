"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";
import styles from "./user-menu.module.css";

type Props = {
  /** Light text on dark header bars */
  variant?: "dark" | "light";
};

export default function UserMenu({ variant = "dark" }: Props) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onSignOut = useCallback(() => {
    setOpen(false);
    logout();
    router.replace("/login");
  }, [logout, router]);

  const name = user?.displayName?.trim() || user?.username || "Team member";

  return (
    <>
      <div
        className={`${styles.wrap} ${variant === "light" ? styles.wrapLight : ""}`}
        ref={wrapRef}
      >
        <button
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.welcome}>Welcome, {name}</span>
          <span className={styles.caret} aria-hidden>
            ▾
          </span>
        </button>
        {open && (
          <div className={styles.menu} role="menu">
            <Link href="/" className={styles.menuItem} role="menuitem" onClick={() => setOpen(false)}>
              Team Hub
            </Link>
            {user?.role === "admin" ? (
              <Link
                href="/admin/users"
                className={styles.menuItem}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                User Management
              </Link>
            ) : null}
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPwdOpen(true);
              }}
            >
              Change password
            </button>
            <button type="button" className={styles.menuItemDanger} role="menuitem" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </>
  );
}
