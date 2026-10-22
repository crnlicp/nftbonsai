import { NavLink, Outlet } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";
import logo from "./logo-mark.svg";

function short(p?: string): string {
  if (!p) return "";
  return p.length > 14 ? `${p.slice(0, 5)}…${p.slice(-5)}` : p;
}

export function Layout() {
  const { isAuthenticated, principal, signIn, signOut, isLoading, error } = useAuthContext();

  return (
    <div className="min-h-full flex flex-col">
      <header className="px-4 pt-6 md:px-8">
        <nav className="glass mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <NavLink to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
            <img src={logo} alt="" width={32} height={32} className="h-8 w-8 [image-rendering:pixelated]" />
            <span>NFT Bonsai</span>
          </NavLink>
          <div className="hidden gap-1 md:flex">
            <NavLink to="/mint" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>
              Mint
            </NavLink>
            <NavLink to="/my-nfts" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>
              My bonsai
            </NavLink>
            <NavLink to="/gallery" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>
              Gallery
            </NavLink>
            <NavLink to="/wallet" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>
              Wallet
            </NavLink>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <span className="hidden font-mono text-xs text-slate-400 md:inline" title={principal}>
                  {short(principal)}
                </span>
                <button onClick={signOut} className="btn-ghost px-3 py-1.5 text-sm" disabled={isLoading}>
                  Sign out
                </button>
              </>
            ) : (
              <button onClick={signIn} className="btn-primary px-4 py-1.5 text-sm" disabled={isLoading}>
                {isLoading ? "…" : "Sign in"}
              </button>
            )}
          </div>
        </nav>
        {/* mobile nav */}
        <div className="mx-auto mt-3 flex max-w-6xl gap-1 md:hidden">
          <NavLink to="/mint" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>Mint</NavLink>
          <NavLink to="/my-nfts" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>My bonsai</NavLink>
          <NavLink to="/gallery" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>Gallery</NavLink>
          <NavLink to="/wallet" className={({ isActive }) => (isActive ? "nav-link-active" : "nav-link")}>Wallet</NavLink>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8 md:py-12">
        {error && <p role="alert" className="mb-4 text-sm text-red-200">{error}</p>}
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-xs text-slate-500 md:px-8">
        NFTs grown on the Internet Computer · card payments by PawPayments · ICP on-chain
      </footer>
    </div>
  );
}
