import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";
import logo from "./logo-mark.svg";
import { artLabId } from "../lib/actors";

function short(p?: string): string {
  if (!p) return "";
  return p.length > 14 ? `${p.slice(0, 5)}…${p.slice(-5)}` : p;
}

const NAV_LINK = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-link-active" : "nav-link");

function NavLinks({ artLab, onNavigate }: { artLab: boolean; onNavigate?: () => void }) {
  return (
    <>
      <NavLink to="/mint" className={NAV_LINK} onClick={onNavigate}>Mint</NavLink>
      <NavLink to="/my-nfts" className={NAV_LINK} onClick={onNavigate}>My bonsai</NavLink>
      <NavLink to="/gallery" className={NAV_LINK} onClick={onNavigate}>Gallery</NavLink>
      <NavLink to="/wallet" className={NAV_LINK} onClick={onNavigate}>Wallet</NavLink>
      <NavLink to="/bonsai" className={NAV_LINK} onClick={onNavigate}>$BONSAI</NavLink>
      {artLab && <NavLink to="/art-lab" className={NAV_LINK} onClick={onNavigate}>Art lab</NavLink>}
      <NavLink to="/collection" className={NAV_LINK} onClick={onNavigate}>Canisters Info</NavLink>
    </>
  );
}

export function Layout() {
  const { isAuthenticated, principal, signIn, signOut, isLoading, error } = useAuthContext();
  const artLab = artLabId() !== undefined;
  const drawer = useRef<HTMLDialogElement>(null);
  const location = useLocation();

  const openMenu = () => drawer.current?.showModal();
  const closeMenu = () => drawer.current?.close();

  useEffect(() => closeMenu(), [location.pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => desktop.matches && closeMenu();
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#0b1a1f]/90 shadow-glass backdrop-blur-xl backdrop-saturate-150">
        <nav aria-label="Main" className="flex w-full items-center justify-between gap-3 px-4 py-3 md:px-8">
          <NavLink to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
            <img src={logo} alt="" width={32} height={32} className="h-8 w-8 [image-rendering:pixelated]" />
            <span>ICPBonsai</span>
          </NavLink>
          <div className="hidden gap-1 lg:flex">
            <NavLinks artLab={artLab} />
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {isAuthenticated ? (
              <>
                <NavLink to="/wallet" aria-label="Open your wallet" className="rounded-md font-mono text-[10px] text-moss-200 hover:text-white md:text-xs">
                  <span title={principal}>{short(principal)}</span>
                </NavLink>
                <button onClick={signOut} className="btn-ghost hidden px-3 py-1.5 text-sm lg:inline-flex" disabled={isLoading}>
                  Sign out
                </button>
              </>
            ) : (
              <button onClick={signIn} className="btn-primary px-4 py-1.5 text-sm" disabled={isLoading}>
                {isLoading ? "…" : "Sign in"}
              </button>
            )}
            <button
              type="button"
              onClick={openMenu}
              aria-label="Open menu"
              aria-haspopup="dialog"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-100 transition hover:bg-white/10 lg:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>
        </nav>
      </header>

      <dialog
        ref={drawer}
        aria-label="Menu"
        onClick={(e) => e.target === e.currentTarget && closeMenu()}
        className="drawer m-0 ml-auto h-dvh max-h-none w-72 max-w-[85vw] border-l border-white/15 bg-[#0b1f24] p-0 text-slate-100 shadow-glass backdrop:bg-slate-950/70 backdrop:backdrop-blur-sm lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <span className="flex items-center gap-2 font-display font-semibold">
              <img src={logo} alt="" width={24} height={24} className="h-6 w-6 [image-rendering:pixelated]" />
              ICPBonsai
            </span>
            <button
              type="button"
              onClick={closeMenu}
              aria-label="Close menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <nav aria-label="Mobile" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3 [&>a]:px-4 [&>a]:py-3 [&>a]:text-base">
            <NavLinks artLab={artLab} onNavigate={closeMenu} />
          </nav>
          <div className="border-t border-white/10 p-4">
            {isAuthenticated ? (
              <div className="space-y-3">
                <p className="truncate font-mono text-xs text-moss-200" title={principal}>{principal}</p>
                <button onClick={() => { closeMenu(); signOut(); }} className="btn-ghost w-full py-2 text-sm" disabled={isLoading}>
                  Sign out
                </button>
              </div>
            ) : (
              <button onClick={() => { closeMenu(); signIn(); }} className="btn-primary w-full py-2 text-sm" disabled={isLoading}>
                {isLoading ? "…" : "Sign in"}
              </button>
            )}
          </div>
        </div>
      </dialog>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8 md:py-12">
        {error && <p role="alert" className="mb-4 text-sm text-red-200">{error}</p>}
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-xs text-slate-500 md:px-8">
        <p className="mb-2 flex flex-wrap items-center justify-center gap-2 text-slate-400">
          <img src="/icp-logo.svg" alt="" className="h-4 w-7" />
          Fully hosted on-chain on the Internet Computer
        </p>
        <p>App, backend & bonsai artwork on-chain · card payments by PawPayments</p>
        <p className="mt-2"><NavLink to="/collection" className="text-moss-300 underline-offset-4 hover:underline">Canister IDs &amp; wallet import</NavLink></p>
      </footer>
    </div>
  );
}
